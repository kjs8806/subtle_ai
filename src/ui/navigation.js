import { routePath } from './router.js'

const icon = (path) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`

export const NAV_ICONS = {
  overview: icon('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  subscriptions: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 14h4"/>'),
  attention: icon('<path d="M12 3a5 5 0 0 0-5 5v3.2c0 .6-.24 1.17-.66 1.6L4.6 14.5A1 1 0 0 0 5.3 16h13.4a1 1 0 0 0 .7-1.5l-1.74-1.7a2.3 2.3 0 0 1-.66-1.6V8a5 5 0 0 0-5-5Z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/>'),
  sources: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.96 19a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.24 1.7 1.7 0 0 0 10.04 2.68V2.5a2 2 0 1 1 4 0v.09c0 .66.39 1.25 1 1.51.61.26 1.32.13 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.47.47-.6 1.18-.34 1.87.25.6.83 1 1.49 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.24.4-1.5 1Z"/>'),
  chevron: icon('<path d="m9 6 6 6-6 6"/>'),
  back: icon('<path d="m15 6-6 6 6 6"/>'),
  menu: icon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: icon('<path d="M6 6l12 12M18 6 6 18"/>'),
}

const NAV_ITEMS = [
  { route: 'overview', label: 'Overview', icon: NAV_ICONS.overview },
  { route: 'subscriptions', label: 'Subscriptions', icon: NAV_ICONS.subscriptions },
  { route: 'attention', label: 'Worth your attention', icon: NAV_ICONS.attention, badgeKey: 'attentionCount' },
  { route: 'sources', label: 'Sources', icon: NAV_ICONS.sources },
  { route: 'settings', label: 'Settings', icon: NAV_ICONS.settings },
]

// A subscription-detail route is still "under" Subscriptions for nav-highlight
// purposes - the sidebar has no entry of its own for it.
const NAV_ROUTE_FOR = { 'subscription-detail': 'subscriptions' }

const navLink = (item, activeRoute, attentionCount) => {
  const badge = item.badgeKey && attentionCount ? `<span class="nav-badge">${attentionCount}</span>` : ''
  const isActive = (NAV_ROUTE_FOR[activeRoute] || activeRoute) === item.route
  return `<a href="#${routePath(item.route)}" data-route-link="${item.route}"${isActive ? ' aria-current="page"' : ''}>${item.icon}<span>${item.label}</span>${badge}</a>`
}

// The sidebar is persistent chrome, not a table of contents: every entry is a
// real route link (routePath -> a distinct #/... hash), not an anchor into a
// single long page. initializeNavigation only wires the mobile drawer and
// active-link state; main.js's router owns swapping the actual page content.
export const navigationMarkup = (brand, { activeRoute = 'overview', attentionCount } = {}) => {
  const links = NAV_ITEMS.map((item) => navLink(item, activeRoute, attentionCount)).join('')
  return `<aside class="sidebar" aria-label="Primary"><div class="sidebar-brand">${brand}</div><nav class="sidebar-nav" aria-label="Product navigation">${links}</nav><div class="sidebar-footer" data-sidebar-footer></div></aside><header class="mobile-topbar">${brand}<button class="menu-button" type="button" aria-expanded="false" aria-controls="mobile-menu" aria-label="Menu">${NAV_ICONS.menu}</button></header><nav id="mobile-menu" class="mobile-menu" aria-label="Mobile product navigation" hidden><div class="sidebar-brand">${brand}</div><nav class="sidebar-nav" aria-label="Product navigation">${links}</nav></nav>`
}

export const initializeNavigation = (root) => {
  const button = root.querySelector('.menu-button'); const menu = root.querySelector('.mobile-menu')
  const setOpen = (opening) => {
    button.setAttribute('aria-expanded', String(opening))
    button.setAttribute('aria-label', opening ? 'Close menu' : 'Menu')
    button.innerHTML = opening ? NAV_ICONS.close : NAV_ICONS.menu
  }
  const close = (restore = false) => { menu.hidden = true; setOpen(false); if (restore) button.focus() }
  button.addEventListener('click', () => { const opening = menu.hidden; menu.hidden = !opening; setOpen(opening); if (opening) menu.querySelector('a').focus() })
  menu.addEventListener('click', (event) => { if (event.target.closest('a')) close() })
  menu.addEventListener('focusout', (event) => { if (!menu.contains(event.relatedTarget) && event.relatedTarget !== button) close() })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) close(true) })
}
