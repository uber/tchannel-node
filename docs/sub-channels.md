# Sub channels

TChannel supports the notion of sub channels. Whenever you want
to implement a serviceName you create a subchannel for it.

Whenever you want to talk to a downstream service; you create
a subchannel for it.

Read on for details on using a sub channel to send and handle requests.

 - [requests](./requests.md)
 - [handlers](./handlers.md)

## Stability: stable

[![stable](http://badges.github.io/stability-badges/dist/stable.svg)](http://github.com/badges/stability-badges)

## `channel.makeSubChannel(options)`

**Note:** Favor using `hyperbahnClient.getClientChannel()` for
any creating sub channels if your making requests to hyperbahn

See the [hyperbahn](./hyperbahn.md) documentation on how to
create sub channels with hyperbahn

To create a sub channel you call `makeSubChannel` on the root
channel.

```js
var channel = TChannel()

var myChannel = channel.makeSubChannel({
    serviceName: 'my-service'
});
```

### `options.serviceName`

The `serviceName` for this channel. If this is a `serviceName`
that you are implementing then you will probably call `register()`
on the sub channel.

If this is a `serviceName` that you want to talk to then you'll
probably call `request()` on the sub channel.

### `options.peers`

If this sub channel is used to talk to other services then you
want to pre-populate a `peers` list. 

In the hyperbahn use case you will use
`hyperbahnClient.getClientChannel()` and it will prepopulate the
correct hyperbahn peers.

In the peer to peer use case you will want to specify an array
of `host:port` strings for all the other instances you want to
talk to.

The `host:port` strings must be non-ephemeral hostPort as per the
[host-port rules](./host-port.md)

If you do not specify a `peers` array you must pass a `host`
option for every outgoing request.

### `options.peerFile`

A filePath to read & watch that contains a JSON encoded array
of host ports. A host port is a string that is `{ip}:{port}`.

This is useful if you want to use tchannel in a p2p fashion
and make requests based on a hostfile on disk.

## `var req = subChannel.request(options)`

`request()` is used to initiate an outgoing request to another channel.

 - [requests](./requests.md)

## `subChannel.register(name, handler)`

Consider using [`as-json`](./as-json.md) or
[`as-thrift`](./as-thrift.md) to register endpoints
that use json or thrift encoding. Calling `register()` directly
is for when you want to deal with binary buffers.

You can call `register` to register an named endpoint with 
handler

 - [requests](./handlers.md)
