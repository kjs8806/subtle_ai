export const navigationMarkup = (brand) => `<header class="global-nav wrap">${brand}<nav class="desktop-nav" aria-label="Product navigation"><a href="#overview" aria-current="page">Overview</a><a href="#subscriptions">Subscriptions</a></nav><button class="menu-button" type="button" aria-expanded="false" aria-controls="mobile-menu">Menu</button><nav id="mobile-menu" class="mobile-menu" aria-label="Mobile product navigation" hidden><a href="#overview" aria-current="page">Overview</a><a href="#subscriptions">Subscriptions</a></nav></header>`

export const initializeNavigation = (root) => {
  const button = root.querySelector('.menu-button'); const menu = root.querySelector('.mobile-menu')
  const close = (restore = false) => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); if (restore) button.focus() }
  button.addEventListener('click', () => { const opening = menu.hidden; menu.hidden = !opening; button.setAttribute('aria-expanded', String(opening)); if (opening) menu.querySelector('a').focus() })
  menu.addEventListener('click', () => close())
  menu.addEventListener('focusout', (event) => { if (!menu.contains(event.relatedTarget) && event.relatedTarget !== button) close() })
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) close(true) })
}
