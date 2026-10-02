# Architecture

```text
Linux sockets + tcpdump            AWS CLI
        |                               |
        v                               v
  flow collector                 AWS inventory collector
        |                               |
        +-----------> state ------------+
                       |
                       v
                    index.html
                       |
                       v
                   globe.gl
```

The browser polls `/api/state` once per second. The server is responsible for collecting and persisting data.
