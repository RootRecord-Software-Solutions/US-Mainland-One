# Live Network Activity Globe — Real Data

This build replaces simulated traffic with live local observations and optional AWS inventory telemetry.

## Run

```bash
cd network-globe
./start.sh
```

Open `http://localhost:8090`.

The startup script uses `sudo` so `tcpdump` can capture packet metadata. It never stores packet payloads.

## Automatic data

The server continuously:

- polls `ss` for real outbound/inbound connections
- captures packet metadata with `tcpdump` when run as root
- geolocates public remote IPs and caches results
- detects the local public-network origin
- checks the configured AWS CLI account/region every 30 seconds
- inventories read-only AWS resources in the configured region
- writes state/history automatically into `data/`

## Files written automatically

- `data/state.json`
- `data/history.json`
- `data/geo-cache.json`
- `data/aws-state.json`

## AWS

The AWS collector uses the locally configured AWS CLI credentials. It makes read-only API calls such as STS identity, VPC, ENI, EC2, Lambda, API Gateway, load balancers, RDS, and CloudFormation inventory in the configured region.

It does not modify AWS resources.

## Important visualization limitation

An arc from the local machine to an external IP represents an observed endpoint location. It does not claim that every packet physically traveled in a straight line or that the geolocated point is the exact physical server location.

AWS resource arcs represent the AWS Region where the inventoried resource group exists.
