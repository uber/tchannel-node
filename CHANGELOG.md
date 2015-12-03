# v3.6.0

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
