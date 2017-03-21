# TChannel transport requests

You can create and send TChannel requests with TChannel or a sub-channel using
`request` followed by `send`.

```js
channel
.request(requestOptions)
.send(procedure, headers, body, callback);
```

 - [sub-channels](./sub-channels.md)

The TChannel argument schemes call `send` on your behalf, taking responsbility
for the encoding of arg2 and arg3.

 - [as-thrift](./as-thrift.md)
 - [as-json](./as-json.md)

## Stability: stable

[![stable](http://badges.github.io/stability-badges/dist/stable.svg)](http://github.com/badges/stability-badges)

### `req.send(arg1, arg2, arg3, cb)`

Consider using [`as-json`](./as-json.md) or
[`as-thrift`](./as-thrift.md) to make send data down
outgoing requests that use json or thrift encoding.
Calling `send()` directly is for when you want to deal with
binary buffers.

`arg1` is the name of the endpoint you want to call as a string.
`arg2` is generally application headers as a `Buffer`
`arg3` is the body of the outgoing request as a `Buffer`

The `cb` gets called with `cb(err, res, arg2, arg3)`

The callback will either get called with `cb(err)` or with
`cb(null, resp, arg2, arg3)`

 - `err` will either be `null` or an `Error`. This can be
    an error like a timeout, IO or tchannel error frame.
 - `resp` is the incoming response, this can be an OK
    response or an error from the remote server.
 - `resp.ok` will be a boolean, dependening on whether this is
    an OK response or an application error.
 - `arg2` are the application headers as a `Buffer`
 - `arg3` is the response body as a `Buffer`

The following document request options.

### `options.parent` or `options.hasNoParent`

The parent request contributes to tracing and clamping the TTL for the outbound
request (minus time spent in process since the parent request was received).
You **must** provide either the parent request or explicitly state that there
is no parent request.

Sometimes you do not have a `parent`; This is only the case if
you are writing tests or if you are truly the edge HTTP service
that made the first tchannel request.

In these cases you can set `hasNoParent` to `true`

### `options.serviceName` (empty)

The serviceName that you want to send this request to.


### `options.headers`

You can set the transport headers for the outgoing response. There
are multiple headers and they are defined in the
[protocol document](../../docs/protocol.md)

There are two required headers, "cn" the caller name and "as" the
arg scheme.

When using the `hyperbahn` client and `as-thrift` library these
headers will be set for you.


### `options.shouldApplicationRetry` (`null`)

If provided, specifies a function that determines whether TChannel should retry
application errors (as opposed to TChannel transport errors).
Transport errors indicate that the request and response were not completely
sent or received.
Application errors indicate that the request and response were successfully
transported, but the body of the response indicates an application exception.
TChannel does not retry application errors by default.
This function if provided allows TChannel to distinguish retryable requests.
The function receives the exception info and the decoded request and response
body.

### `options.timeout` (none)

Specifies the total time a request can spend in-process before timing out.
The deadline/ttl are communicated on the wire to downstream services so they
can shed work for requests that have or are very likely to time out.

You should specify a timeout for this operation. This will default to 100.

This will call your callback with a timeout error if no response was received
within the timeout.

### `options.timeoutPerAttempt` (none)

TChannel may retry requests until the timeout.
Each attempt may have a more constrainted timeout, after which it will make
another attempt.

### `options.retryLimit`

Determines the maximum number of attempts TChannel may make to fulfill the
request.

### `options.retryFlags`

The retry flags is an optional object with three boolean properties:

- `never` indicates that the request should not be retried under any
  circumstance.
- `onConnectionError` indicates that the request should be retried if TChannel
  fails to deliver the request due to a connection error.
- `onTimeout` indicates that the request should be retried of the request times
  out.

### `options.streamed` (`false`)

Indicates that the request and response should be streamed, so all arguments
will be modeled with streams instead of buffers.
Streamed requests will time out only if they fail to receive the *first* frame of
the response before the deadline elapses.
Non-streamed requests time out if they fail to receive the *last* frame of the
response before the deadline elapses.

### `options.trackPending`

If specified as false, indicates that the request should not count toward the
pending requests for a peer for purposes of load balancing.


### Undocumented request options

Not yet documented:

- `options.host` (`''`)
- `options.checksumType`
- `options.forwardTrace`
- `options.trace`
- `options.tracing`
- `options.checksum`
- `options.peer`

