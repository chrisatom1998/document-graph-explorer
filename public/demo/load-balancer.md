All client requests ingress through our AWS Application Load Balancers (ALB). The load balancers terminate SSL certificates and distribute traffic to target groups.

## Routing Rules
Requests are routed based on path-based rules:
- `/api/auth/*` -> routed to the `auth-service` target group.
- `/api/*` -> routed to the `api-gateway` target group.
- `/*` -> routed to the static asset bucket / frontend target.

## Health Checks
ALB target groups probe target nodes on `/healthz` every 15 seconds. If two consecutive checks fail, the node is marked unhealthy.
See also:
- [VPC Configuration](vpc-config.md)
- [Auth Service](auth-service.md)