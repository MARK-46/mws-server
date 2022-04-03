/*!
    WS: Created By MARK46 (https://github.com/MARK-46)
    31-03-2022 12:45:23
 */

import { Server as HTTPServer } from 'http';
import { Server as HTTPSServer } from 'https';
import { MWsServerClient } from './mws-server.client';
import { MWsServerClientManager } from './mws-server.client-mgr';
import { CloseProtocol, FastMap, Log, LogTypes } from './mws-server.utility';
import { IMWsServerKeyValue, IMWsServerOptions } from './';
import { MWsServerBase } from './mws-server.base';

export interface IMWsServer
{
    /**
     * Authentication Middleware
     *  Example:
     * ```js
     *      server.on('client.authentication', (client: MWsServerClient, credentials: IMWsServerKeyValue): boolean => {
     *        const access_token = credentials.access_token;
     *        if (access_token !== '1234567890')
     *            return false;
     *        client.setClientInfo({ "nickname": "Mark", ... });
     *        return true;
     *      });
     * ```
     */
    on(event: 'client.authentication', listener: (client: MWsServerClient, credentials: IMWsServerKeyValue) => boolean): number;

    /**
     * When the client is successfully authenticated.
     *  Example:
     * ```js
     *      server.on('client.connected', (client: MWsServerClient) => {
     *        client.send(SignalCodes.S2C.ONLINE_STATS, { "client_count": server.clientCount() });
     *        server.broadcast(SignalCodes.S2C.ONLINE_STATS, { "client_count": server.clientCount() }, [ client.id ]);
     *      });
     * ```
     */
    on(event: 'client.connected', listener: (client: MWsServerClient) => void): number;

    /**
     * When connections to the client are reset by the server or the client.
     *  Example:
     * ```js
     *      server.on('client.disconnected', (client: MWsServerClient, code: number, reason: string) => {
     *        server.broadcast(SignalCodes.S2C.ONLINE_STATS, { "client_count": server.clientCount() }, [ client.id ]);
     *      });
     * ```
     */
    on(event: 'client.disconnected', listener: (client: MWsServerClient, code: number, reason: string) => void): number;

    /**
     * When the server receives signal packets.
     *  Example:
     * ```js
     *      server.on('client.signal', (client: MWsServerClient, code: number, data: Buffer) => {
     *        if (code === SignalCodes.C2S.JOIN_ROOM) {
     *           const jsonData = Util.JSONParse(data.toString());
     *           server.join(client, jsonData.room_id);
     *        } else if (code === SignalCodes.C2S.LEAVE_ROOM) {
     *           const jsonData = Util.JSONParse(data.toString());
     *           server.leave(client, jsonData.room_id);
     *        }
     *        client.broadcast(SignalCodes.S2C.ONLINE_STATS, { "client_count": server.clientCount() }, [ client.id ]);
     *      });
     * ```
     */
    on(event: 'client.signal', listener: (client: MWsServerClient, code: number, data: Buffer) => void): number;

    off(event: 'client.authentication', fnIndex: number | undefined): void;
    off(event: 'client.connected', fnIndex: number | undefined): void;
    off(event: 'client.disconnected', fnIndex: number | undefined): void;
    off(event: 'client.signal', fnIndex: number | undefined): void;
}

export class MWsServer extends MWsServerBase implements IMWsServer
{
    private __clientManager: MWsServerClientManager = new MWsServerClientManager();

    private constructor(public options: IMWsServerOptions)
    {
        super(options);
    }

    public onServerStarted(server: HTTPServer | HTTPSServer): void
    {
        this.__clientManager.reset();
        Log.info('ServerStarted: ws://%s:%s', this.options.host, this.options.port);
    }

    public onAuthentication(client: MWsServerClient, credentials: IMWsServerKeyValue): boolean
    {
        if (this.clientCount() >= this.options.maxClients)
        {
            const closedReason = CloseProtocol.S5102();
            client.close(closedReason.code, closedReason.reason);
            return false;
        }

        return this.emit('client.authentication', client, credentials);
    }

    public onConnect(client: MWsServerClient): void
    {
        this.__clientManager.set(client);
        this.emit('client.connected', client);
    }

    public onDisconnect(client: MWsServerClient, code: number, reason: string): void
    {
        this.__clientManager.leaveAll(client.id);
        this.__clientManager.delete(client);
        this.emit('client.disconnected', client, code, reason);
    }

    public onSignal(client: MWsServerClient, code: number, data: Buffer): void
    {
        this.emit('client.signal', client, code, data);
    }

    /**
     * Send broadcast signal data to all clients.
     *  Example:
     * ```js
     *      server.broadcast(SignalCodes.S2C.ONLINE_STATS, { "client_count": server.clientCount() }, [ "MK97574DCD01251D0", ... ]);
     * ```
     */
    public broadcast(code: number, data: Buffer | string | number | object | string[] | number[] | object[], except: string[] = []): void
    {
        this.__clientManager.clients({
            predicate: except && except.length > 0 ? clientId => !except.includes(clientId) : undefined
        }).forEach(client => client.send(code, data, undefined));
    }

    /**
     * Send broadcast signal data to all clients in the room.
     *  Example:
     * ```js
     *      server.broadcastInRoom(SignalCodes.S2C.ONLINE_STATS, { "client_count": server.clientCount() }, "R45678", [ "MK97574DCD01251D0", ... ]);
     * ```
     */
    public broadcastInRoom(code: number, data: Buffer | string | number | object | string[] | number[] | object[], key: string, except: string[]): void
    {
        this.__clientManager.clients({
            room: key,
            predicate: except && except.length > 0 ? clientId => !except.includes(clientId) : undefined
        }).forEach(client => client.send(code, data, undefined));
    }

    /**
     * To join the room.
     *  Example:
     * ```js
     *      server.join(client, "R45678");
     * ```
     */
    public join(client: MWsServerClient, room_id: string): void
    {
        this.__clientManager.join(room_id, client.id);
        Log.debug(LogTypes.ROOM_JOIN, client.id, room_id);
    }

    /**
     * To leave the room.
     *  Example:
     * ```js
     *      server.leave(client, "R45678");
     * ```
     */
    public leave(client: any, room_id: string): boolean
    {
        if (this.__clientManager.leave(room_id, client.id))
        {
            Log.debug(LogTypes.ROOM_LEAVE, client.id, room_id);
            return true;
        }
        return false;
    }

    /**
     * To leave from all previously joined rooms.
     *  Example:
     * ```js
     *      server.leaveAll(client);
     * ```
     */
    public leaveAll(client: any, cb: (room_id: string) => void): boolean
    {
        return this.__clientManager.leaveAll(client.id, cb);
    }

    public static Init(options: IMWsServerOptions): MWsServer
    {
        return new MWsServer(options);
    }

    public clients(options?: { predicate?: (clientId: string, client: MWsServerClient) => boolean, room?: string }): FastMap<MWsServerClient>
    {
        return this.__clientManager.clients(options);
    }

    public client(clientId: string): MWsServerClient
    {
        return this.__clientManager.client(clientId);
    }

    public clientCount(room?: string): number
    {
        return this.__clientManager.count(room);
    }
}
