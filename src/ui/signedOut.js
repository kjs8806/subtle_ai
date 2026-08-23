const svg = (paths, size = 20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const ICON_SEARCH = svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>')
const ICON_SHIELD_CHECK = svg('<path d="M12 3 5 6v5c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6l-7-3Z"/><path d="m9.5 12 2 2 3.5-3.5"/>')
const ICON_BELL = svg('<path d="M12 3a5 5 0 0 0-5 5v3.2c0 .6-.24 1.17-.66 1.6L4.6 14.5A1 1 0 0 0 5.3 16h13.4a1 1 0 0 0 .7-1.5l-1.74-1.7a2.3 2.3 0 0 1-.66-1.6V8a5 5 0 0 0-5-5Z"/><path d="M9.5 19a2.5 2.5 0 0 0 5 0"/>')
const ICON_TREND = svg('<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>')
const ICON_SHIELD = svg('<path d="M12 3 5 6v5c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6l-7-3Z"/>', 22)
const ICON_EYE_OFF = svg('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c5 0 9 4 10 7-.5 1.4-1.5 3-3 4.3M6.2 6.6C4 8.1 2.5 10.2 2 12c1 3 5 7 10 7 1.4 0 2.7-.3 3.9-.8"/><path d="M9.5 10a3 3 0 0 0 4.2 4.2"/>', 22)
const ICON_CHECK_CIRCLE = svg('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/>', 22)
const ICON_USERS = svg('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5"/><circle cx="17.5" cy="9" r="2.6"/><path d="M15.3 12.2c2 .3 3.5 1.9 4.2 4.8"/>', 22)
const ICON_LOCK = svg('<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>', 16)
const ICON_GOOGLE = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.4 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.1 17.7 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.6c-.5 3-2.2 5.5-4.7 7.2l7.3 5.6c4.3-4 6.8-9.8 6.8-17.3Z"/><path fill="#FBBC05" d="M10.5 19.3a14.5 14.5 0 0 0 0 9.4l-7.9 6.1a24 24 0 0 1 0-21.6l7.9 6.1Z"/><path fill="#34A853" d="M24 48c6.4 0 11.9-2.1 15.9-5.8l-7.3-5.6c-2 1.4-4.7 2.2-8.6 2.2-6.3 0-11.6-3.6-13.5-8.6l-7.9 6.1C6.5 42.6 14.6 48 24 48Z"/></svg>`

const FEATURES = [
  { icon: ICON_SEARCH, title: 'Find everything', body: "We scan your emails to find every subscription you're paying for." },
  { icon: ICON_SHIELD_CHECK, title: 'Understand the details', body: 'Get clear, verified insights with receipt-backed evidence.' },
  { icon: ICON_BELL, title: 'Know what matters', body: 'We surface price increases, upcoming renewals, and items that need attention.' },
  { icon: ICON_TREND, title: 'Take action', body: 'Review, compare, and make confident decisions to save more.' },
]
const TRUST_POINTS = [
  { icon: ICON_SHIELD, title: 'Bank-level security', body: 'We use industry-standard encryption to protect your data.' },
  { icon: ICON_EYE_OFF, title: 'Your data stays yours', body: 'We never sell your data. Ever.' },
  { icon: ICON_CHECK_CIRCLE, title: 'Receipt-backed insights', body: 'Every subscription is matched with real evidence.' },
  { icon: ICON_USERS, title: "You're in control", body: 'Connect, review, and decide what’s right for you.' },
]
const featureCard = ({ icon, title, body }) => `<div class="landing-feature"><span class="landing-feature-icon">${icon}</span><h3>${title}</h3><p>${body}</p></div>`
const trustCard = ({ icon, title, body }) => `<div class="landing-trust-item"><span class="landing-trust-icon">${icon}</span><div><strong>${title}</strong><p>${body}</p></div></div>`

// A static, non-interactive illustration of the real Overview page - not a
// live view (there's no session yet to show real data), so every value here
// is an obviously illustrative example, the same convention the approved
// mockups themselves use ("mock data for illustration only"). Nothing in it
// is a button or link - div/span throughout - so it never reads as a control
// that happens to do nothing.
const productPreviewMarkup = () => `<div class="landing-preview" aria-hidden="true"><div class="preview-frame">
<div class="preview-sidebar"><div class="preview-brand"><span class="preview-logo">S</span>Subtle AI</div><div class="preview-nav-item is-active">Overview</div><div class="preview-nav-item">Subscriptions</div><div class="preview-nav-item">Worth your attention<span class="preview-nav-badge">3</span></div><div class="preview-nav-item">Sources</div><div class="preview-nav-item">Settings</div></div>
<div class="preview-main">
<div class="preview-greeting"><strong>Good morning, Sarah.</strong><span>Here's what your subscriptions are telling you.</span></div>
<div class="preview-stats">
<div class="preview-stat"><span>Monthly spend</span><strong>$143.61</strong><small>in 6 subscriptions</small></div>
<div class="preview-stat"><span>Annual spend</span><strong>$1,723.32</strong><small>projected</small></div>
<div class="preview-stat"><span>Active subscriptions</span><strong>6</strong><small>across 4 services</small></div>
<div class="preview-stat"><span>Worth your attention</span><strong>3</strong><small>items</small></div>
</div>
<div class="preview-columns">
<div class="preview-list"><strong class="preview-panel-title">Your subscriptions</strong>
<div class="preview-row"><span class="preview-dot" style="background:#e50914"></span><span class="preview-service">Netflix<small>Premium Plan</small></span><em>$22.99 / month</em></div>
<div class="preview-row"><span class="preview-dot" style="background:#1db954"></span><span class="preview-service">Spotify<small>Premium Individual</small></span><em>$10.99 / month</em></div>
<div class="preview-row"><span class="preview-dot" style="background:#113ccf"></span><span class="preview-service">Disney+<small>Premium</small></span><em>$13.99 / month</em></div>
</div>
<div class="preview-list"><strong class="preview-panel-title">Worth your attention</strong>
<div class="preview-attn"><span class="tone-coral">Price increased</span>Netflix · +$2.50/month</div>
<div class="preview-attn"><span class="tone-warning">Renews in 6 days</span>Spotify Premium</div>
<div class="preview-attn"><span class="tone-purple">Needs your review</span>Amazon Prime</div>
</div>
</div>
</div>
</div>
<div class="preview-badge preview-badge-security">${ICON_LOCK}<span><strong>Private &amp; secure</strong><small>Your data is encrypted and never sold</small></span></div>
<div class="preview-badge preview-badge-gmail">${ICON_GOOGLE}<span><strong>Works with Gmail</strong><small>Securely connect and let Subtle AI do the rest</small></span></div>
</div>`

// The pre-auth marketing/sign-in screen. Only the Google button is a real
// control - FEATURE-001/002 has no email/password auth, registration, or
// password-reset endpoint, so no such form is offered here (an unwired form
// would silently do nothing on submit, which DESIGN-001/AI Usage Policy's
// "never fabricate a working control" rule rules out). Same reasoning
// applies to review counts/star ratings/testimonials - none are real, so
// none are shown.
export const signedOutMarkup = () => `<div class="landing wrap" id="signed-out">
<div class="landing-grid">
<div class="landing-main">
<section class="landing-hero"><h1>Your AI subscription<br><span class="landing-accent">optimizer</span></h1><p>Discover, understand, and optimize every subscription so you can spend smarter.</p></section>
<section class="landing-features" id="learn-more" aria-label="What Subtle AI does">${FEATURES.map(featureCard).join('')}</section>
${productPreviewMarkup()}
<section class="landing-trust-section" aria-label="Why people trust Subtle AI"><p class="landing-trust-title">Trusted by people who want clarity and control</p><div class="landing-trust-grid">${TRUST_POINTS.map(trustCard).join('')}</div></section>
</div>
<aside class="landing-signin panel-card" aria-label="Sign in"><h2>Welcome back</h2><p class="landing-signin-sub">Sign in to continue optimizing your subscriptions.</p><button class="google-button" data-google-sign-in type="button">${ICON_GOOGLE}Continue with Google</button><p class="empty-state" data-session-error hidden></p><p class="landing-signin-note">${ICON_LOCK}We only read your emails to find subscription information. <a href="#learn-more">Learn how it works.</a></p></aside>
</div>
</div>`

export const loadingMarkup = (message = 'Loading…') => `<div class="main-content wrap" id="loading"><p class="empty-state" role="status">${message}</p></div>`

export const sessionErrorMarkup = (message = "Subtle AI couldn't reach the server.") => `<div class="main-content wrap" id="session-error"><header class="overview-header"><p class="eyebrow">Connection problem</p><h1>Something went wrong</h1><p>${message}</p></header><button class="primary-button" data-retry-session type="button">Try again</button></div>`
