# Extending

## Additional telemetry agents

A future version can accept signed agent events from machines you control. Those machines can become true measurement points in the globe.

## Deeper network path visibility

Traceroute/MTR can add estimated intermediate hops. VPC Flow Logs can add AWS-side observed traffic where enabled.

## Security

The default server binds to `127.0.0.1`. Change `HOST` deliberately if exposing it on a LAN or behind a reverse proxy.
