/*!
    WS: Created By MARK46 (https://github.com/MARK-46)
    31-03-2022 12:45:23
 */

import { Buffer } from 'buffer';
import { MWsServerReceiver } from './mws-server.receiver';
import {
    CloseProtocol,
    CreateFrame,
    CreateID,
    CreateSignalData,
    GetWSCodeReason,
    JSONParse,
    JSONStringify,
    Log,
    LogTypes
} from './mws-server.utility';
import { MWsServerBase } from './mws-server.base';
import { Socket } from 'net';
import { clearInterval } from 'timers';
import { IncomingMessage } from 'http';
import { IMWsServerKeyValue } from './';

enum ClientStats {
    PENDING = 1,
    CONNECTED = 2,
    DISCONNECTED = 3
}

export class MWsServerClient {
    private __closed: ClientStats = ClientStats.PENDING;
    private _closeCode: number = 1000;
    private _closeReason: string = '';
    private _receiver: MWsServerReceiver | undefined;
    private _verifyTimeout: any;
    private readonly _id: string;
    private _clientInfo: IMWsServerKeyValue = {};
    private _clientSettings: IMWsServerKeyValue = { online: false };

    public constructor(public server: MWsServerBase, public _socket: Socket, public _req: IncomingMessage) {
        this.__closed = ClientStats.CONNECTED;
        this._socket.setTimeout(0);
        this._socket.setNoDelay();
        this._id = CreateID();
        Log.debug(LogTypes.CONNECTING, this.id, this._socket.remoteAddress, this._socket.remotePort);
        this.setClientInfo({});
    }

    get req(): IncomingMessage {
        return this._req;
    }

    get ip(): string {
        return this._socket.remoteAddress || '0.0.0.0';
    }

    get port(): number {
        return this._socket.remotePort || 0;
    }

    get id(): string {
        return this._id;
    }

    get clientInfo(): IMWsServerKeyValue {
        return this._clientInfo;
    }

    public setClientInfo(value: IMWsServerKeyValue) {
        this._clientInfo = value;
        this._clientInfo.client_id = this._id;
    }

    get clientSettings(): IMWsServerKeyValue {
        return this._clientSettings;
    }

    public setClientSettings(value: IMWsServerKeyValue) {
        this._clientSettings = value;
    }

    public setSocket(options: { maxPayload: any; skipUTF8Validation: any; }) {
        this._receiver = new MWsServerReceiver(this.server, this, {
            maxPayload: options.maxPayload,
            skipUTF8Validation: options.skipUTF8Validation
        });

        this._receiver.on('error', this.closing.bind(this, 'receiver_error'));
        this._receiver.on('conclude', this.closing.bind(this, 'receiver_conclude'));
        this._socket.on('close', this.closing.bind(this, 'socket_close'));
        this._socket.on('error', this.closing.bind(this, 'socket_error'));

        this._socket.on('data', this._receiver.write.bind(this._receiver));
        this._socket.on('end', this.socketOnEnd.bind(this));

        this._verifyTimeout = setTimeout(() => {
            if (this._verify) {
                return clearInterval(this._verifyTimeout);
            }
            const closeReason = CloseProtocol.S5103('Server', 'Invalid client.');
            this.close(closeReason.code, closeReason.reason);
        }, 7000);
    }

    private socketOnEnd() {
        this._receiver?.end();
        this._socket?.end();
    }

    private closing(...args: any[]) {
        try {
            if (!this._socket || this.__closed != ClientStats.CONNECTED) {
                return;
            }

            process.nextTick((stream: { resume: () => any; }) => stream.resume(), this._socket);

            if (this._receiver) {
                this._receiver.removeListener('error', this.closing.bind(this));
                this._receiver.removeListener('conclude', this.closing.bind(this));
                this._socket.removeListener('data', this._receiver.write.bind(this._receiver));
                this._receiver.removeAllListeners();
            }

            this._socket.removeListener('close', this.closing.bind(this));
            this._socket.removeListener('error', this.closing.bind(this));
            this._socket.removeListener('end', this.socketOnEnd.bind(this));

            if (args[0] === 'socket_close') {
                // const hadError = args[1] as boolean;
                Log.debug(LogTypes.DISCONNECTED, this.id, this._socket.remoteAddress, this._socket.remotePort, this._closeCode, this._closeReason);
                this.server.onDisconnect(this, this._closeCode, this._closeReason);
            }
            else if (args[0] === 'socket_error' || args[0] === 'receiver_conclude') {
                if (args[0] === 'socket_error') {
                    this._closeCode = 5105;
                    this._closeReason = CloseProtocol.S5105(args[1].message).reason;
                }
                else if (args[0] === 'receiver_conclude') {
                    this._closeCode = args[1] as number;
                    this._closeReason = GetWSCodeReason(this._closeCode, (args[2] as Buffer).toString('utf-8'));
                }

                Log.debug(LogTypes.DISCONNECTED, this.id, this._socket.remoteAddress, this._socket.remotePort, this._closeCode, this._closeReason);
                this.server.onDisconnect(this, this._closeCode, this._closeReason);

                this._receiver?.end();
                this._socket?.end();
                this._socket?.destroy();
            }
        } catch (error) {
            this._socket?.destroy(error as any);
        }

        this.__closed = ClientStats.DISCONNECTED;
    }

    /*!
        VERIFICATION
     */
    private _verify: boolean = false;

    public isVerified(header: Buffer, credentials: Buffer): boolean {
        if ((header[0] + header[1]) == 0 && !this._verify) // first
        {
            this._verify = true;
            clearInterval(this._verifyTimeout);
            if (!this.server.onAuthentication(this, JSONParse(credentials.toString()))) {
                const unAuthRes = CloseProtocol.S5101();
                this.close(unAuthRes.code, unAuthRes.reason);
                return false;
            }
            Log.debug(LogTypes.CONNECTED, this.id, this._socket.remoteAddress, this._socket.remotePort);
            this.send(0, `${this.id}${JSONStringify(this.clientInfo)}`, (err?: Error) => {
                if (err) {
                    Log.debug(LogTypes.DISCONNECTED, this.id, this._socket.remoteAddress, this._socket.remotePort, -1, err?.message || err);
                }
                this.server.onConnect(this);
            });
        }
        else // any
        {
            if (!this._verify) {
                const closeReason = CloseProtocol.S5103('Server', 'Invalid client.');
                this.close(closeReason.code, closeReason.reason);
                return false;
            }
        }
        return true;
    }

    /*!
        SEND/CLOSE
     */

    /**
     * To close the connection to the server.
     *  Example:
     * ```js
     *      const closeReason = CloseProtocol.S5105('Bye. :D');
     *      client.close(closeReason.code, closeReason.reason);
     * ```
     */
    public close(code: number, reason: string, cb?: ((err?: Error) => void) | undefined): boolean {
        if (!this._socket.writable) {
            cb?.call(null, new Error('connection closed'));
            return false;
        }

        let payload, meta;

        if (code !== undefined && code !== 1005) {
            payload = Buffer.from(reason === undefined ? '--' : '--' + reason);
            payload.writeUInt16BE(code, 0);
        }
        else {
            payload = Buffer.alloc(0);
        }
        meta = CreateFrame(true, 8, payload);

        this._socket.end(Buffer.concat([
            meta,
            payload
        ], meta.length + payload.length), cb);
        return true;
    }

    /**
     * Sending a signal packet to the client.
     *  Example:
     * ```js
     *      client.send(SignalCodes.S2C.ONLINE_STATS, { "client_count": server.clientCount() });
     * ```
     */
    public send(code: number, data: Buffer | string | boolean | number | object | string[] | number[] | object[], cb?: any): boolean {
        if (!this._socket.writable) {
            cb?.call(null, new Error('connection closed'));
            return false;
        }

        const signalData = CreateSignalData(code, data);
        if (signalData.length >= this.server.options.maxPayload) {
            Log.error(`SendError / Max payload size exceeded (%s Bytes of %s Bytes)`, signalData.length, this.server.options.maxPayload);
            cb?.call(null, new Error('Max payload size exceeded'));
            return false;
        }
        return this.sendBinary(signalData, (err) => {
            if (err) this.closing.call(this, 'socket_error', err);
            Log.debug(LogTypes.SIGNAL_SEND, this.id, code, signalData.slice(4), err);
            cb?.call(this, err);
        });
    }

    private sendBinary(payload: Buffer, cb?: ((err?: Error | undefined) => void) | undefined) {
        let meta = CreateFrame(true, 2, payload);
        return this._socket.write(Buffer.concat([
            meta,
            payload
        ], meta.length + payload.length), cb);
    }

    /**
     * Kick the client from the server with a reason.
     * ```js
     *      client.kick("Admin", "You broke a rule.");
     * ```
     */
    public kick(user: string, reason: string, cb?: (() => void) | undefined): boolean {
        const closedReason = CloseProtocol.S5103(user, reason);
        return this.close(closedReason.code, closedReason.reason, cb);
    }

    /**
     * Block the client on the server with a reason and a ban length.
     * ```js
     *      client.ban("Admin", "You broke a rule.", "2 WEEKS");
     * ```
     */
    public ban(user: string, reason: string, length: string, cb?: (() => void) | undefined): boolean {
        const closedReason = CloseProtocol.S5104(user, reason, length);
        return this.close(closedReason.code, closedReason.reason, cb);
    }
}
