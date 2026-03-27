# J-Circuit Performance Optimization Checklist (EN)

## Implemented

1. Code-splitting & lazy load
- Route-level splitting via `React.lazy` + `Suspense`
- On-demand page/component loading

2. Image optimization
- Prefer WebP via dedicated component
- `loading="lazy"` for images

3. Fonts
- `font-display: swap` to avoid FOIT

4. CSS
- Use `contain: layout` to reduce layout work
- Smooth scrolling, reduced motion preferences

5. Components
- Keep files small (< 300 lines)
- Functional components & hooks
- Efficient list rendering via `key`

6. State Management
- Lightweight state via Zustand
- Avoid unnecessary updates/rerenders

## Targets

- Lighthouse ≥ 90
- FCP < 1.8s
- LCP < 2.5s
- CLS < 0.1
- FID < 100ms

## Verification To-Dos

1. Bundle size
- `npm run build` to inspect bundle sizes
- Analyze dependencies with `webpack-bundle-analyzer`

2. Runtime perf
- Use Chrome DevTools Performance panel
- Inspect render timings & memory

3. Network perf
- Verify image lazy load
- Check font loading
- Confirm code splitting

## Recommendations

1. Images
- CDN delivery
- Responsive variants
- Preload strategy

2. Caching
- Service Worker for offline cache
- Optimize HTTP cache headers
- Data caching strategies

3. Code
- `React.memo` for expensive re-renders
- Virtualization for large lists
- Audit third-party libs

4. Build
- Gzip/Brotli compression
- Optimize chunking
- Aggressive tree-shaking

## Monitoring

- Integrate RUM & performance monitoring (e.g., Sentry Performance)
- Set performance budgets & alerts
- Run Lighthouse CI regularly
