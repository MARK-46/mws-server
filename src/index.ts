/*!
    WS: Created By MARK46 (https://github.com/MARK-46)
    31-03-2022 12:45:23
 */

import { ListenOptions } from "net";
import { ServerOptions } from "https";

export { MWsServer } from './mws-server';
export { FastMap, EventEmitter, JSONStringify, JSONParse, CloseProtocol } from './mws-server.utility';

export interface IMWsServerKeyValue {
    [key: string]: null | string | number | boolean | string[] | number[];
}

export interface IMWsServerOptions extends ListenOptions {
    tsl?: boolean;
    tslOptions?: ServerOptions;
    port: number;
    host: string;
    maxPayload: number,
    maxClients: number,
}
