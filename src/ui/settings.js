const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])

// Intentionally sparse: only currently-real, currently-supported controls
// (account identity, a link to source management, a privacy note, sign out).
// No invented settings just to fill the page.
export const settingsPageMarkup = ({ user } = {}) => `<div class="main-content wrap" id="page-settings"><header class="page-header"><div><p class="eyebrow">Account</p><h1>Settings</h1><p>Your account and how Subtle AI handles your data.</p></div></header>

<section class="panel-card settings-panel" aria-label="Account settings">
<div class="settings-row"><div><strong>Account</strong><span>${escapeHtml(user?.name || 'Signed in')}</span></div></div>
<div class="settings-row"><div><strong>Email</strong><span>${escapeHtml(user?.email || 'Not provided')}</span></div></div>
<div class="settings-row"><div><strong>Connected accounts</strong><span>Manage Gmail connection and scanning</span></div><a class="secondary-button" href="#/sources">Sources</a></div>
<div class="settings-row"><div><strong>Privacy</strong><span>Subtle AI only reads emails to find subscription info. Your data is encrypted and never sold.</span></div></div>
<div class="settings-row"><div><strong>Sign out</strong><span>End your session on this device.</span></div><button class="secondary-button" data-sign-out type="button">Sign out</button></div>
</section>
</div>`
