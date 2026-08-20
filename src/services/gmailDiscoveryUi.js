import { feature001Api } from './feature001Api.js'

const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const createDialog = ({ appName, onContinue, onCancel }) => {
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop gmail-disclosure'
  backdrop.hidden = true
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="gmail-disclosure-title" aria-describedby="gmail-disclosure-copy"><button class="modal-close" type="button" aria-label="Close Gmail connection dialog">×</button><p class="eyebrow">Data source</p><h2 id="gmail-disclosure-title">Connect Gmail</h2><p id="gmail-disclosure-copy">${appName} will look for subscription receipts and use matching evidence to create records. Gmail access is separate from sign-in and can be disconnected later.</p><div class="dialog-actions"><button class="form-submit" type="button" data-continue-gmail>Continue to Gmail <span>→</span></button><button class="small-button secondary-action" type="button" data-cancel-gmail>Not now</button></div></section>`
  document.body.append(backdrop)
  let returnFocus = null
  const close = (reason = 'cancelled') => {
    backdrop.hidden = true
    document.querySelector('.app-shell').inert = false
    if (reason === 'cancelled') onCancel()
    returnFocus?.focus()
  }
  const open = (trigger) => {
    returnFocus = trigger
    backdrop.hidden = false
    document.querySelector('.app-shell').inert = true
    backdrop.querySelector('.modal-close').focus()
  }
  backdrop.querySelector('.modal-close').addEventListener('click', () => close())
  backdrop.querySelector('[data-cancel-gmail]').addEventListener('click', () => close())
  backdrop.querySelector('[data-continue-gmail]').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true
    await onContinue(() => close('continue'))
    event.currentTarget.disabled = false
  })
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return close()
    if (event.key !== 'Tab') return
    const focusable = [...backdrop.querySelectorAll(focusableSelector)]
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  })
  return { open, close }
}

export const initGmailDiscovery = ({ appName, onSubscriptions, onReview }) => {
  const source = document.querySelector('.sources-card .source-row:first-of-type')
  const message = source.querySelector('div span')
  const status = source.querySelector('.connected')
  const primary = document.querySelector('.sources-card .connect-button')
  const controls = document.createElement('div')
  controls.className = 'gmail-controls'
  const disconnect = document.createElement('button')
  disconnect.className = 'source-add gmail-disconnect'
  disconnect.type = 'button'
  disconnect.textContent = 'Disconnect'
  disconnect.hidden = true
  controls.append(disconnect)
  primary.after(controls)
  const live = document.createElement('p')
  live.className = 'sr-only'
  live.setAttribute('role', 'status')
  live.setAttribute('aria-live', 'polite')
  source.after(live)
  let connected = false
  let lastRecords = []

  const setState = (state, copy, action = 'connect') => {
    status.textContent = state
    status.dataset.state = state.toLowerCase().replaceAll(' ', '_')
    message.textContent = copy
    live.textContent = `${state}. ${copy}`
    primary.dataset.gmailAction = action
    primary.disabled = action === 'busy' || action === 'disabled'
    primary.textContent = action === 'scan' ? 'Scan receipts' : action === 'reconnect' ? 'Reconnect Gmail' : action === 'busy' ? 'Please wait…' : 'Connect Gmail'
    disconnect.hidden = !connected
  }

  const loadRecords = async () => {
    lastRecords = (await feature001Api.listSubscriptions()).subscriptions
    onSubscriptions(lastRecords)
    return lastRecords
  }

  const scan = async () => {
    setState('Scanning', 'Looking for qualifying receipts…', 'busy')
    try {
      const result = await feature001Api.scan()
      const records = await loadRecords()
      if (result.ambiguous) setState('Connected', 'Receipt needs review; no subscriptions were merged.', 'scan')
      else if (!result.found) setState('Connected', 'No supported subscription receipt found.', 'scan')
      else {
        setState('Connected', `${result.found} subscription found.`, 'scan')
        const review = document.createElement('button')
        review.type = 'button'
        review.className = 'source-add gmail-review'
        review.textContent = 'Review subscription'
        review.addEventListener('click', () => onReview(records.at(-1)?.id))
        controls.querySelector('.gmail-review')?.remove()
        controls.prepend(review)
      }
    } catch (error) {
      if (error.code === 'reconnect_required' || error.status === 401) {
        connected = false
        setState('Reconnect required', 'Gmail permission expired. Reconnect to scan.', 'reconnect')
      } else setState('Scan failed', `${error.message}. Try again.`, 'scan')
    }
  }

  const authorize = async (close) => {
    setState('Authorizing', 'Waiting for Gmail authorization…', 'busy')
    try {
      const authorization = await feature001Api.startAuthorization()
      await feature001Api.completeAuthorization(authorization.url)
      connected = true
      close()
      setState('Connected', 'Ready to scan receipts.', 'scan')
      await scan()
    } catch (error) {
      close()
      connected = false
      const cancelled = error.code === 'cancelled'
      setState(cancelled ? 'Authorization cancelled' : 'Authorization failed', cancelled ? 'Gmail was not connected.' : 'We could not connect Gmail. Try again.', 'connect')
    }
  }

  const dialog = createDialog({ appName, onContinue: authorize, onCancel: () => setState('Authorization cancelled', 'Gmail was not connected.', 'connect') })
  primary.addEventListener('click', () => {
    if (primary.dataset.gmailAction === 'scan') return scan()
    dialog.open(primary)
  })
  disconnect.addEventListener('click', async () => {
    await feature001Api.disconnect()
    connected = false
    controls.querySelector('.gmail-review')?.remove()
    setState('Disconnected', 'Connect to discover receipts.', 'connect')
  })

  setState('Disconnected', 'Connect to discover receipts.', 'connect')
  ;(async () => {
    try {
      const session = await feature001Api.getSession()
      if (!session.authenticated) return
      const current = await feature001Api.getSource()
      if (current.status === 'connected') {
        connected = true
        setState('Connected', current.lastScanAt ? 'Previous Gmail connection restored.' : 'Ready to scan receipts.', 'scan')
        await loadRecords()
      } else if (current.status === 'reconnect_required') setState('Reconnect required', 'Gmail permission expired. Reconnect to scan.', 'reconnect')
    } catch { setState('Disconnected', 'Connect to discover receipts.', 'connect') }
  })()
}