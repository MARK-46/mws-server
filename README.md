# WebSocket
- Server: done.
- Client: done.
~~~
WS: Created By MARK46 (https://github.com/MARK-46)
    31-03-2022 12:45:23

# Example
```javascript
const { MWsServer } = require('@mark46/mws-server');

const server = new MWsServer({
    host: '127.0.0.1',
    port: 20020,
    maxClients: 10,
});

server.on('client.authentication', (client, credentials) => {
    const access_token = credentials.access_token;
    if (access_token !== '1234567890')
        return false;
    
    client.setClientInfo({ "nickname": "Mark" });
    return true;
});

server.on('client.connected', (client) => { });
server.on('client.disconnected', (client, code, reason) => { });
server.on('client.signal', (client, code, data) => { });

server.start();
```