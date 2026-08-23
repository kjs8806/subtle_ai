import './style.css'
import { feature001Api } from './services/feature001Api.js'
import { toDisplayItem, toManualDisplayItem } from './services/subscriptionMapper.js'
import { monthlySpendFor } from './data/subscriptionModel.js'
import { createDialogController, createLiveRegion } from './ui/accessibility.js'
import { gmailDisclosureMarkup } from './ui/gmailDisclosure.js'
import { initializeNavigation, NAV_ICONS, navigationMarkup } from './ui/navigation.js'
import { currentRoute, navigate, onRouteChange, routePath } from './ui/router.js'
import { overviewMarkup } from './ui/overview.js'
import { filterAndSortSubscriptions, renderSubscriptionRows, subscriptionsPageMarkup } from './ui/subscriptions.js'
import { attentionDetailDialogMarkup, attentionPageMarkup, filterAttentionItems, renderAttentionDetail, renderAttentionList, sortAttentionItems } from './ui/attention.js'
import { buildActionItems } from './services/recommendationEngine.js'
import { sourcesPageMarkup } from './ui/sources.js'
import { settingsPageMarkup } from './ui/settings.js'
import { collectChangedCorrections, correctionDialogMarkup, detailMarkup, rejectConfirmMarkup, renderCorrectionDialog, renderDetail, wireCorrectionDialogInteractions } from './ui/subscriptionDetail.js'
import { loadingMarkup, sessionErrorMarkup, signedOutMarkup } from './ui/signedOut.js'

const APP_CONFIG = { name: 'Subtle AI', tagline: 'Your AI subscription optimizer' }
const brandMark = `<img class="brand-mark" src="/icon.png" width="32" height="32" alt="" aria-hidden="true">`
const brandWordmark = `<img class="brand-wordmark" src="/wordmark.png" width="97" height="20" alt="${APP_CONFIG.name}">`
const brand = `<a class="brand" href="#${routePath('overview')}" aria-label="${APP_CONFIG.name} home">${brandMark}<span class="brand-text">${brandWordmark}<span class="brand-tagline">${APP_CONFIG.tagline}</span></span></a>`
const shellHeader = (rightContent = '') => `<header class="pre-auth-header wrap">${brand}${rightContent}</header>`
const addDialogMarkup = `<div class="dialog-backdrop" data-add-dialog hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><p class="eyebrow">Manual entry</p><h2 id="add-title">Add a subscription</h2><form class="subscription-form"><label>Service name<input name="name" placeholder="e.g. Netflix" required></label><div class="form-row"><label>Cost<input name="cost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="22.99" required></label><label>Billing cadence<select name="cadence"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label></div><button class="primary-button form-submit" type="submit">Add to overview</button></form></section></div>`

// Sidebar footer summary (mini Gmail status + account link). Kept read-only
// (no independent scan/connect controls) so the interactive Gmail source
// control stays a single instance - see the Sources page - avoiding two
// independently-wired copies of the same async control.
const sidebarFooterMarkup = (user, gmailSource) => {
  const connected = gmailSource?.status === 'connected'
  const lastScan = gmailSource?.lastScanAt ? new Date(gmailSource.lastScanAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  const initials = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase()
  return `<div class="sidebar-source-card"><span class="source-icon">${NAV_ICONS.sources}</span><span class="who"><strong>${connected ? 'Gmail connected' : 'Gmail not connected'}</strong><p>${connected ? (lastScan ? `Last scan: ${lastScan}` : 'Ready to scan') : 'Connect from Sources'}</p></span></div><a class="sidebar-user" href="#${routePath('settings')}"><span class="avatar">${initials}</span><span class="who"><strong>${user?.name || 'Account'}</strong><span>${user?.email || ''}</span></span>${NAV_ICONS.chevron}</a>`
}

document.title = APP_CONFIG.name
const app = document.querySelector('#app')
const live = createLiveRegion()

// The OAuth callbacks are reached via a real top-level browser navigation (see
// server/app.js), so they redirect back to '/' with the outcome carried as a
// query param rather than a JSON body the frontend could read directly. This
// reads that signal once on boot and strips it so a page refresh doesn't
// re-show a stale error.
const AUTH_ERROR_MESSAGES = {
  invalid_oauth_state: 'That sign-in attempt expired or was invalid. Please try again.',
  missing_subject: "Google sign-in didn't return the information we needed. Please try again.",
  cancelled: 'Sign-in was cancelled.',
}
const GMAIL_ERROR_MESSAGES = {
  invalid_oauth_state: 'That connection attempt expired or was invalid. Please try again.',
  identity_mismatch: 'The Gmail account you selected does not match the Google account you signed in with.',
  missing_refresh_token: 'Gmail did not grant access. Please try connecting again.',
  cancelled: 'Gmail connection was cancelled.',
}
const consumeRedirectSignal = () => {
  const params = new URLSearchParams(location.search)
  const authError = params.get('auth_error')
  const gmailError = params.get('gmail_error')
  if (authError || gmailError) history.replaceState(null, '', location.pathname + location.hash)
  return { authError, gmailError }
}

const renderSessionError = (message) => {
  app.innerHTML = shellHeader() + sessionErrorMarkup(message)
  const retry = document.querySelector('[data-retry-session]')
  retry.addEventListener('click', boot)
  retry.focus()
}

const renderSignedOut = (initialError) => {
  // Unlike the other pre-auth screens, this one has real content above the
  // fold - an in-page link to the feature section below, not a route that
  // doesn't exist yet.
  app.innerHTML = shellHeader(`<a class="pre-auth-learn-more" href="#learn-more">Learn more about ${APP_CONFIG.name} <span aria-hidden="true">→</span></a>`) + signedOutMarkup()
  const button = document.querySelector('[data-google-sign-in]')
  const errorEl = document.querySelector('[data-session-error]')
  if (initialError) { errorEl.hidden = false; errorEl.textContent = initialError; errorEl.scrollIntoView({ block: 'center' }) }
  // No longer auto-focused: the old minimal screen had nothing else on it,
  // but this one has a full marketing page above the sign-in card, and
  // yanking focus straight to the button would skip a sighted-keyboard or
  // screen-reader user past all of it.
  button.addEventListener('click', async () => {
    button.disabled = true
    errorEl.hidden = true
    try {
      const { url } = await feature001Api.startGoogleSignIn()
      if (!url) throw new Error('No authorization URL returned')
      window.location.href = url
    } catch {
      errorEl.hidden = false
      errorEl.textContent = "Sign-in couldn't start. Please try again."
      button.disabled = false
    }
  })
}

const renderAuthenticated = async (user, gmailError) => {
  // Manual entries are frontend-only (no manual-subscription API exists), so
  // they're tracked separately from backend-sourced ones and always re-merged
  // - a Gmail-triggered refresh must never make them disappear.
  let manualSubscriptions = []
  let backendItems = []
  let candidates = []
  let gmailSource = { status: 'not_connected', scanStatus: 'idle' }
  let gmailSourceUnavailable = false
  // Derived from backendItems' retained raw records (toDisplayItem stashes
  // the full backend subscription as item.pipelineRecord) via the overlap-
  // detection engine (src/services/recommendationEngine.js). Price-change
  // detection now lives server-side (FEATURE-003, see attentionItems below) -
  // this only covers overlap, which predates it and isn't part of its scope.
  // Recomputed via refreshOverlapActions() wherever backendItems changes.
  let overlapActions = []
  const refreshOverlapActions = () => { overlapActions = buildActionItems(backendItems.map(item => item.pipelineRecord).filter(Boolean)) }

  // FEATURE-003: the unified, server-computed "Worth your attention" list
  // (price changes, renewals, and FEATURE-002's ambiguous-candidate review,
  // already sorted and durable - see GET /api/v1/attention). `candidates`
  // above is still fetched separately because a needs_review attention item
  // only carries a candidateId; rendering its full card (evidence count,
  // raw merchant) needs the full candidate record, looked up by that id.
  let attentionItems = []
  const candidatesById = () => new Map(candidates.map(candidate => [candidate.id, candidate]))
  const refreshAttentionItems = async () => { try { attentionItems = (await feature001Api.getAttentionItems()).items || [] } catch { /* the page just keeps showing its last known state */ } }

  const [subsResult, sourceResult, candidatesResult, attentionResult] = await Promise.allSettled([
    feature001Api.listSubscriptions(),
    feature001Api.getGmailSource(),
    feature001Api.listCandidates(),
    feature001Api.getAttentionItems(),
  ])
  if (subsResult.status === 'fulfilled') backendItems = (subsResult.value.subscriptions || []).map(toDisplayItem)
  if (sourceResult.status === 'fulfilled') gmailSource = sourceResult.value
  else gmailSourceUnavailable = true
  if (candidatesResult.status === 'fulfilled') candidates = candidatesResult.value.candidates || []
  if (attentionResult.status === 'fulfilled') attentionItems = attentionResult.value.items || []
  refreshOverlapActions()

  const greeting = user?.name ? `Good morning, ${user.name.split(' ')[0]}.` : 'Good morning.'
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const allItems = () => [...manualSubscriptions, ...backendItems]
  const findSubscription = id => allItems().find(item => String(item.id) === String(id))
  const attentionTotal = () => attentionItems.length + overlapActions.length

  // ---- persistent shell (sidebar, dialogs, footer) -----------------------
  app.innerHTML = `<div class="app-shell">${navigationMarkup(brand, { activeRoute: currentRoute().name, attentionCount: attentionTotal() })}<div class="main-col"><div data-page-root></div></div></div>${gmailDisclosureMarkup()}${correctionDialogMarkup()}${rejectConfirmMarkup()}${addDialogMarkup}${attentionDetailDialogMarkup()}`
  initializeNavigation(app)

  const pageRoot = document.querySelector('[data-page-root]')
  const gmailRoot = document.querySelector('[data-gmail-dialog]'); const gmailDialog = createDialogController(gmailRoot)
  const addRoot = document.querySelector('[data-add-dialog]'); const addDialog = createDialogController(addRoot)
  const correctionRoot = document.querySelector('[data-correction-dialog]'); const correctionDialog = createDialogController(correctionRoot)
  wireCorrectionDialogInteractions(correctionRoot)
  const rejectRoot = document.querySelector('[data-reject-dialog]'); const rejectDialog = createDialogController(rejectRoot)
  const attentionRoot = document.querySelector('[data-attention-dialog]'); const attentionDialog = createDialogController(attentionRoot)

  const renderSidebarFooter = () => { const slot = document.querySelector('[data-sidebar-footer]'); if (slot) slot.innerHTML = sidebarFooterMarkup(user, gmailSourceUnavailable ? null : gmailSource) }
  const updateNavActive = (routeName) => {
    const effective = routeName === 'subscription-detail' ? 'subscriptions' : routeName
    document.querySelectorAll('[data-route-link]').forEach(link => {
      if (link.dataset.routeLink === effective) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    })
  }
  const updateAttentionBadge = () => {
    const total = attentionTotal()
    document.querySelectorAll('[data-route-link="attention"]').forEach(link => {
      link.querySelector('.nav-badge')?.remove()
      if (total) link.insertAdjacentHTML('beforeend', `<span class="nav-badge">${total}</span>`)
    })
  }

  // ---- Gmail source state -> live UI, defensive against the Sources page
  // not currently being mounted (querySelector returns null; every update
  // below just no-ops rather than throwing). -------------------------------
  const setGmailState = (state, copy, action, { disabled = false } = {}) => {
    const status = document.querySelector('[data-gmail-status]'); if (!status) return
    const message = document.querySelector('[data-gmail-message]')
    const gmailButton = document.querySelector('[data-gmail-action]')
    const disconnectButton = document.querySelector('[data-gmail-disconnect]')
    status.textContent = state; status.dataset.state = state.toLowerCase().replace(/\s+/g, '-'); message.textContent = copy
    gmailButton.dataset.gmailAction = action
    gmailButton.textContent = action === 'scan' ? 'Scan receipts' : 'Find subscriptions from receipts'
    gmailButton.disabled = disabled
    disconnectButton.hidden = gmailSource.status !== 'connected'
  }
  const applyGmailSource = () => {
    if (gmailSourceUnavailable) setGmailState('Unavailable', "Gmail status couldn't be loaded. Try refreshing the page.", 'connect', { disabled: true })
    else if (gmailSource.status !== 'connected') setGmailState('Not connected', 'Connect to discover receipts', 'connect')
    else if (gmailSource.scanStatus === 'scanning') setGmailState('Scanning', 'Scanning receipts…', 'scan', { disabled: true })
    else if (gmailSource.scanStatus === 'error') setGmailState('Scan error', 'The last scan failed. You can try again.', 'scan')
    else setGmailState('Connected', 'Ready to scan receipts', 'scan')
    renderSidebarFooter()
  }
  const CHECK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>'
  const renderScanResults = (result) => {
    const list = document.querySelector('[data-last-scan-results]'); if (!list) return
    const items = [`${result.found || 0} subscription${result.found === 1 ? '' : 's'} found`]
    if (result.ambiguous) items.push(`${result.ambiguous} need${result.ambiguous === 1 ? 's' : ''} your review`)
    list.innerHTML = items.map(text => `<li>${CHECK_ICON}<span>${text}</span></li>`).join('')
  }
  const showDiscovery = (items) => {
    const discovery = document.querySelector('[data-discovery-result]'); if (!discovery) return
    discovery.hidden = false
    discovery.innerHTML = `<strong>${items.length} subscription${items.length === 1 ? '' : 's'} found.</strong><button class="primary-button" type="button">Review subscription${items.length === 1 ? '' : 's'}</button>`
    discovery.querySelector('button').addEventListener('click', () => items.length === 1 ? navigate('subscription-detail', { id: items[0].id }) : navigate('subscriptions'))
  }

  // ---- route rendering -----------------------------------------------------
  let currentSubscriptionId = null

  const renderSubscriptionDetailRoute = async (id) => {
    const summary = findSubscription(id)
    currentSubscriptionId = null
    if (!summary) {
      pageRoot.innerHTML = `<div class="main-content wrap"><a class="back-link" href="#${routePath('subscriptions')}">${NAV_ICONS.back}Back to Subscriptions</a><p class="empty-state">This subscription could not be found.</p></div>`
      return
    }
    pageRoot.innerHTML = detailMarkup()
    const detailRoot = pageRoot
    let item = summary
    if (summary.remoteId) {
      try { item = toDisplayItem(await feature001Api.getSubscription(summary.remoteId)) }
      catch { live.announce('Latest evidence could not be loaded; showing the last known details.') }
    }
    currentSubscriptionId = item.remoteId || null
    renderDetail(detailRoot, item)
    detailRoot.querySelector('[data-toggle-correction]')?.addEventListener('click', () => {
      renderCorrectionDialog(correctionRoot, item)
      correctionDialog.open(document.activeElement)
    })
    detailRoot.querySelector('[data-open-reject]')?.addEventListener('click', (event) => {
      rejectRoot.querySelector('[data-reject-name]').textContent = item.name
      rejectDialog.open(event.currentTarget)
    })
  }

  const renderRoute = async () => {
    const route = currentRoute()
    updateNavActive(route.name)
    const items = allItems()
    switch (route.name) {
      case 'subscriptions':
        pageRoot.innerHTML = subscriptionsPageMarkup({ subscriptions: items })
        wireSubscriptionsPage(pageRoot, items)
        break
      case 'subscription-detail':
        await renderSubscriptionDetailRoute(route.params.id)
        break
      case 'attention':
        pageRoot.innerHTML = attentionPageMarkup({ items: attentionItems, overlapActions })
        wireAttentionPage(pageRoot)
        break
      case 'sources':
        pageRoot.innerHTML = sourcesPageMarkup()
        wireSourcesPage()
        applyGmailSource()
        if (gmailError) { document.querySelector('[data-gmail-message]').textContent = GMAIL_ERROR_MESSAGES[gmailError] || "Gmail couldn't be connected. Please try again."; live.announce(document.querySelector('[data-gmail-message]').textContent) }
        break
      case 'settings':
        pageRoot.innerHTML = settingsPageMarkup({ user })
        pageRoot.querySelector('[data-sign-out]').addEventListener('click', signOut)
        break
      default:
        pageRoot.innerHTML = overviewMarkup({ subscriptions: items, attentionItems, overlapActions, monthlySpend: monthlySpendFor(items), greeting, dateLabel, gmailSource, gmailSourceUnavailable })
    }
    updateAttentionBadge()
    window.scrollTo(0, 0)
  }

  // ---- Subscriptions page: client-side search/sort/billing-cadence filter
  // over the already-loaded list (no new endpoint - everything filtered here
  // is already on the page). Only the row list re-renders on each change;
  // the toolbar itself is left alone so typing in the search field never
  // loses focus or cursor position.
  const wireSubscriptionsPage = (root, subscriptions) => {
    const state = { query: '', cadence: 'all', sort: 'next-renewal' }
    const apply = () => {
      const filtered = filterAndSortSubscriptions(subscriptions, state)
      renderSubscriptionRows(root, filtered, subscriptions.length > 0)
      const filterCount = root.querySelector('[data-filter-count]')
      filterCount.hidden = state.cadence === 'all'
      filterCount.textContent = '1'
    }
    apply()

    root.querySelector('[data-subscription-search]').addEventListener('input', (event) => { state.query = event.currentTarget.value; apply() })
    root.querySelector('[data-subscription-sort]').addEventListener('change', (event) => { state.sort = event.currentTarget.value; apply() })
    root.querySelectorAll('[data-filter-cadence]').forEach(input => input.addEventListener('change', (event) => { state.cadence = event.currentTarget.value; apply() }))

    const filterButton = root.querySelector('[data-open-filter]')
    const filterPanel = root.querySelector('[data-filter-panel]')
    const closeFilterPanel = () => { filterPanel.hidden = true; filterButton.setAttribute('aria-expanded', 'false') }
    filterButton.addEventListener('click', () => {
      const opening = filterPanel.hidden
      filterPanel.hidden = !opening
      filterButton.setAttribute('aria-expanded', String(opening))
    })
    document.addEventListener('click', (event) => { if (!filterPanel.hidden && !filterPanel.contains(event.target) && event.target !== filterButton && !filterButton.contains(event.target)) closeFilterPanel() })
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !filterPanel.hidden) { closeFilterPanel(); filterButton.focus() } })

    root.querySelectorAll('[data-clear-filters]').forEach(button => button.addEventListener('click', () => {
      state.query = ''; state.cadence = 'all'; state.sort = 'next-renewal'
      root.querySelector('[data-subscription-search]').value = ''
      root.querySelector('[data-subscription-sort]').value = 'next-renewal'
      root.querySelector('[data-filter-cadence][value="all"]').checked = true
      closeFilterPanel()
      apply()
    }))

    root.querySelectorAll('[data-open-add]').forEach(button => button.addEventListener('click', event => addDialog.open(event.currentTarget)))
  }

  // ---- FEATURE-003: Worth your attention - filter tabs/sort over the
  // already-loaded, server-prioritized list (same split-toolbar-from-list
  // pattern as wireSubscriptionsPage), a price-change/renewal card opening
  // the detail dialog, and FEATURE-002's ambiguous-candidate confirm/reject
  // inline on its own card (there is no subscription yet to "review").
  const wireAttentionPage = (root) => {
    const state = { filter: 'all', sort: 'priority' }
    const apply = () => {
      const filtered = sortAttentionItems(filterAttentionItems(attentionItems, state.filter), state.sort)
      renderAttentionList(root, { items: filtered, candidatesById: candidatesById(), hasAnyItems: attentionItems.length > 0 })
      root.querySelectorAll('[data-attention-filter]').forEach(tab => {
        const active = tab.dataset.attentionFilter === state.filter
        tab.classList.toggle('is-active', active)
        tab.setAttribute('aria-selected', String(active))
      })
    }
    apply()

    root.querySelector('[data-attention-tabs]')?.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-attention-filter]')
      if (!tab) return
      state.filter = tab.dataset.attentionFilter
      apply()
    })
    root.querySelector('[data-attention-sort]')?.addEventListener('change', (event) => { state.sort = event.currentTarget.value; apply() })

    root.querySelector('[data-attention-list]')?.addEventListener('click', async (event) => {
      const confirmButton = event.target.closest('[data-confirm-candidate]')
      const rejectButton = event.target.closest('[data-reject-candidate]')
      if (confirmButton || rejectButton) {
        const button = confirmButton || rejectButton
        const candidateId = event.target.closest('[data-candidate-id]')?.dataset.candidateId
        if (!candidateId) return
        button.disabled = true
        try {
          if (confirmButton) { await feature001Api.confirmCandidate(candidateId); live.announce('Subscription confirmed.') }
          else { await feature001Api.rejectCandidate(candidateId); live.announce('Marked as not a subscription.') }
          candidates = candidates.filter(candidate => candidate.id !== candidateId)
          const { subscriptions: rawList } = await feature001Api.listSubscriptions()
          backendItems = (rawList || []).map(toDisplayItem)
          refreshOverlapActions()
          await refreshAttentionItems()
          await renderRoute()
        } catch {
          button.disabled = false
          live.announce("That couldn't be completed. Please try again.")
        }
        return
      }
      const card = event.target.closest('[data-attention-id]')
      if (!card) return
      const item = attentionItems.find(entry => entry.id === card.dataset.attentionId)
      if (!item) return
      renderAttentionDetail(attentionRoot, item)
      attentionDialog.open(card)
    })
  }

  // ---- FEATURE-003: dismissing an attention item, and closing the detail
  // dialog before "Review subscription" navigates away from it.
  attentionRoot.querySelector('[data-attention-detail-body]').addEventListener('click', async (event) => {
    if (event.target.closest('[data-attention-review]')) { attentionDialog.close(); return }
    const dismissButton = event.target.closest('[data-attention-dismiss]')
    if (!dismissButton) return
    const itemKey = dismissButton.dataset.attentionDismissId
    dismissButton.disabled = true
    try {
      await feature001Api.dismissAttentionItem(itemKey)
      attentionItems = attentionItems.filter(item => item.id !== itemKey)
      attentionDialog.close()
      await renderRoute()
      live.announce('Dismissed.')
    } catch {
      dismissButton.disabled = false
      live.announce("That couldn't be completed. Please try again.")
    }
  })

  // ---- FEATURE-002: corrections ("This looks wrong") and "Not a
  // subscription" rejection, both scoped to `currentSubscriptionId`
  // (stamped by renderSubscriptionDetailRoute whenever that route renders).
  // The correction form gathers every changed field, then submits them as
  // separate PATCHes (the API is single-field, per FEATURE-002's existing
  // per-field provenance/conflict handling) - one user "Save changes" click,
  // sequential requests underneath so an untouched field is never touched.
  correctionRoot.querySelector('[data-correction-form]').addEventListener('submit', async (event) => {
    event.preventDefault()
    const errorEl = correctionRoot.querySelector('[data-correction-error]')
    errorEl.hidden = true
    if (!currentSubscriptionId) return
    const changes = collectChangedCorrections(correctionRoot)
    if (!changes.length) { correctionDialog.close(); return }
    const submitButton = correctionRoot.querySelector('[data-correction-submit]')
    submitButton.disabled = true
    let updated = null
    try {
      for (const change of changes) updated = await feature001Api.correctSubscription(currentSubscriptionId, change.field, change.value)
      backendItems = backendItems.map(item => item.remoteId === updated.id ? toDisplayItem(updated) : item)
      refreshOverlapActions()
      await refreshAttentionItems()
      correctionDialog.close()
      await renderRoute()
      live.announce(changes.length === 1 ? 'Correction saved.' : 'Corrections saved.')
    } catch (error) {
      // Whatever succeeded before the failure is already applied server-side -
      // refresh so Subscription Detail reflects that partial progress
      // honestly instead of silently hiding it or claiming nothing saved.
      if (updated) { backendItems = backendItems.map(item => item.remoteId === updated.id ? toDisplayItem(updated) : item); refreshOverlapActions(); await refreshAttentionItems(); await renderRoute() }
      errorEl.hidden = false
      errorEl.textContent = error.message || "That value couldn't be saved. Please try again."
    } finally {
      submitButton.disabled = false
    }
  })
  rejectRoot.querySelector('[data-confirm-reject]').addEventListener('click', async (event) => {
    if (!currentSubscriptionId) return
    event.currentTarget.disabled = true
    try {
      await feature001Api.rejectSubscription(currentSubscriptionId)
      backendItems = backendItems.filter(item => item.remoteId !== currentSubscriptionId)
      refreshOverlapActions()
      await refreshAttentionItems()
      rejectDialog.close()
      live.announce('No longer counted as an active subscription.')
      navigate('subscriptions')
    } catch {
      live.announce("That couldn't be completed. Please try again.")
    } finally {
      event.currentTarget.disabled = false
    }
  })

  const signOut = async (event) => {
    event.currentTarget.disabled = true
    try { await feature001Api.logout() } catch { /* session cookie is cleared server-side regardless of network hiccups on our end */ }
    boot()
  }

  addRoot.querySelector('form').addEventListener('submit', event => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const name = data.get('name').trim(); const cost = Number(data.get('cost')); const cadence = data.get('cadence')
    manualSubscriptions.push(toManualDisplayItem({ name, cost, cadence }))
    event.currentTarget.reset(); addDialog.close(); live.announce(`${name} added.`)
    renderRoute()
  })

  // ---- Gmail: connect/scan/disconnect (Sources page only) ------------------
  const refreshGmailSource = async () => {
    try { gmailSource = await feature001Api.getGmailSource(); gmailSourceUnavailable = false }
    catch { gmailSourceUnavailable = true }
    applyGmailSource()
  }
  const runScan = async () => {
    const gmailButton = document.querySelector('[data-gmail-action]')
    if (!gmailButton || gmailButton.disabled) return
    const discovery = document.querySelector('[data-discovery-result]'); if (discovery) discovery.hidden = true
    setGmailState('Scanning', 'Scanning receipts…', 'scan', { disabled: true }); live.announce('Scanning receipts…')
    try {
      const result = await feature001Api.scanGmail()
      const previousIds = new Set(allItems().map(item => item.id))
      const { subscriptions: rawList } = await feature001Api.listSubscriptions()
      backendItems = (rawList || []).map(toDisplayItem)
      refreshOverlapActions()
      const newIds = new Set(allItems().filter(item => !previousIds.has(item.id)).map(item => item.id))
      try { candidates = (await feature001Api.listCandidates()).candidates || [] } catch { /* the review page just keeps showing its last known state */ }
      await refreshAttentionItems()
      await refreshGmailSource()
      await renderRoute()
      renderScanResults(result)
      const copy = result.found ? `${result.found} subscription${result.found === 1 ? '' : 's'} found.` : 'No qualifying subscription receipts found.'
      live.announce(copy)
      const discovered = allItems().filter(item => newIds.has(item.id))
      if (discovered.length) showDiscovery(discovered)
    } catch (error) {
      if (error.code === 'scan_already_running') { setGmailState('Scanning', 'A scan is already running…', 'scan', { disabled: true }); live.announce('A scan is already in progress.') }
      else if (error.code === 'source_not_connected') { await refreshGmailSource(); live.announce('Connect Gmail before scanning.') }
      else { setGmailState('Scan error', "Gmail is connected, but receipts couldn't be scanned. You can try again.", 'scan'); live.announce('Receipts could not be scanned.') }
    }
  }
  const connectGmail = async () => {
    try {
      const result = await feature001Api.authorizeGmail()
      if (result.url) { window.location.href = result.url; return }
      // The mock provider connects synchronously with no redirect.
      await refreshGmailSource()
      if (gmailSource.status === 'connected') await runScan()
    } catch {
      setGmailState('Not connected', "Gmail couldn't be connected. Please try again.", 'connect')
      live.announce("Gmail couldn't be connected.")
    }
  }
  const wireSourcesPage = () => {
    document.querySelector('[data-gmail-action]').addEventListener('click', event => event.currentTarget.dataset.gmailAction === 'scan' ? runScan() : gmailDialog.open(event.currentTarget))
    document.querySelector('[data-gmail-disconnect]').addEventListener('click', async (event) => {
      event.currentTarget.disabled = true
      setGmailState('Disconnecting', 'Disconnecting Gmail…', 'scan', { disabled: true }); live.announce('Disconnecting Gmail…')
      try {
        await feature001Api.disconnectGmail()
        const { subscriptions: rawList } = await feature001Api.listSubscriptions()
        backendItems = (rawList || []).map(toDisplayItem)
        refreshOverlapActions()
        await refreshAttentionItems()
        await refreshGmailSource()
        await renderRoute()
        applyGmailSource()
        live.announce('Gmail disconnected.')
      } catch {
        applyGmailSource()
        live.announce("Gmail couldn't be disconnected. Please try again.")
      } finally {
        const stillPresent = document.querySelector('[data-gmail-disconnect]')
        if (stillPresent) stillPresent.disabled = false
      }
    })
  }
  gmailRoot.querySelector('[data-continue-gmail]').addEventListener('click', async event => {
    event.currentTarget.disabled = true
    setGmailState('Authorizing', 'Waiting for Gmail authorization…', 'connect', { disabled: true }); live.announce('Waiting for Gmail authorization.')
    gmailDialog.close()
    await connectGmail()
    event.currentTarget.disabled = false
  })

  // Deliberately last: renderRoute's switch calls into every wireXxx()
  // function above (wireAttentionPage, wireSubscriptionsPage,
  // wireSourcesPage, signOut, ...) depending on which route is current, so
  // the very first render - which can legitimately land on any route via a
  // deep link or a page refresh, not just the default overview - must not
  // run until all of them are defined.
  onRouteChange(renderRoute)
  await renderRoute()
  renderSidebarFooter()

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}

async function boot() {
  const { authError, gmailError } = consumeRedirectSignal()
  app.innerHTML = shellHeader() + loadingMarkup()
  let session
  try {
    session = await feature001Api.getSession()
  } catch {
    renderSessionError("Subtle AI couldn't reach the server. Check your connection and try again.")
    return
  }
  if (!session.authenticated) { renderSignedOut(authError ? (AUTH_ERROR_MESSAGES[authError] || "Sign-in couldn't be completed. Please try again.") : undefined); return }
  await renderAuthenticated(session.user, gmailError)
}

boot()
