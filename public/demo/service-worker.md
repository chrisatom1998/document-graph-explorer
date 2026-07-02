We utilize a Service Worker to enable offline capability and local asset caching.

## Precaching Strategy
During build time, Vite registers a list of hashed assets in the service worker cache.
- Dynamic network requests are handled using a Network-First caching strategy.
- Cache size is limited to avoid exhausting browser storage capacity.

See also:
- [Bundle Size Optimization](bundle-optimization.md)
- [CDN Caching](cdn-caching.md)