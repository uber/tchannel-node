# Valid hostPorts

## What is a valid host

A valid host must be a string containing an IPv4 address.
The IPv4 address is formatted as `{n}.{n}.{n}.{n}` where `n` is a valid integer.

If the host is non-ephemeral then it must NOT be `0.0.0.0`

## What is a valid port

A valid port must be a integer representing the port.
The integer must be between 0 and 65536.

If the port is non-ephemeral then it must NOT be `0`

## What is a valid host:port

A valid host:port must be a string containing both the host and port
The string must be formatted as `{host}:{port}` and must follow
the host and port rules.

If the host:port is non-ephemeral then it must NOT contain the IP
`0.0.0.0` and must NOT contain the port `0`
