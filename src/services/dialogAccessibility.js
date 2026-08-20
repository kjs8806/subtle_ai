const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export const improveExistingDialogs = () => {
  let trigger = null
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-modal], [data-subscription-id], [data-action-target]')) trigger = event.target.closest('button, a')
  }, true)
  for (const backdrop of document.querySelectorAll('#app > .modal-backdrop, .detail-backdrop')) {
    const dialog = backdrop.querySelector('[role="dialog"]')
    const observer = new MutationObserver(() => {
      document.querySelector('.app-shell').inert = !backdrop.hidden
      if (!backdrop.hidden) (backdrop.querySelector('input') || backdrop.querySelector('.modal-close'))?.focus()
      else trigger?.focus()
    })
    observer.observe(backdrop, { attributes: true, attributeFilter: ['hidden'] })
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        backdrop.hidden = true
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll(focusableSelector)]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    })
  }
}