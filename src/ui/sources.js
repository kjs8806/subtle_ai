const svg = (paths) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const ICONS = {
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6Z"/>'),
  scan: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  records: svg('<path d="M9 3h6a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1V4a1 1 0 0 1 1-1Z"/><path d="M9 12h6M9 16h6"/>'),
}

// FEATURE-001: the interactive Gmail connect/scan/disconnect control lives
// here and only here - Overview shows a small read-only status card that
// links here rather than duplicating this control.
export const sourcesPageMarkup = () => `<div class="main-content wrap" id="page-sources"><header class="page-header"><div><p class="eyebrow">Data sources</p><h1>Sources</h1><p>Where Subtle AI is getting your subscription information.</p></div></header>

<section class="panel-card source-detail-card" aria-label="Gmail connection"><div class="panel-head"><h2>Gmail</h2></div><div class="source-list"><div class="source-row"><span class="service-icon icon-md" style="background:#fdece2;color:#b84f22">${ICONS.mail}</span><div class="who"><strong>Gmail</strong><span data-gmail-message>Connect to discover receipts</span></div><span data-gmail-status>Not connected</span></div></div><div class="source-actions"><button class="primary-button" data-gmail-action="connect" type="button">Find subscriptions from receipts</button><button class="quiet-button" data-gmail-disconnect type="button" hidden>Disconnect Gmail</button></div><div class="discovery-result" data-discovery-result hidden></div></section>

<section class="info-band" aria-label="How Subtle AI works"><div class="panel-card"><span class="info-icon">${ICONS.shield}</span><h3>Your data is private and secure</h3><p>We only read your emails to find subscription info. Your data is encrypted and never sold.</p></div><div class="panel-card"><h3>How it works</h3><ol class="how-steps"><li><span class="info-icon">${ICONS.scan}</span><div><h4>Scan Gmail</h4><p>We securely scan your Gmail for subscription emails.</p></div></li><li><span class="info-icon">${ICONS.search}</span><div><h4>Find &amp; extract</h4><p>We identify subscription emails and extract key details.</p></div></li><li><span class="info-icon">${ICONS.records}</span><div><h4>Create records</h4><p>We create subscription records with evidence from your emails.</p></div></li></ol></div><div class="panel-card"><h3>Last scan results</h3><ul class="scan-checklist" data-last-scan-results><li class="empty-state" style="padding:10px 0;border:0">No scans yet.</li></ul></div></section>
</div>`
