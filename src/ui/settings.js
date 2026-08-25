const escapeHtml = value => String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
const svg = (paths) => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const ICON_TRASH = svg('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>')
const ICON_CHECK = svg('<path d="m20 6-11 11-5-5"/>')

// Intentionally sparse: only currently-real, currently-supported controls
// (account identity, a link to source management, a privacy note, sign out,
// delete account). No invented settings just to fill the page.
export const settingsPageMarkup = ({ user } = {}) => `<div class="main-content wrap" id="page-settings"><header class="page-header"><div><p class="eyebrow">Account</p><h1>Settings</h1><p>Your account and how Subtle AI handles your data.</p></div></header>

<section class="panel-card settings-panel" aria-label="Account settings">
<div class="settings-row"><div><strong>Account</strong><span>${escapeHtml(user?.name || 'Signed in')}</span></div></div>
<div class="settings-row"><div><strong>Email</strong><span>${escapeHtml(user?.email || 'Not provided')}</span></div></div>
<div class="settings-row"><div><strong>Connected accounts</strong><span>Manage Gmail connection and scanning</span></div><a class="secondary-button" href="#/sources">Sources</a></div>
<div class="settings-row"><div><strong>Privacy</strong><span>Gmail access is read-only and used to search for subscription receipt and renewal emails. Your Gmail credentials are encrypted, and you can disconnect Gmail anytime from Sources.</span></div></div>
<div class="settings-row"><div><strong>Sign out</strong><span>End your session on this device.</span></div><button class="secondary-button" data-sign-out type="button">Sign out</button></div>
</section>

<section class="panel-card settings-panel settings-danger-zone" aria-label="Danger zone">
<div class="settings-row"><div><strong>Delete account</strong><span>Permanently delete your Subtle AI account and all associated data. This is different from disconnecting Gmail or signing out.</span></div><button class="danger-button" data-open-delete-account type="button">Delete account</button></div>
</section>
</div>`

// MVP-BETA-004 (#41): a dedicated confirmation dialog, mirroring the
// existing "Not a subscription" consequence-checklist pattern (DES-021) -
// the most destructive action in the app gets at least as much explanation
// as the least destructive one already has. Copy states exactly what the
// approved policy (issue #41) says gets deleted and explicitly distinguishes
// this from Disconnect Gmail (which keeps the account) and Sign out (which
// keeps everything) - DESIGN-001/AI Usage Policy rule out promising more or
// less than what the backend actually does.
export const deleteAccountConfirmMarkup = () => `<div class="dialog-backdrop" data-delete-account-dialog hidden><section class="dialog reject-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-title"><button class="dialog-close" data-close-dialog aria-label="Close">×</button><div class="reject-icon-wrap">${ICON_TRASH}</div><h2 id="delete-account-title">Delete your account?</h2><p>This permanently deletes your Subtle AI account and cannot be undone. It is different from disconnecting Gmail (which keeps your account) or signing out (which keeps everything).</p><div class="reject-whatnext"><strong>What will happen</strong><ul><li>${ICON_CHECK}Your Gmail connection and stored credentials are removed</li><li>${ICON_CHECK}All subscriptions, evidence, and corrections are deleted</li><li>${ICON_CHECK}Your account can no longer be signed into</li><li>${ICON_CHECK}Signing in again starts a brand-new account</li></ul></div><p class="empty-state" data-delete-account-error hidden></p><div class="dialog-actions"><button class="danger-button" data-confirm-delete-account type="button">Delete my account</button><button class="quiet-button" data-close-dialog type="button">Cancel</button></div></section></div>`
