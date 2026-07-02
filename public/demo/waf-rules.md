We run an AWS Web Application Firewall (WAF) directly ahead of our Application Load Balancer to protect against common web attacks and traffic floods.

## Active Rule Sets
- **OWASP Top 10 Protection**: Blocks known SQL injection, cross-site scripting (XSS), and local file inclusion patterns.
- **Geo-Blocking**: RESTRICTS ingress from high-risk IP ranges.
- **Rate-Limiting**: Blocks any single IP address issuing more than 2,000 requests per minute.

See also:
- [Load Balancer Routing](load-balancer.md)
- [API Rate Limiting](api-rate-limiting.txt)