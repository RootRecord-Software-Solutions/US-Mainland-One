# Hawaii telemetry merge — live AWS build

This is the live AWS Network Globe with the Hawaii data stream merged into the existing `server.js` poller.

## Deployment location

The AWS-side project mirror is:

`/home/rootrecord/.ollama/skills/aws-sync/mirror/network-globe`

Deploy the contents of this ZIP over the live AWS Network Globe project. The existing `index.html`, package files, and data directory are retained; the important application change is the modified `server.js`.

## Hawaii stream

The Hawaii collector SSH-writes NDJSON to:

`data/hawaii.ndjson`

The existing AWS `server.js` polls that file every `HAWAII_POLL_MS` milliseconds (default 2000), parses new records, maintains a five-minute Hawaii flow retention window after the last observation, and appends Hawaii arcs to the **same `arcs` array** used by the AWS/local collector.

There is no separate Hawaii visualizer or Hawaii API dataset.

The existing `/api/state` therefore exposes one combined payload:

- AWS/local observed flows
- Hawaii observed flows
- AWS inventory/resource arcs

Hawaii flows retain `sourceNode`, `sourceRegion`, and `sourceLabel` metadata so the origin can be identified without creating a separate visual layer.

## Files added/used

- `data/hawaii.ndjson` — created automatically by the SSH stream.
- `data/hawaii-offset.json` — created automatically; stores the byte offset and incomplete final line while the poller consumes the stream.

Do not delete `hawaii-offset.json` while the service is running unless you intentionally want the stream file replayed from byte zero.

## Configuration

Optional environment variables:

```bash
HAWAII_POLL_MS=2000
HAWAII_FLOW_TTL_MS=300000
```

No new npm dependency is required.

## Important

The Hawaii collector sends only connection/packet metadata. It does not send packet payloads.

IP geolocation remains approximate, just as for the existing AWS/local collector.
