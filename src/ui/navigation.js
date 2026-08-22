const icon = (path) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`

export const NAV_ICONS = {
  overview: icon('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  subscriptions: icon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M7 14h4"/>'),
  attention: icon('<path d="M12 3a5 5 0 0 0-5 5v3.2c0 .6-.24 1.17-.66 1.6L4.6 14.5A1 1 0 0 0 5.3 16h13.4a1 1 0 0 0 .7-1.5l-1.74-1.7a2.3 2.3 0 0 1-.66-1.6V8a5 5 0 0 0-5-5Z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/>'),
  sources: icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  settings: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.96 19a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.24 1.7 1.7 0 0 0 10.04 2.68V2.5a2 2 0 1 1 4 0v.09c0 .66.39 1.25 1 1.51.61.26 1.32.13 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06c-.47.47-.6 1.18-.34 1.87.25.6.83 1 1.49 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.24.4-1.5 1Z"/>'),
  chevron: icon('<path d="m9 6 6 6-6 6"/>'),
}

const NAV_ITEMS = [
  { href: '#overview', label: 'Overview', icon: NAV_ICONS.overview },
  { href: '#subscriptions', label: 'Subscriptions', icon: NAV_ICONS.subscriptions },
  { href: '#candidates-review', label: 'Worth your attention', icon: NAV_ICONS.attention, badgeKey: 'attentionCount' },
  { href: '#sources', label: 'Sources', icon: NAV_ICONS.sources },
  { href: '#settings', label: 'Settings', icon: NAV_ICONS.settings },
]

const navLink = (item, attentionCount) => {
  const badge = item.badgeKey && attentionCount ? `<span class="nav-badge">${attentionCount}</span>` : ''
  const current = item.href === '#overview' ? ' aria-current="page"' : ''
  return `<a href="${item.href}"${current}>${item.icon}<span>${item.label}</span>${badge}</a>`
}

// Top-level nav is anchor-scroll to sections within the single authenticated
// page (no client-side router) - kept from the prior implementation so
// dialog/event wiring in main.js does not need a routing rewrite.
// `brand` is already a complete <a class="brand">...</a> element (defined
// once in main.js); it is only ever wrapped in non-interactive containers
// here, never re-wrapped in another <a>, to avoid nested interactive elements.
export const navigationMarkup = (brand, { attentionCount } = {}) => {
  const links = NAV_ITEMS.map((item) => navLink(item, attentionCount)).join('')
  return `<aside class="sidebar" aria-label="Primary"><div class="sidebar-brand">${brand}</div><nav class="sidebar-nav" aria-label="Product navigation">${links}</nav><div class="sidebar-footer" data-sidebar-footer></div></aside><header class="mobile-topbar">${brand}<button class="menu-button" type="button" aria-expanded="false" aria-controls="mobile-menu">Menu</button></header><nav id="mobile-menu" class="mobile-menu" aria-label="Mobile product navigation" hidden><div class="sidebar-brand">${brand}</div><nav class="sidebar-nav" aria-label="Product navigation">${links}</nav></nav>`
}

export const initializeNavigation = (root) => {
  const button = root.querySelector('.menu-button'); const menu = root.querySelector('.mobile-menu')
  const close = (restore = false) => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); if (restore) button.focus() }
  button.addEventListener('click', () => { const opening = menu.hidden; menu.hidden = !opening; button.setAttribute('aria-expanded', String(opening)); if (opening) menu.querySelector('a').focus() })
  menu.addEventListener('click', (event) => { if (event.target.closest('a')) close() })
  menu.addEventListener('focusout', (event) => { if (!menu.contains(event.relatedTarget) && event.relatedTarget !== button) close() })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) close(true) })

  // Highlight the nav link matching the section currently in view, since
  // navigation is anchor-scroll within one page rather than routed views.
  const sections = NAV_ITEMS.map(item => document.querySelector(item.href)).filter(Boolean)
  const allLinks = () => root.querySelectorAll('.sidebar-nav a')
  const setCurrent = (hash) => {
    allLinks().forEach((link) => {
      if (link.getAttribute('href') === hash) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    })
  }
  if (sections.length && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) setCurrent(`#${visible.target.id}`)
    }, { rootMargin: '-15% 0px -70% 0px' })
    sections.forEach(section => observer.observe(section))
  }
}
