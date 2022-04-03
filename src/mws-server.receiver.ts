/*!
    WS: Created By MARK46 (https://github.com/MARK-46)
    31-03-2022 12:45:23
 */

import { Writable } from 'stream';
import { MWsServerBase } from './mws-server.base';
import { MWsServerClient } from './mws-server.client';
import { ConcatBuffers, Log, LogTypes } from './mws-server.utility';

const GET_INFO = 0;
const GET_PAYLOAD_LENGTH_16 = 1;
const GET_PAYLOAD_LENGTH_64 = 2;
const GET_MASK = 3;
const GET_DATA = 4;

interface ReceiverOptions {
    maxPayload: any;
    skipUTF8Validation: any;
}

export class MWsServerReceiver extends Writable {
    private readonly _maxPayload: number;
    private readonly _buffers: any[];
    private _bufferedBytes: number;
    private _payloadLength: number;
    private _mask: any;
    private _fragmented: number;
    private _masked: boolean;
    private _fin: boolean;
    private _opcode: number;
    private _totalPayloadLength: number;
    private _messageLength: number;
    private _fragments: any[];
    private _state: number;
    private _loop: boolean;

    public constructor(public server: MWsServerBase, public client: MWsServerClient, options: ReceiverOptions) {
        super();

        this._maxPayload = options.maxPayload;

        this._bufferedBytes = 0;
        this._buffers = [];

        this._payloadLength = 0;
        this._mask = undefined;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;

        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];

        this._state = GET_INFO;
        this._loop = false;
    }

    get writableState(): { errorEmitted: boolean, finished: boolean } {
        return (this as any)['_writableState'];
    }

    public _write(chunk: string | any[], _: any, cb: () => any) {
        if (this._opcode === 0x08 && this._state == GET_INFO) {
            return cb();
        }

        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
    }

    private consume(n: number) {
        this._bufferedBytes -= n;

        if (n === this._buffers[0].length) {
            return this._buffers.shift();
        }

        if (n < this._buffers[0].length) {
            const buf = this._buffers[0];
            this._buffers[0] = buf.slice(n);
            return buf.slice(0, n);
        }

        const dst = Buffer.allocUnsafe(n);

        do {
            const buf = this._buffers[0];
            const offset = dst.length - n;

            if (n >= buf.length) {
                dst.set(this._buffers.shift(), offset);
            }
            else {
                dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
                this._buffers[0] = buf.slice(n);
            }

            n -= buf.length;
        } while (n > 0);

        return dst;
    }

    private startLoop(cb: { (): any; (arg0: any): void; }) {
        let err;
        this._loop = true;

        do {
            switch (this._state) {
                case GET_INFO:
                    err = this.getInfo();
                    break;
                case GET_PAYLOAD_LENGTH_16:
                    err = this.getPayloadLength16();
                    break;
                case GET_PAYLOAD_LENGTH_64:
                    err = this.getPayloadLength64();
                    break;
                case GET_MASK:
                    this.getMask();
                    break;
                case GET_DATA:
                    err = this.getData();
                    break;
                default:
                    this._loop = false;
                    return;
            }
        } while (this._loop);

        cb(err);
    }

    private getInfo() {
        if (this._bufferedBytes < 2) {
            this._loop = false;
            return;
        }

        const buf = this.consume(2);

        if ((buf[0] & 0x30) !== 0x00) {
            this._loop = false;
            return error(RangeError, 'RSV2 and RSV3 must be clear', true, 1002, 'WS_ERR_UNEXPECTED_RSV_2_3');
        }

        this._fin = (buf[0] & 0x80) === 0x80;
        this._opcode = buf[0] & 0x0f;
        this._payloadLength = buf[1] & 0x7f;

        if (this._opcode === 0x00) {
            if (!this._fragmented) {
                this._loop = false;
                return error(RangeError, 'invalid opcode 0', true, 1002, 'WS_ERR_INVALID_OPCODE');
            }

            this._opcode = this._fragmented;
        }
        else if (this._opcode === 0x01 || this._opcode === 0x02) {
            if (this._fragmented) {
                this._loop = false;
                return error(RangeError, `invalid opcode ${this._opcode}`, true, 1002, 'WS_ERR_INVALID_OPCODE');
            }

        }
        else if (this._opcode > 0x07 && this._opcode < 0x0b) {
            if (!this._fin) {
                this._loop = false;
                return error(RangeError, 'FIN must be set', true, 1002, 'WS_ERR_EXPECTED_FIN');
            }

            if (this._payloadLength > 0x7d) {
                this._loop = false;
                return error(RangeError, `invalid payload length ${this._payloadLength}`, true, 1002, 'WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH');
            }
        }
        else {
            this._loop = false;
            return error(RangeError, `invalid opcode ${this._opcode}`, true, 1002, 'WS_ERR_INVALID_OPCODE');
        }

        if (!this._fin && !this._fragmented) {
            this._fragmented = this._opcode;
        }
        this._masked = (buf[1] & 0x80) === 0x80;

        if (!this._masked) {
            this._loop = false;
            return error(RangeError, 'MASK must be set', true, 1002, 'WS_ERR_EXPECTED_MASK');
        }

        if (this._payloadLength === 126) {
            this._state = GET_PAYLOAD_LENGTH_16;
        }
        else if (this._payloadLength === 127) {
            this._state = GET_PAYLOAD_LENGTH_64;
        }
        else {
            return this.haveLength();
        }
    }

    private getPayloadLength16() {
        if (this._bufferedBytes < 2) {
            this._loop = false;
            return;
        }

        this._payloadLength = this.consume(2).readUInt16BE(0);
        return this.haveLength();
    }

    private getPayloadLength64() {
        if (this._bufferedBytes < 8) {
            this._loop = false;
            return;
        }

        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);

        //
        // The maximum safe integer in JavaScript is 2^53 - 1. An error is returned
        // if payload length is greater than this number.
        //
        if (num > Math.pow(2, 53 - 32) - 1) {
            this._loop = false;
            return error(RangeError, 'Unsupported WebSocket frame: payload length > 2^53 - 1', false, 1009, 'WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH');
        }

        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        return this.haveLength();
    }

    private haveLength() {
        if (this._payloadLength && this._opcode < 0x08) {
            this._totalPayloadLength += this._payloadLength;
            if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
                this._loop = false;
                return error(RangeError, 'Max payload size exceeded', false, 1009, 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH');
            }
        }

        if (this._masked) {
            this._state = GET_MASK;
        }
        else {
            this._state = GET_DATA;
        }
    }

    private getMask() {
        if (this._bufferedBytes < 4) {
            this._loop = false;
            return;
        }

        this._mask = this.consume(4);
        this._state = GET_DATA;
    }

    private getData() {
        let data = Buffer.alloc(0);

        if (this._payloadLength) {
            if (this._bufferedBytes < this._payloadLength) {
                this._loop = false;
                return;
            }

            data = this.consume(this._payloadLength);

            if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
                for (let i = 0; i < data.length; i++) {
                    data[i] ^= this._mask[i & 3];
                }
            }
        }

        if (this._opcode > 0x07) {
            return this.controlMessage(data);
        }

        if (data.length) {
            this._messageLength = this._totalPayloadLength;
            this._fragments.push(data);
        }

        return this.dataMessage();
    }

    private dataMessage() {
        if (this._fin) {
            const messageLength = this._messageLength;
            const fragments = this._fragments;

            this._totalPayloadLength = 0;
            this._messageLength = 0;
            this._fragmented = 0;
            this._fragments = [];

            if (this._opcode === 2) {
                if (fragments.length != 0) {
                    let header = fragments[0].slice(0, 4);
                    if (fragments[0].byteLength >= 4 && header[2] === 25 && header[3] === 151) {
                        let code = (100 * header[0]) + header[1];
                        let data = ConcatBuffers(fragments, messageLength).slice(4);
                        Log.debug(LogTypes.SIGNAL_RECV, this.client.id, code, data);
                        if (this.client.isVerified(header, data)) {
                            if (code !== 0) {
                                this.server.onSignal(this.client, code, data);
                            }
                        }
                    }
                    else {
                        this._loop = false;
                        return error(RangeError, 'Invalid signal data', false, 5105, 'WS_ERR_INVALID_SIGNAL_DATA');
                    }
                }
                else {
                    this._loop = false;
                    return error(RangeError, 'Invalid signal data', false, 5105, 'WS_ERR_INVALID_SIGNAL_DATA');
                }
            }
            else {
                this._loop = false;
                return error(RangeError, 'Invalid signal data', false, 5105, 'WS_ERR_INVALID_SIGNAL_DATA');
            }
        }

        this._state = GET_INFO;
    }

    private controlMessage(data: Buffer) {
        if (this._opcode === 0x08) {
            this._loop = false;

            if (data.length === 0) {
                this.emit('conclude', 1005, Buffer.alloc(0));
                this.end();
            }
            else if (data.length === 1) {
                return error(RangeError, 'invalid payload length 1', true, 1002, 'WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH');
            }
            else {
                const code = data.readUInt16BE(0);
                const buf = data.slice(2);
                this.emit('conclude', code, buf);
                this.end();
            }
        }
        else if (this._opcode === 0x09) {
        }
        else {
        }

        this._state = GET_INFO;
    }
}

function error(ErrorCtor: any, message: string, prefix: boolean, statusCode: number, errorCode: string) {
    const err = new ErrorCtor(prefix ? `Invalid WebSocket frame: ${message}` : message);

    Error.captureStackTrace(err, error);
    err.code = errorCode;
    err.message = message;
    err[Symbol('status-code')] = statusCode;
    return err;
}
