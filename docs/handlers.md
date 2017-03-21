# TChannel transport handlers

You can handle TChannel requests by specifying a handler to sub-channel `register()`

 - [sub-channels](./sub-channels.md)

The TChannel argument schemes wrap handlers, taking responsibility for encoding
and decoding arg2 and arg3.

 - [as-thrift](./as-thrift.md)
 - [as-json](./as-json.md)

### `handler(req, res, arg2, arg3)`

Your handler will get called with an `IncomingRequest` and an
`OutgoingResponse`.

You will also receive `arg2` and `arg3` as buffers.

### `res.sendOk(arg2, arg3)`

To send an ok response you can call `sendOk()` on the outgoing
response with two buffers for `arg2` and `arg3`

### `res.sendNotOk(arg2, arg3)`

To send an application error response you can call `sendNotOk()`
on the outgoing response with two buffers for `arg2` and `arg3`

### `res.sendError(codeString, codeMessage)`

To send an error frame instead of a call response you can call
`res.sendError()`.

Valid `codeString` values are: `Timeout`, `Cancelled`, `Busy`,
`Declined`, `UnexpectedError`, `BadRequest`, `NetworkError`,
`UnHealthy`, `ProtocolError`

For the samentics of the code string please read the
[protocol document](https://github.com/uber/tchannel-node/pull/350)

You can also pass an arbitrary string `codeMessage` that will
be in the error frame.
