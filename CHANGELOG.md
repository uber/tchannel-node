# v3.8.1

- Adds an `isUnhealthyError` method to TChannel for use in throttling (client
  side rate limiting).

# v3.8.0

- Relaxes timeouts for streaming requests, so that a timeout will not apply
  until the last fragment of the request has been received.

# v3.7.3

- Adds a file watcher, for binding a TChannel subchannel's peer list to the
  contents of a file.

# v3.7.1, v3.7.2

- Adds support for baseAppHeaders in as/json and as/thrift.
- Adds guards against common race condition in the lazy relay request object pool.

# v3.7.0

- Introduces the `allowOptionalArguments` flag for `TChannelAsThrift`, so
  services and clients can opt-in for the looser semantics for fields of Thrift
  argument structs that are not explicitly optional or required.  Enabling this
  flag makes argument fields optional by default (they were formerly required
  by default, and optional was not possible to express).  Consequently,
  existing IDL should change fields to required, or add null checks to existing
  request handlers.
- Adds another guard to prevent a dangling reference to a reclaimed Lazy Relay
  Request from throwing an exception upon attempting to follow up with an error
  frame.

# v3.6.24

- Updated dependencies for compatibility with Node.js 4.
- Changes the default for peer selection: now uses a heap to choose peers for
  outbound requests. This can be configured with the `choosePeerWithHeap`
  TChannel option.
- Addresses a problem in lazy relay, which would read the response flags
  instead of the response code, confusing stats.
- Adds support for tryConnect() on peers, with back-off.
- Ensures a minimum number of connections for each peer. The intent is to
  eventually support a connections count goal.
- Fixes a bug in the HTTP argument scheme regarding the Content-Length header.
- Removes the special cases for the "self" peer. These interfaces have been
  removed. External usage of these private interfaces is not expected.
- Numerous performance improvements, particularly using object pooling and lazy
  buffer slicing.

Hyperbahn:

- Adds a Hyperbahn::discover method to the Hyperbahn client, suitable for
  querying available peers for a given service.
- Now emits stats for error frames produced and forwarded.

Thrift:

- Relaxes the constraint that application exeptions in the Thrift arg scheme
  must be instances of the JavaScript Error base type.
- The Thrift argument scheme instance now exposes a `getServiceEndpoints`
  method for introspecting methods.
- ThriftRW upgraded to version 3.4.3, capturing fixes for lists of lists, and
  maps with integer keys, and adds support for the i8 alias for the byte type.

# v3.6.3

- Added consistent host port validation in listen(), connect(), and init
  handshake
- Added support for thrift includes under tchannel-as-thrift
- Added protection against TCP socket being full
- Added TChannel library version init headers
- Added stricter `host:port` validation for both incoming and outgoing
  connections
- Add logging around several edge cases including
  - unknown error frames
  - unknown call responses
- Improved and fixed timeout handling
- Reduced number of production dependencies
- Fixed a server-side double response bug
- Fixed the tracing RNG to be xorshift128 rather than a naive LCG
- Fixed a uncaught exception under TChannelJSON request sending
- Fixed a streaming bug in as/http
- Fixed retries to work around dead hosts
- Several edge case bug fixes
- Several other leaks fixed
- Several performance improvements

# v3.5.23

- This change significantly reduces the weight of buffers latent on the heap by
  using a shared 64KB buffer instead of one intermediate buffer for each frame.
- Adds `Peer#toString()` and `Peer#inspect()`
- Fixes `Peer#connectTo()` such that it returns a Connection.
- Adds a missing TChannel#setWriteBufferMode(mode) method to retain
  backward-compatibility with dependees that still need it.

# v3.5.19

- Adds support for channel, peer, and connection draining.
- Introduces lazy relaying, allowing Hyperbahn to read and write small parts of
  protocol frames without creating and collecting unnecessary complete request
  and response object graphs. This feature is deployed experimentally and
  enabled by a flag.

as=thrift

- Supports `Meta::health` and `Meta::thriftIDL` endpoints for
  `TChannelAsThrift`.
- Surfaces `TchannelAsThrift#waitForIdentified` to consumers.
- Adds `HyperbahnClient#getThriftSync({serviceName, thriftFile})`.

as=http

- Fixes getHeaders and setHeaders methods for the HTTP argument scheme with
  regard to redundant keys.

# v3.0.0

See [MIGRATION.md][]
