import { Buffer } from 'buffer';
import { v4 as UUID } from 'uuid';
import { createHash as Hash } from 'crypto';

export class EventEmitter {
    private _listeners: { [name: string]: { fn: (...args: any[]) => boolean | void, ctx: any, index: number }[] } = {};

    public on(evt: string, fn: (...args: any[]) => boolean | void, ctx: any = this): number {
        let index = (this._listeners[evt] || []).length;
        (this._listeners[evt] || (this._listeners[evt] = [])).push({
            fn: fn,
            ctx: ctx || this,
            index: index
        });
        return index;
    }

    public off(evt: string | undefined, fnIndex: number | undefined) {
        if (evt === undefined) {
            this._listeners = {};
        }
        else {
            if (fnIndex === undefined) {
                delete this._listeners[evt];
            }
            else {
                if (this._listeners[evt]) {
                    this._listeners[evt] = this._listeners[evt].filter(listener => listener.index !== fnIndex);
                }
            }
        }
        return this;
    }

    public emit(evt: string, ...args: any[]): boolean {
        let result = true;
        let listeners = this._listeners[evt];
        if (listeners) {
            for (let i = 0; i < listeners.length;) {
                let stats = listeners[i].fn.call(listeners[i++].ctx, ...(args || []));
                if (typeof stats === 'boolean' && !stats) {
                    result = false;
                }
            }
        }
        return result;
    }
}

export class FastMap<V>
{
    public constructor(private _values: { [key: string]: V } = {}, private _count: number = 0) {
        if (!this._values) {
            this._values = {};
            this._count = 0;
        }
        else {
            if (!this._count) {
                this._count = Object.keys(this._values).length;
            }
        }
    }

    public delete(key: string): boolean {
        if (this._values[key]) {
            delete this._values[key];
            this._count--;
            return true;
        }
        return false;
    }

    public set(key: string, value: V): V {
        if (!this._values[key])
            this._count++;
        this._values[key] = value;
        return this._values[key];
    }

    public get(key: string): V {
        return this._values[key];
    }

    public forEach(cb: (value: V, key: string) => void): void {
        const values = this._values;
        for (let key in values) {
            if (values[key]) {
                cb(values[key], key);
            }
        }
    }

    public filter(predicate: (value: V, key: string) => boolean): FastMap<V> {
        const buffer = new FastMap<V>();
        const values = this._values;
        for (let key in values) {
            if (values[key]) {
                if (predicate(values[key], key)) {
                    buffer.set(key, values[key]);
                }
            }
        }
        return buffer;
    }

    public clear(): void {
        this._values = {};
    }

    public count(): number {
        return this._count;
    }

    public items(): V[] {
        const buffer = [];
        const values = this._values;
        for (let key in values) {
            if (values[key]) {
                buffer.push(values[key]);
            }
        }
        return buffer;
    }
}

export enum LogTypes {
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    DISCONNECTED = 'DISCONNECTED',
    SIGNAL_SEND = 'SIGNAL|SEND',
    SIGNAL_RECV = 'SIGNAL|RECV',
    ROOM_JOIN = 'ROOM|JOIN',
    ROOM_LEAVE = 'ROOM|LEAVE',
}

export class Log {
    public static ENABLED: boolean = true;
    public static SHOW_CONNECTIONS: boolean = true;
    public static SHOW_SEND: boolean = true;
    public static SHOW_RECV: boolean = true;

    private static Colors = {
        Reset: '\x1b[0m',
        Black: '\x1b[30m',
        Red: '\x1b[31m',
        Green: '\x1b[32m',
        Yellow: '\x1b[33m',
        Blue: '\x1b[34m',
        Magenta: '\x1b[35m',
        Cyan: '\x1b[36m',
        White: '\x1b[37m'
    };

    public static info(msg: string, ...args: any[]): void {
        if (Log.ENABLED) {
            console.log(`${Log.Colors.Green}#MWS | ${Log.Colors.White}${msg}${Log.Colors.Reset}`, ...(args || []));
        }
    }

    public static warn(msg: string, ...args: any[]): void {
        if (Log.ENABLED) {
            console.log(`${Log.Colors.Yellow}#MWS | ${Log.Colors.White}${msg}${Log.Colors.Reset}`, ...(args || []));
        }
    }

    public static error(msg: string, ...args: any[]): void {
        if (Log.ENABLED) {
            console.log(`${Log.Colors.Red}#MWS | ${Log.Colors.White}${msg}${Log.Colors.Reset}`, ...(args || []));
        }
    }

    public static debug(type: LogTypes, ...args: any[]): void {
        if (Log.ENABLED) {
            if (!Log.SHOW_RECV && type === LogTypes.SIGNAL_RECV) {
                return;
            }

            if (!Log.SHOW_SEND && type === LogTypes.SIGNAL_SEND) {
                return;
            }

            if (!Log.SHOW_CONNECTIONS && (type === LogTypes.CONNECTED || type === LogTypes.CONNECTING || type === LogTypes.DISCONNECTED || type === LogTypes.ROOM_LEAVE || type === LogTypes.ROOM_JOIN)) {
                return;
            }

            let spaces = '                                          ';
            let _ = `${Log.Colors.Blue}#MWS | ${Log.Colors.Reset}`;

            if (type === LogTypes.CONNECTED || type === LogTypes.CONNECTING || type === LogTypes.DISCONNECTED || type === LogTypes.SIGNAL_RECV || type === LogTypes.SIGNAL_SEND || type === LogTypes.ROOM_LEAVE || type === LogTypes.ROOM_JOIN) {
                _ += `[ID: ${Log.Colors.Red + pad(args[0], 17, '00000000000000000') + Log.Colors.Reset}]`;

                if (type === LogTypes.CONNECTING || type === LogTypes.CONNECTED || type === LogTypes.DISCONNECTED) {
                    _ += `${Log.Colors.Cyan} # ${pad(type, 17, spaces)} ${Log.Colors.Reset}`;
                    _ += Log.Colors.White + '>> ' + Log.Colors.Reset;
                    _ += `IP: ${Log.Colors.Green + args[1] + ':' + args[2] + Log.Colors.Reset}`;
                    if (type === LogTypes.DISCONNECTED) {
                        _ += Log.Colors.White + ' - ' + Log.Colors.Reset;
                        _ += `Code: ${Log.Colors.Red + pad(args[3], 4, '0000') + Log.Colors.Reset}`;
                        _ += Log.Colors.White + ' - ' + Log.Colors.Reset;
                        _ += `Reason: ${Log.Colors.Red + args[4] + Log.Colors.Reset}`;
                    }
                }
                else if (type === LogTypes.SIGNAL_RECV || type === LogTypes.SIGNAL_SEND) {
                    let strType = type.toString();
                    if (args[1] === 0)
                        strType = strType.replace('SEND', 'ANSWERED').replace('RECV', 'OFFERING');
                    if (args[3])
                        strType += '|ERROR';
                    _ += `${Log.Colors.Blue} # ${pad(strType, 17, spaces)} ${Log.Colors.Reset}`.replace(/\|/g, Log.Colors.White + '|' + Log.Colors.Blue);
                    if (args[3])
                        _ = _.replace('ERROR', Log.Colors.Red + 'ERROR' + Log.Colors.Reset);
                    _ += Log.Colors.White + '>> ' + Log.Colors.Reset;
                    _ += `Code: ${Log.Colors.Green + pad(args[1], 4, '0000') + Log.Colors.Reset}`;
                    _ += Log.Colors.White + ' - ' + Log.Colors.Reset;
                    let content = JSONStringify(args[2]);
                    _ += `Data Length: ${Log.Colors.Green + pad(FormatBytes(content.length), 13, '             ') + Log.Colors.Reset}`;
                    if (args[3]) {
                        _ += Log.Colors.White + ' - ' + Log.Colors.Reset;
                        _ += `Error Message: ${Log.Colors.Red + (args[3]['message'] || args[3]) + Log.Colors.Reset}`;
                    }
                    _ += Log.Colors.White + ' - ' + Log.Colors.Reset;
                    _ += `Data: ${Log.Colors.Green + (content.length > 1024 ? content.slice(0, 256) + ' ... ' + content.slice(content.length - 256, content.length) : content) + Log.Colors.Reset}`;
                }
                else if (type === LogTypes.ROOM_JOIN || type === LogTypes.ROOM_LEAVE) {
                    _ += `${Log.Colors.Cyan} # ${pad(type, 17, spaces)} ${Log.Colors.Reset}`;
                    _ += Log.Colors.White + '>> ' + Log.Colors.Reset;
                    _ += `Room ID: ${Log.Colors.Green + args[1] + Log.Colors.Reset}`;
                }
            }

            _ += Log.Colors.Reset;

            console.debug(_);
        }
    }
}

export function ConcatBuffers(list: any, totalLength: number): any {
    if (list.length === 0) {
        return Buffer.alloc(0);
    }
    if (list.length === 1) {
        return list[0];
    }

    const target = Buffer.allocUnsafe(totalLength);
    let offset = 0;

    for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
    }

    if (offset < totalLength) {
        return target.slice(0, offset);
    }

    return target;
}

export function pad(text: any, size: number, pattern = '000000000') {
    let s = pattern + text;
    return s.substr(s.length - size);
}

export function FormatBytes(bytes: any, decimals = 2): string {
    try {
        if (typeof bytes == 'string') {
            bytes = bytes.length;
        }
        if (typeof bytes == 'object') {
            bytes = JSONStringify(bytes).length;
        }

        if (bytes === 0) {
            return '0 Bytes';
        }

        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = [
            'Bytes',
            'KB',
            'MB',
            'GB',
            'TB',
            'PB',
            'EB',
            'ZB',
            'YB'
        ];

        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return (bytes / Math.pow(k, i)).toFixed(dm) + ' ' + sizes[i];
    }
    catch (e) {
        return '-1';
    }
}

export function CreateID(): string {
    return '\x4D\x4B' + UUID().slice(20).replace(/[-]/g, '').toUpperCase();
}

export function CreateAcceptKey(key: string): string {
    return Hash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}

export function JSONStringify(json: any | null | undefined): string {
    try {
        if (json === null || json === undefined) {
            return '';
        }
        if (typeof json == 'object') {
            if (Buffer.isBuffer(json)) {
                return json.toString();
            }
            return JSON.stringify(json);
        }
        return json.toString();
    }
    catch (e) {
        Log.error('JSONStringifyError', e);
        return '';
    }
}

export function JSONParse(str: any | null | undefined): any | any[] {
    try {
        if (str === null || str === undefined || str.length == 0) {
            return null;
        }
        return JSON.parse(str);
    }
    catch (e) {
        Log.error('JSONParseError', e);
    }
    return null;
}

export function GetWSCodeReason(code: number, reason: any) {
    if (code >= 0 && code <= 999) {
        return '(Unused)';
    }
    else if (code >= 1016) {
        if (code <= 1999) {
            return '(For WebSocket standard)';
        }
        else if (code <= 2999) {
            return '(For WebSocket extensions)';
        }
        else if (code <= 3999) {
            return '(For libraries and frameworks)';
        }
        else if (code <= 4999) {
            return '(For applications)';
        }
    }
    const MWSErrorCodes: any = {
        '1000': 'Normal Closure',
        '1001': 'Going Away',
        '1002': 'Protocol Error',
        '1003': 'Unsupported Data',
        '1004': '(For future)',
        '1005': 'No Status Received',
        '1006': 'Abnormal Closure',
        '1007': 'Invalid frame payload data',
        '1008': 'Policy Violation',
        '1009': 'Message too big',
        '1010': 'Missing Extension',
        '1011': 'Internal Error',
        '1012': 'Service Restart',
        '1013': 'Try Again Later',
        '1014': 'Bad Gateway',
        '1015': 'TLS Handshake'
    };
    if (typeof (MWSErrorCodes[code]) !== 'undefined') {
        return MWSErrorCodes[code];
    }
    return reason;
}

export function CreateFrame(fin: boolean, opcode: number, payload: any) {
    let len = payload.length;
    let meta = Buffer.alloc(2 + (len < 126 ? 0 : (len < 65536 ? 2 : 8)));

    meta[0] = (fin ? 128 : 0) + opcode;
    meta[1] = 0;

    if (len < 126) {
        meta[1] += len;
    }
    else if (len < 65536) {
        meta[1] += 126;
        meta.writeUInt16BE(len, 2);
    }
    else {
        meta[1] += 127;
        meta.writeUInt32BE(Math.floor(len / Math.pow(2, 32)), 2);
        meta.writeUInt32BE(len % Math.pow(2, 32), 6);
    }

    return meta;
}

export function CreateSignalData(signal: number, data: Buffer | string | boolean | number | object | string[] | number[] | object[]): Buffer {
    if (signal >= 0 && signal <= 9999) {
        let payloadData = data instanceof Buffer ? data : Buffer.from(JSONStringify(data));
        let payload = Buffer.alloc(payloadData.length + 4);
        let strSignal = '0000' + signal;
        payload.writeUInt8(Number(strSignal[strSignal.length - 4] + '' + strSignal[strSignal.length - 3]), 0);
        payload.writeUInt8(Number(strSignal[strSignal.length - 2] + '' + strSignal[strSignal.length - 1]), 1);
        payload.writeUInt8(25, 2);
        payload.writeUInt8(151, 3);
        payload.set(payloadData, 4);
        return payload;
    }
    throw Error('The signal code must be between 1 and 9999. ' + signal);
}

export function BufferMask(source: Buffer, mask: Buffer, output: Buffer, offset: number, length: number) {
    for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
    }
}

export function BufferUnmask(buffer: Buffer, mask: Buffer) {
    for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
    }
}

export const CloseProtocol = {
    S5101: () => {
        return { code: 5101, reason: `Authorization error.` };
    },
    S5102: () => {
        return { code: 5102, reason: `Server is Full.` };
    },
    S5103: (user: string, reason: string) => {
        return { code: 5103, reason: `Kicked by ${user || 'anonymous'}. (Reason: ${reason || ''})` };
    },
    S5104: (user: string, reason: string, length: string) => {
        return {
            code: 5104,
            reason: `You have been banned by the ${user || 'anonymous'} for ${length || '? Days'}. (Reason: ${reason || ''})`
        };
    },
    S5105: (message: string) => {
        return { code: 5105, reason: `Server exception (Message: ${message || ''}).` };
    },
    C5201: (message: string) => {
        return { code: 5201, reason: `Connection closed by client (Message: ${message || ''}).` };
    }
};
