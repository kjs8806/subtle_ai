export const createLiveRegion = () => {
  const region = document.createElement('div')
  region.className = 'sr-only'
  region.dataset.liveRegion = ''
  region.setAttribute('aria-live', 'polite')
  region.setAttribute('aria-atomic', 'true')
  document.body.append(region)
  return { announce(message) { region.textContent = ''; requestAnimationFrame(() => { region.textContent = message }) } }
}

export const createDialogController = (backdrop) => {
  let trigger = null
  const dialog = backdrop.querySelector('[role="dialog"]')
  const focusable = () => [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
  const close = () => { backdrop.classList.remove('is-open'); backdrop.hidden = true; trigger?.focus(); trigger = null }
  const open = (opener) => { trigger = opener || document.activeElement; backdrop.hidden = false; requestAnimationFrame(() => backdrop.classList.add('is-open')); focusable()[0]?.focus() }
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Tab') return
    const items = focusable(); if (!items.length) return
    const first = items[0]; const last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  })
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop || event.target.closest('[data-close-dialog]')) close() })
  return { open, close }
}
