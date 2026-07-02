To ensure fast asset loading for our global users, Nimbus Labs utilizes Amazon CloudFront as our Content Delivery Network (CDN). CloudFront handles edge caching for static assets, JavaScript bundles, and images.

## Cache Invalidation
Whenever a new frontend release is deployed, cache invalidation is triggered in our CI/CD pipeline.
- Assets under `/assets/*` are hashed (e.g., `index-DJBlxQhD.js`) and have a 1-year TTL.
- The main `index.html` is never cached at the CDN level (`Cache-Control: no-store`).

## Security Policies
We enforce HTTPS-only connections at the CDN edge using ACM SSL/TLS certificates.
See also:
- [VPC Configuration](vpc-config.md)
- [Deploy Guide](deploy-guide.md)