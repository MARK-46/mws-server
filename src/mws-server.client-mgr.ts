/*!
    WS: Created By MARK46 (https://github.com/MARK-46)
    31-03-2022 12:45:23
 */

import { MWsServerClient } from './mws-server.client';
import { FastMap } from './mws-server.utility';

export class MWsServerClientManager {
    private _clients: FastMap<MWsServerClient> = new FastMap<MWsServerClient>();
    private _rooms: FastMap<string[]> = new FastMap<string[]>();

    public reset(): void {
        this._clients.clear();
        this._rooms.clear();
    }

    public set(client: MWsServerClient): boolean {
        if (!this._clients.get(client.id)) {
            this._clients.set(client.id, client);
            return true;
        }
        return false;
    }

    public delete(client: MWsServerClient): boolean {
        return this._clients.delete(client.id);
    }

    public join(room: string, clientId: string): void {
        (this._rooms.get(room) || this._rooms.set(room, [])).push(clientId);
    }

    public leave(room: string, clientId: string): boolean {
        if (this._rooms.get(room)) {
            if (this._rooms.get(room).includes(clientId)) {
                this._rooms.set(room, this._rooms.get(room).filter(id => id !== clientId));
                return true;
            }
        }
        return false;
    }

    public leaveAll(clientId: string, cb?: (room: string) => void): boolean {
        let result = false;
        this._rooms.forEach((_, room) => {
            if (this.leave(room, clientId)) {
                result = true;
                cb?.call(this, room);
            }
        });
        return result;
    }

    public clients(options?: { predicate?: ((clientId: string, client: MWsServerClient) => boolean) | undefined, room?: string | undefined }): FastMap<MWsServerClient> {
        if (options) {
            if (options.room) {
                let clients = this._rooms.get(options.room);
                if (clients) {
                    if (options.predicate && typeof options.predicate === 'function') {
                        return this._clients.filter((client, clientId) => options.predicate!(clientId, client) && clients.includes(clientId));
                    }
                    else {
                        return this._clients.filter((_, clientId) => clients.includes(clientId));
                    }
                }
                return new FastMap<MWsServerClient>();
            }
            if (options.predicate && typeof options.predicate === 'function') {
                return this._clients.filter((client, clientId) => options.predicate!(clientId, client));
            }
        }
        return this._clients;
    }

    public client(clientId: string): MWsServerClient {
        return this._clients.get(clientId);
    }

    public count(room?: string): number {
        if (room) return this._rooms.get(room)?.length || 0;
        return this._clients.count();
    }
}
