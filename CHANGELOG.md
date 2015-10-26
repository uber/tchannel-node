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
