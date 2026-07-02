A slow-loading app hurts conversion rates. We keep our JavaScript bundle sizes under strict budget constraints.

## Techniques
- **Dynamic Imports**: Use React lazy-loading or dynamic imports for large libraries (e.g. PDF parsing, Three.js).
- **Tree Shaking**: Ensure third-party libraries use ES module exports to allow bundlers to strip dead code.
- **Asset Compression**: Compress SVG files using SVGO and build outputs using Gzip or Brotli.

See also:
- [Vite Config](vite.config.ts)
- [Web Performance Metrics](web-performance.md)