// Minimal hash-based client-side router. Hash routing (rather than History API
// pushState) means every route "just works" on a hard refresh or a pasted
// deep link with zero server-side changes - the browser always loads
// index.html first, then this file reads location.hash - and Back/Forward
// behave normally because hash changes are ordinary history entries.
const ROUTES = [
  { name: 'subscription-detail', pattern: /^\/subscriptions\/([^/]+)$/, paramNames: ['id'] },
  { name: 'subscriptions', pattern: /^\/subscriptions$/, paramNames: [] },
  { name: 'attention', pattern: /^\/attention$/, paramNames: [] },
  { name: 'sources', pattern: /^\/sources$/, paramNames: [] },
  { name: 'settings', pattern: /^\/settings$/, paramNames: [] },
  { name: 'overview', pattern: /^\/overview$/, paramNames: [] },
]

export const routePath = (name, params = {}) => {
  if (name === 'subscription-detail') return `/subscriptions/${encodeURIComponent(params.id)}`
  return `/${name}`
}

// `hash` defaults to the real browser location so callers in the app never
// pass it explicitly; the default expression is only evaluated when the
// parameter is omitted, which is what lets this stay unit-testable (pass an
// explicit hash string) in a plain Node test environment with no `location`.
export const currentRoute = (hash = location.hash) => {
  const raw = (hash || '').replace(/^#/, '') || '/overview'
  const path = raw.split('?')[0]
  for (const route of ROUTES) {
    const match = path.match(route.pattern)
    if (match) return { name: route.name, params: Object.fromEntries(route.paramNames.map((param, index) => [param, decodeURIComponent(match[index + 1])])) }
  }
  return { name: 'overview', params: {} }
}

export const navigate = (name, params = {}) => { location.hash = routePath(name, params) }

export const onRouteChange = (handler) => window.addEventListener('hashchange', handler)
