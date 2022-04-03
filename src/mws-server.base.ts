/*!
    WS: Created By MARK46 (https://github.com/MARK-46)
    31-03-2022 12:45:23
 */

import { RequestListener, Server as HTTPServer, STATUS_CODES, IncomingMessage } from 'http';
import { Server as HTTPSServer } from 'https';
import { MWsServerClient } from './mws-server.client';
import { CreateAcceptKey, EventEmitter } from './mws-server.utility';
import { Socket } from 'net';
import { IMWsServerKeyValue, IMWsServerOptions } from './';

const keyRegex = /^[+/0-9A-Za-z]{22}==$/;
const RUNNING = 0;
const CLOSED = 1;

export abstract class MWsServerBase extends EventEmitter
{
    private _state: number = CLOSED;
    private _server: HTTPServer | HTTPSServer | null;

    protected constructor(public options: IMWsServerOptions, requestListener?: RequestListener)
    {
        super();
        this.options = options;
        if (this.options.tsl && this.options.tslOptions)
        {
            this._server = new HTTPSServer(this.options.tslOptions, requestListener);
        }
        else
        {
            this._server = new HTTPServer(requestListener);
        }
        this._server.on('upgrade', this.handleUpgrade.bind(this));
    }

    /**
     * To start the server.
     * @param listeningListener Called when the server is started.
     *  Example:
     * ```js
     *      let server = InitMWsServer({
     *          host: '0.0.0.0',
     *          port: 1997,
     *          maxPayload: 100 * 1024 * 1024,
     *          maxClients: 100
     *      });
     *      const express = require('express');
     *      const app = express();
     *      app.get('/', (req, res) => {
     *          res.send('Hello World :D');
     *      });
     *      server.start(app);
     * ```
     */
    public start(listeningListener?: RequestListener): HTTPServer | HTTPSServer | null
    {
        if (this._server && this._state == CLOSED)
        {
            this._state = RUNNING;
            if (listeningListener) {
                this._server.on('request', listeningListener);
            }
            return this._server.listen(this.options, this.onServerStarted.bind(this, this._server));
        }
        return null;
    }

    public close(): void
    {
        if (this._state === RUNNING)
        {
            this._server!!.off('upgrade', this.handleUpgrade.bind(this));
            this._server = null;
            this._state = CLOSED;
        }
    }

    private handleUpgrade(req: any, socket: any, head: any)
    {
        socket.on('error', socket.destroy.bind(socket));

        const key = req.headers!['sec-websocket-key'] !== undefined ? req.headers!['sec-websocket-key'] : false;
        const version = +req.headers!['sec-websocket-version'];

        if (req.method !== 'GET' || req.headers.upgrade.toLowerCase() !== 'websocket' || !key || !keyRegex.test(key) || (version !== 8 && version !== 13))
        {
            return this.abortHandshake(socket, 400);
        }

        const secWebSocketProtocol = req.headers!['sec-websocket-protocol'];
        this.completeUpgrade(key, secWebSocketProtocol, req, socket, head);
    }

    private completeUpgrade(key: string, protocols: any, req: IncomingMessage, socket: Socket, head: any)
    {
        if (!socket.readable || !socket.writable)
        {
            return socket.destroy();
        }

        if (this._state > RUNNING)
        {
            return this.abortHandshake(socket, 503);
        }

        const client = new MWsServerClient(this, socket, req);

        const headers = [
            'HTTP/1.1 101 Switching Protocols (MARK-46)',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${ CreateAcceptKey(key) }`,
            `Sec-WebSocket-Protocol: ${ protocols }`,
            `Sec-WebSocket-ID: ${ client.id }`
        ];

        socket.write(headers.concat('\r\n').join('\r\n'));
        socket.removeListener('error', socket.destroy.bind(socket));

        client.setSocket(head, {
            maxPayload: this.options.maxPayload,
            skipUTF8Validation: false
        });
    }

    private abortHandshake(socket: Socket, code: number, message?: string | DataView | ArrayBuffer | undefined, headers?: { [x: string]: any; } | undefined)
    {
        if (socket.writable)
        {
            message = message || STATUS_CODES[code];
            headers = {
                Connection: 'close',
                'Content-Type': 'text/html',
                'Content-Length': message ? Buffer.byteLength(message) : 0, ...headers
            };

            socket.write(`HTTP/1.1 ${ code } ${ STATUS_CODES[code] } (MARK-46)\r\n` + Object.keys(headers).map((h) => `${ h }: ${ headers!![h] }`).join('\r\n') + '\r\n\r\n' + message);
        }

        socket.removeListener('error', socket.destroy.bind(socket));
        socket.destroy();
    }

    public abstract onServerStarted(server: HTTPServer): void;

    public abstract onAuthentication(client: MWsServerClient, credentials: IMWsServerKeyValue): boolean;

    public abstract onConnect(client: MWsServerClient): void;

    public abstract onDisconnect(client: MWsServerClient, code: number, reason: string): void;

    public abstract onSignal(client: MWsServerClient, code: number, data: Buffer): void;
}
