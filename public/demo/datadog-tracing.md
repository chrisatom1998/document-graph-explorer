For deep inspection of multi-service request pathways, Nimbus Labs uses Datadog APM (Application Performance Monitoring). Distributed tracing is injected into our Node.js and Go microservices.

## Trace Propagation
We propagate correlation IDs (Request IDs) across services using HTTP headers. This allows tracing a single client request from the API Gateway, through the Auth Service, into our databases, and onto Kafka.

## Performance Analysis
Traces help identify slow database queries, microservice latency bottlenecks, and network overhead.
See also:
- [Auth Service](auth-service.md)
- [Kafka Event Bus](kafka-event-bus.md)
- [API Rate Limiting](api-rate-limiting.txt)