import './style.css'
import { demoSubscriptions, savingsActions } from './data/demoSubscriptions.js'
import { createPipelineRecords, monthlySpendFor } from './data/subscriptionModel.js'
import { feature001Api } from './services/feature001Api.js'

const APP_CONFIG = { name: 'Subtle AI', tagline: 'your AI subscription optimizer' }
const subscriptions = demoSubscriptions.map((item) => ({ ...item }))
const actions = savingsActions
const money = (value) => `$${value.toFixed(2)}`
const monthlySpend = monthlySpendFor(subscriptions)
const pipelineRecords = createPipelineRecords(subscriptions)
subscriptions.forEach((item, index) => { item.pipelineRecord = pipelineRecords[index] })
const brand = () => `<a class="brand" href="#overview" aria-label="${APP_CONFIG.name} home"><span class="brand-mark" aria-hidden="true"><span class="brand-glyph">${APP_CONFIG.name.charAt(0).toLowerCase()}</span></span><span>${APP_CONFIG.name}</span></a>`

document.title = `${APP_CONFIG.name} — ${APP_CONFIG.tagline}`
const app = document.querySelector('#app')
app.innerHTML = `
  <main class="app-shell">
    <header class="app-nav wrap">${brand()}<nav aria-label="Product navigation"><a class="nav-active" href="#overview">Overview</a><a href="#subscriptions">Subscriptions</a><a href="#insights">Savings</a></nav><div class="nav-actions"><button class="icon-button" type="button" aria-label="Notifications">♧<span class="notification-dot"></span></button><button class="avatar" type="button" aria-label="Open account menu">JD</button></div></header>
    <div class="app-content wrap">
      <section class="welcome-row" id="overview"><div><p class="eyebrow"><span class="eyebrow-dot"></span> Wednesday, August 19</p><h1>Good morning, Jun.</h1><p class="welcome-copy">Here’s what your subscriptions are telling you.</p></div><button class="add-button" type="button" data-open-modal><span>＋</span> Add subscription</button></section>
      <section class="summary-grid" aria-label="Subscription spending summary"><article class="spend-card"><div class="card-kicker">Total recurring spend</div><div class="spend-value" data-spend>${money(monthlySpend)}<span>/mo</span></div><div class="spend-meta"><span class="trend-down">↓ 4.8%</span> <span>vs. last month</span></div><div class="mini-bars" aria-label="Monthly spending trend"><i></i><i></i><i></i><i></i><i></i><i></i><i class="bar-current"></i></div></article><article class="savings-card"><div class="card-kicker">Your next best moves</div><div class="savings-value">3 <span>ways to save $64/mo</span></div><div class="savings-meta"><span class="spark">✦</span> Ranked by potential impact</div><button class="text-button" type="button" data-scroll-insights>Review savings <span>→</span></button></article><article class="count-card"><div class="card-kicker">Subscriptions tracked</div><div class="count-value">${subscriptions.length}</div><div class="source-stack"><span class="source-pill gmail">Gmail</span><span class="source-pill manual">2 manual</span><span class="source-pill synced">Synced just now</span></div></article></section>
      <section class="dashboard-grid"><div class="primary-column"><div class="section-bar" id="insights"><div><p class="eyebrow">Ranked by potential impact</p><h2>Savings feed</h2></div><span class="feed-status"><i></i> Watching your spend</span></div><div class="action-feed">${actions.map((action) => `<article class="action-card action-${action.tone}" data-action="${action.id}"><div class="action-icon">${action.icon}</div><div class="action-content"><div class="action-label">${action.label}</div><h3>${action.title}</h3><p>${action.body}</p><div class="action-footer"><div><button class="small-button primary-action" data-action-target="${action.id}" type="button">${action.primary} <span>→</span></button><button class="small-button secondary-action" type="button">${action.secondary}</button></div>${action.saving ? `<strong>${action.saving}</strong>` : ''}</div></div><button class="dismiss-action" type="button" aria-label="Dismiss insight">×</button></article>`).join('')}</div><div class="section-bar subscriptions-heading" id="subscriptions"><div><p class="eyebrow">Your recurring expenses</p><h2>All subscriptions <span class="count-badge">${subscriptions.length}</span></h2></div><div class="view-controls"><button class="view-button active" type="button" data-view="monthly">Monthly</button><button class="view-button" type="button" data-view="annual">Annual</button></div></div><div class="subscription-list">${subscriptions.map((item) => `<button class="subscription-row" data-subscription-id="${item.id}" type="button"><span class="service-icon service-${item.tone}">${item.icon}</span><span class="subscription-name"><strong>${item.name}</strong><span>${item.plan} · ${item.category}</span></span><span class="subscription-signal"><span class="signal-dot"></span>${item.signal}</span><span class="subscription-next"><span>Next payment</span><strong>${item.next}</strong></span><span class="subscription-price" data-monthly="${item.cadence === 'yearly' ? item.cost / 12 : item.cost}" data-annual="${item.cadence === 'yearly' ? item.cost : item.cost * 12}">${money(item.cadence === 'yearly' ? item.cost / 12 : item.cost)}<small>/mo</small></span><span class="row-menu" aria-hidden="true">•••</span></button>`).join('')}</div></div><aside class="side-column"><section class="assistant-card"><div class="assistant-head"><span class="assistant-spark">✦</span><div><strong>Subtle AI</strong><span>Personalized analysis</span></div><span class="live-dot"></span></div><p>“Your recurring spend is down this month. I found one overlap worth reviewing before your next billing cycle.”</p><button class="assistant-button" type="button" data-scroll-insights>View Subtle analysis <span>→</span></button></section><section class="calendar-card"><div class="side-heading"><h3>Coming up</h3><button class="more-link" type="button">View calendar →</button></div><div class="calendar-item"><span class="calendar-date"><b>23</b><small>AUG</small></span><div><strong>NordVPN</strong><span>Annual renewal</span></div><b>$119.99</b></div><div class="calendar-item"><span class="calendar-date"><b>03</b><small>SEP</small></span><div><strong>Spotify</strong><span>Monthly renewal</span></div><b>$11.99</b></div><div class="calendar-item"><span class="calendar-date"><b>05</b><small>SEP</small></span><div><strong>Canva</strong><span>Price changed</span></div><b>$17.99</b></div></section><section class="sources-card"><div class="side-heading"><h3>Data sources</h3><span class="secure-label">⌁ Secure</span></div><div class="source-row"><span class="source-logo gmail-logo">M</span><div><strong>Gmail receipts</strong><span>Last scanned today</span></div><span class="connected">Connected</span></div><div class="source-row"><span class="source-logo manual-logo">＋</span><div><strong>Manual entries</strong><span>2 subscriptions added</span></div><button class="source-add" type="button" data-open-modal>Add</button></div><button class="connect-button" type="button"><span>＋</span> Connect another source</button></section></aside></section>
    </div><footer class="app-footer wrap">${brand()}<span>Discover · Understand · Optimize · Act</span><span>Private by design</span></footer>
  </main><div class="modal-backdrop" hidden><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" type="button" aria-label="Close">×</button><p class="eyebrow">Manual entry</p><h2 id="modal-title">Add a subscription</h2><p>Keep your full recurring spend in one clear place.</p><form class="subscription-form"><label>Service name<input name="name" placeholder="e.g. Netflix" required /></label><div class="form-row"><label>Cost<input name="cost" type="number" min="0" step="0.01" placeholder="22.99" required /></label><label>Billing<select name="cadence"><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label></div><button class="form-submit" type="submit">Add to my overview <span>→</span></button></form></section></div><div class="detail-backdrop" hidden><section class="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button class="modal-close detail-close" type="button" aria-label="Close subscription detail">×</button><div class="detail-hero"><span class="detail-icon service-blue">D</span><div><p class="eyebrow">Subscription detail</p><h2 id="detail-title">Dropbox Plus</h2><span>Cloud storage · Gmail receipt</span></div></div><div class="detail-stats"><div><span>Current cost</span><strong id="detail-cost">$15.99<small>/month</small></strong></div><div><span>Next charge</span><strong id="detail-next">Sep 22</strong></div><div><span>Annual cost</span><strong id="detail-annual">$191.88</strong></div></div><section class="analysis-block"><div class="analysis-heading"><span class="analysis-icon">⚠</span><div><p class="eyebrow">Subtle analysis</p><h3 id="detail-analysis-title">Possible overlap</h3></div></div><p id="detail-analysis-copy">You’re also paying for Google One. Both services provide cloud storage and photo backup.</p><div class="compare-table"><div><span></span><strong>Dropbox Plus</strong><b>$15.99/mo</b><small>2 TB · File sync</small></div><div><span></span><strong>Google One</strong><b>$13.99/mo</b><small>2 TB · Photos + Gmail</small></div></div><div class="potential-saving"><span>Potential savings</span><strong>$191.88/year</strong></div><button class="form-submit compare-button" type="button">Compare plans <span>→</span></button></section><section class="history-grid"><div><div class="detail-section-heading"><h3>Price history</h3><span>Last 2 years</span></div><div class="price-history"><span>2025</span><i style="width:82%"></i><b>$12.99</b><span>2026</span><i style="width:100%"></i><b>$15.99</b></div><strong class="increase">+23% since 2025</strong></div><div><div class="detail-section-heading"><h3>Billing history</h3><span>Confirmed receipts</span></div><div class="billing-row"><span>Aug 22</span><b>$15.99</b></div><div class="billing-row"><span>Jul 22</span><b>$15.99</b></div><div class="billing-row"><span>Jun 22</span><b>$15.99</b></div></div></section><div class="detail-source"><span class="source-logo gmail-logo">M</span><div><strong>Detected from Gmail receipt</strong><span>Last confirmed Aug 22 · High confidence</span></div><span class="confidence">✓</span></div></section></div>`

const gmailSource = document.querySelector('.sources-card .source-row:first-of-type')
const gmailMessage = gmailSource.querySelector('div span')
const gmailStatus = gmailSource.querySelector('.connected')
const gmailConnect = document.querySelector('.sources-card .connect-button')
const gmailDisclosure = document.createElement('div')
gmailDisclosure.className = 'modal-backdrop'
gmailDisclosure.hidden = true
gmailDisclosure.innerHTML = '<section class="modal" role="dialog" aria-modal="true" aria-labelledby="gmail-disclosure-title"><button class="modal-close" type="button" aria-label="Close">×</button><p class="eyebrow">Data source</p><h2 id="gmail-disclosure-title">Connect Gmail</h2><p>Subtle AI will look for subscription receipts and use matching evidence to create records. Gmail access is separate from sign-in and can be disconnected later.</p><button class="form-submit" type="button" data-continue-gmail>Continue to Gmail <span>→</span></button></section>'
document.querySelector('.app-shell').append(gmailDisclosure)
const setGmailState = (status, message, action = 'connect') => {
  gmailStatus.textContent = status
  gmailMessage.textContent = message
  gmailConnect.innerHTML = action === 'scan' ? 'Scan receipts' : '<span>＋</span> Connect Gmail'
  gmailConnect.dataset.gmailAction = action
}
setGmailState('Not connected', 'Connect to discover receipts', 'connect')
const addDiscoveredSubscriptions = (records) => records.forEach((record) => {
  if (subscriptions.some((item) => item.remoteId === record.id)) return
  const item = {
    id: subscriptions.length + 1,
    remoteId: record.id,
    name: record.canonicalService,
    plan: record.plan,
    category: 'Other',
    cost: record.currentPrice || 0,
    cadence: record.billingCycle === 'yearly' ? 'yearly' : 'monthly',
    next: record.nextRenewal || 'Unknown',
    icon: record.canonicalService.charAt(0),
    tone: 'blue',
    status: 'Active',
    signal: 'Confirmed from receipt',
    takeTone: 'good',
    takeTitle: 'Receipt found',
    takeText: 'This subscription was discovered from a matching receipt.',
    analysisTitle: 'Evidence-backed discovery',
    analysisCopy: 'Review the matching receipt evidence and inferred fields before relying on this record.',
    source: 'Gmail receipt',
    confirmed: record.evidence?.[0]?.receivedAt || 'Recently',
    confidence: 'Receipt evidence',
    history: [[record.evidence?.[0]?.receivedAt || 'Recent', money(record.currentPrice || 0)]],
    bills: [[record.evidence?.[0]?.receivedAt || 'Recent', money(record.currentPrice || 0)]],
    pipelineRecord: record,
  }
  subscriptions.push(item)
  const list = document.querySelector('.subscription-list')
  const row = document.createElement('button')
  row.className = 'subscription-row'
  row.type = 'button'
  row.dataset.subscriptionId = String(item.id)
  row.innerHTML = `<span class="service-icon service-blue">${item.icon}</span><span class="subscription-name"><strong>${item.name}</strong><span>${item.plan} · ${item.category}</span></span><span class="subscription-signal"><span class="signal-dot"></span>${item.signal}</span><span class="subscription-next"><span>Next payment</span><strong>${item.next}</strong></span><span class="subscription-price">${money(item.cost)}<small>/mo</small></span><span class="row-menu" aria-hidden="true">•••</span>`
  row.addEventListener('click', () => renderDetail(item))
  list.append(row)
  document.querySelector('[data-spend]').firstChild.textContent = money(monthlySpendFor(subscriptions))
  document.querySelector('.count-value').textContent = subscriptions.length
  document.querySelectorAll('.count-badge').forEach((badge) => { badge.textContent = subscriptions.length })
})
const runGmailScan = async () => {
  setGmailState('Scanning receipts', 'Looking for qualifying receipts...', 'scan')
  try {
    const result = await feature001Api.scan()
    if (result.found) addDiscoveredSubscriptions((await feature001Api.listSubscriptions()).subscriptions)
    setGmailState('Connected', result.found ? `${result.found} subscription found` : 'No qualifying receipts found', 'scan')
  } catch (error) {
    setGmailState('Scan failure', error.message, 'scan')
  }
}
gmailConnect.addEventListener('click', async () => {
  if (gmailConnect.dataset.gmailAction === 'scan') return runGmailScan()
  gmailDisclosure.hidden = false
})
gmailDisclosure.querySelector('.modal-close').addEventListener('click', () => { gmailDisclosure.hidden = true })
gmailDisclosure.addEventListener('click', (event) => { if (event.target === gmailDisclosure) gmailDisclosure.hidden = true })
gmailDisclosure.querySelector('[data-continue-gmail]').addEventListener('click', async () => {
  const continueButton = gmailDisclosure.querySelector('[data-continue-gmail]')
  continueButton.disabled = true
  setGmailState('Waiting for Gmail', 'Opening authorization...', 'connect')
  try {
    const authorization = await feature001Api.startAuthorization()
    await feature001Api.completeAuthorization(authorization.url)
    gmailDisclosure.hidden = true
    setGmailState('Connected', 'Ready to scan receipts', 'scan')
    await runGmailScan()
  } catch (error) {
    gmailDisclosure.hidden = true
    setGmailState('Not connected', 'We could not connect Gmail', 'connect')
  } finally {
    continueButton.disabled = false
  }
})

const modal = document.querySelector('.modal-backdrop')
const detailModal = document.querySelector('.detail-backdrop')
const closeModal = () => { modal.hidden = true }
const closeDetail = () => { detailModal.hidden = true }
const renderDetail = (item) => {
  const annualCost = item.cadence === 'yearly' ? item.cost : item.cost * 12
  const detailHero = detailModal.querySelector('.detail-hero')
  const detailIcon = detailHero.querySelector('.detail-icon')
  detailIcon.className = `detail-icon service-icon service-${item.tone}`
  detailIcon.textContent = item.icon
  detailHero.querySelector('.eyebrow').textContent = 'Subscription detail'
  detailHero.querySelector('h2').textContent = `${item.name} ${item.plan}`
  detailHero.querySelector('div > span').textContent = `${item.category} · ${item.source}`
  if (!detailHero.querySelector('.manage-button')) detailHero.insertAdjacentHTML('beforeend', '<button class="manage-button" type="button">Manage subscription <span>→</span></button>')
  detailModal.querySelector('#detail-cost').innerHTML = `${money(item.cadence === 'yearly' ? item.cost / 12 : item.cost)}<small>/${item.cadence === 'yearly' ? 'month equivalent' : 'month'}</small>`
  detailModal.querySelector('#detail-next').textContent = item.next
  detailModal.querySelector('#detail-annual').textContent = money(annualCost)
  let take = detailModal.querySelector('.detail-take')
  if (!take) {
    detailModal.querySelector('.detail-stats').insertAdjacentHTML('afterend', '<section class="detail-take"><p class="eyebrow">Subtle’s take</p><strong></strong><span></span></section>')
    take = detailModal.querySelector('.detail-take')
  }
  take.className = `detail-take take-${item.takeTone}`
  take.querySelector('strong').textContent = `${item.takeTitle} —`
  take.querySelector('span').textContent = item.takeText
  detailModal.querySelector('#detail-analysis-title').textContent = item.analysisTitle
  detailModal.querySelector('#detail-analysis-copy').textContent = item.analysisCopy
  const compareTable = detailModal.querySelector('.compare-table')
  const saving = detailModal.querySelector('.potential-saving')
  const compareButton = detailModal.querySelector('.compare-button')
  if (item.comparison) {
    compareTable.hidden = false
    saving.hidden = false
    compareButton.hidden = false
    compareTable.innerHTML = `<div><strong>${item.name} ${item.plan}</strong><b>${money(item.cost)}/mo</b><small>2 TB · File sync</small></div><div><strong>${item.comparison.otherName}</strong><b>${item.comparison.otherCost}</b><small>${item.comparison.otherFeatures}</small></div>`
    saving.querySelector('strong').textContent = item.comparison.savings
  } else {
    compareTable.hidden = true
    saving.hidden = true
    compareButton.hidden = true
  }
  detailModal.querySelector('.price-history').innerHTML = item.history.map(([year, price], index) => `<span>${year}</span><i style="width:${index === item.history.length - 1 ? 100 : 78 + index * 9}%"></i><b>${price}</b>`).join('')
  detailModal.querySelector('.increase').textContent = item.history.length > 1 ? `${item.history[item.history.length - 1][1]} current price · ${item.history[0][1]} original price` : 'No price history yet'
  detailModal.querySelector('.history-grid > div:last-child').querySelectorAll('.billing-row').forEach((row, index) => { const bill = item.bills[index]; if (bill) { row.querySelector('span').textContent = bill[0]; row.querySelector('b').textContent = bill[1] } })
  const confidence = item.pipelineRecord?.confidence || { state: 'inferred', score: 0.74 }
  detailModal.querySelector('.detail-source strong').textContent = `Detected from ${item.pipelineRecord?.source || item.source}`
  detailModal.querySelector('.detail-source div span').textContent = `Last confirmed ${item.confirmed} · ${confidence.state} · ${Math.round(confidence.score * 100)}% confidence`
  if (!detailModal.querySelector('.correction-button')) detailModal.querySelector('.detail-source').insertAdjacentHTML('beforeend', '<button class="correction-button" type="button">This looks wrong</button>')
  detailModal.hidden = false
}
document.querySelectorAll('[data-open-modal]').forEach((button) => button.addEventListener('click', () => { modal.hidden = false; modal.querySelector('input').focus() }))
document.querySelector('.modal-close').addEventListener('click', closeModal)
modal.addEventListener('click', (event) => { if (event.target === modal) closeModal() })
document.querySelector('.detail-close').addEventListener('click', closeDetail)
detailModal.addEventListener('click', (event) => { if (event.target === detailModal) closeDetail() })
detailModal.addEventListener('click', (event) => { if (event.target.closest('.manage-button')) { event.target.closest('.manage-button').innerHTML = 'Instructions ready <span>✓</span>' } })
detailModal.addEventListener('click', (event) => { if (event.target.closest('.correction-button')) { event.target.closest('.correction-button').textContent = 'Correction noted'; event.target.closest('.correction-button').classList.add('noted') } })
document.querySelector('.subscription-form').addEventListener('submit', (event) => { event.preventDefault(); closeModal(); const button = document.querySelector('.add-button'); button.innerHTML = '<span>✓</span> Added to overview'; button.classList.add('added') })
document.querySelectorAll('[data-scroll-insights]').forEach((button) => button.addEventListener('click', () => document.querySelector('#insights').scrollIntoView({ behavior: 'smooth' })))
document.querySelectorAll('[data-subscription-id]').forEach((row) => row.addEventListener('click', () => {
  const item = subscriptions.find((subscription) => subscription.id === Number(row.dataset.subscriptionId))
  renderDetail(item)
}))
document.querySelectorAll('[data-action-target="overlap"]').forEach((button) => button.addEventListener('click', () => renderDetail(subscriptions.find((item) => item.name === 'Dropbox'))))
document.querySelector('.compare-button').addEventListener('click', (event) => { event.currentTarget.innerHTML = 'Comparison ready <span>✓</span>'; event.currentTarget.classList.add('saved') })
document.querySelectorAll('.dismiss-action').forEach((button) => button.addEventListener('click', () => button.closest('.action-card').remove()))
document.querySelectorAll('.primary-action').forEach((button) => button.addEventListener('click', () => { button.innerHTML = 'Review saved <span>✓</span>'; button.classList.add('saved') }))
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-view]').forEach((item) => item.classList.remove('active')); button.classList.add('active'); const view = button.dataset.view; document.querySelectorAll('.subscription-price').forEach((price) => { price.innerHTML = money(Number(price.dataset[view])) + `<small>/${view === 'monthly' ? 'mo' : 'yr'}</small>` }) }))

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}
