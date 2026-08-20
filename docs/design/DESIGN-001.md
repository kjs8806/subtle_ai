# DESIGN-001 — Overview UX Simplification

> **Owner:** Senior Product Designer  
> **Status:** Proposed design specification  
> **Date:** 2026-08-20  
> **Related:** [UX Principles](UX_PRINCIPLES.md), [Design System](DESIGN_SYSTEM.md), [Design Decisions](DESIGN_DECISIONS.md), [FEATURE-001](../product/features/FEATURE-001.md)

## 1. Purpose

Simplify the Subtle AI overview experience so the product feels like a calm, intelligent subscription assistant rather than a dense analytics dashboard.

The interface should help users answer, in order:

1. What am I spending?
2. Is anything important happening?
3. What should I do?
4. What subscriptions do I have?

The experience should prioritize decisions over dashboard exploration.

## 2. Design principle

**Subtle should feel calm, intelligent, and quiet. It should surface financial decisions rather than make users analyze a dashboard.**

Primary interaction model:

**Notice → Understand → Decide → Act**

This replaces the weaker dashboard-oriented pattern:

**Metrics → Widgets → Explore**

## 3. Scope

This design changes the information hierarchy and presentation of:

- Overview screen
- Recommendation / savings presentation
- Subscription list rows
- Subscription Detail hierarchy
- Gmail connection disclosure
- Data-source prominence
- Navigation behavior
- Accessibility and responsive behavior related to the above

This design does **not** change product requirements, business rules, recommendation logic, billing calculations, Gmail permissions, backend architecture, or subscription-detection behavior.

## 4. User flow

### Returning user

1. User opens Subtle AI.
2. Overview immediately communicates monthly recurring spend.
3. User sees whether Subtle found anything worth attention.
4. User reviews a recommendation if one exists.
5. User may review upcoming renewals.
6. User may scan the simplified subscription list.
7. Selecting a subscription opens Subscription Detail.

### User acting on a recommendation

1. User sees a recommendation in **Worth your attention**.
2. Recommendation states affected service(s), why it matters, and quantified savings only when supported.
3. User selects **Review**.
4. Detail view explains the issue and supporting evidence.
5. User chooses the relevant approved action or leaves without acting.

### Gmail discovery

1. User chooses to find subscriptions from receipts.
2. Disclosure explains purpose and trust boundaries before authorization.
3. User continues to Gmail or selects **Not now**.
4. During scanning, the rest of the app remains usable.
5. Result is announced accessibly.
6. Successful discovery ends in review of the discovered subscription and its evidence.

## 5. Overview screen structure

Desktop hierarchy:

1. Global navigation
2. Greeting / context
3. Primary spending summary
4. Worth your attention
5. Coming up
6. Your subscriptions
7. Low-prominence sync/source status where appropriate

### 5.1 Greeting

Retain the personalized greeting and restrained editorial typography.

Example:

- `Good morning, Jun.`
- Supporting copy should be short and not compete with financial information.

Do not add extra badges, source labels, or status indicators to the greeting area.

### 5.2 Primary spending summary

Replace the current three-card equal-weight summary with a clear hierarchy.

Required content:

- Monthly recurring spend — **primary**
- Month-over-month change, when supported — **secondary**
- Potential savings, when supported — **secondary**
- Subscription count — **tertiary**

Illustrative hierarchy:

```text
$247.84
monthly subscriptions
↓ $18 from last month

Potential savings   $64/month
12 subscriptions
```

Do not give subscription count equal visual weight to spend or actionable savings.

### 5.3 Worth your attention

Rename the existing **Savings feed** to **Worth your attention**.

Purpose:

- Present only items that require or benefit from user attention.
- Avoid implying every insight must be a savings opportunity.
- Support future cases such as renewal risk, price increase, overlap, duplicate charge, or other approved attention states.

Header:

- Title: **Worth your attention**
- Supporting text may show the number of actionable opportunities when known.
- Remove redundant system-facing copy such as `Ranked by potential impact` and `Watching your spend` unless it materially helps a decision.

### 5.4 Recommendation card anatomy

Each recommendation card should contain only:

1. Type / concise label
2. Affected service(s)
3. One-sentence explanation
4. Quantified impact when supported
5. Primary action
6. Optional dismiss / keep action when product-approved

Example:

```text
Possible overlap
Dropbox + Google One

You may be paying twice for similar cloud storage.

Potential savings    $15.99/mo

[Review]                         •••
```

Avoid decorative metadata that does not help the user decide.

### 5.5 Remove separate AI analysis card

The standalone **Subtle AI / Personalized analysis** sidebar card should be removed from Overview.

Rationale:

- It duplicates the same intelligence already represented in recommendations.
- It creates ambiguity about the difference between `Subtle analysis` and the recommendation feed.
- AI should be embedded in the product experience rather than represented as a separate widget.

Approved conceptual replacement:

`Subtle found 3 things worth your attention.`

This may appear as supporting copy in the recommendations section, not as a competing card.

### 5.6 Coming up

Keep upcoming renewals visible but subordinate to actionable recommendations.

Each row should emphasize:

- Service
- Date
- Amount
- Exceptional state only when meaningful, e.g. `Price changed`

Do not overload the row with extra metadata.

### 5.7 Data-source status

Data-source management should not occupy major recurring dashboard real estate after setup.

Overview may show a lightweight status such as:

- `Updated today`
- `Gmail connected`
- `Reconnect needed`

Detailed source management should live in an appropriate settings / connected-accounts location when that product area exists.

Until such a destination is approved, retain only the minimum source controls needed to satisfy FEATURE-001 without allowing them to visually compete with spend, recommendations, or subscriptions.

## 6. Subscription list design

### 6.1 Default row

Reduce default row density.

Required visible information:

- Service identity
- Plan, if useful
- Price
- Renewal date

Example:

```text
[N] Netflix                     $22.99
    Premium                  Sep 14
```

### 6.2 Attention state

Display a signal only when the subscription needs attention.

Example:

```text
[D] Dropbox                     $15.99
    Plus · Possible overlap
```

Do not show neutral status text for every row.

**Absence of an alert should create visual silence.**

### 6.3 Move secondary metadata to detail

The following should generally move to Subscription Detail unless needed for a current decision:

- Category
- Source
- Confidence
- Generic status
- Provenance detail
- Historical context

## 7. Subscription Detail structure

Reorganize around three user questions.

### 7.1 What am I paying?

Top section includes:

- Service name
- Plan
- Current cost
- Billing cadence
- Next charge
- Annualized cost when useful

### 7.2 What did Subtle notice?

If an actionable recommendation exists, present:

- Recommendation type
- Concise explanation
- Affected related subscription(s)
- Potential savings only when evidence supports it
- Primary review / action CTA

Example:

```text
Possible overlap

You're also paying for Google One.

Potential savings
$191.88/year

[Review comparison]
```

### 7.3 How do we know?

Trust and provenance section should show the minimum necessary evidence context:

- Source
- Last confirmed timestamp when real
- Provenance label
- Confidence where applicable

Example:

```text
Detected from Gmail receipt
Last confirmed Aug 22
High confidence
```

Field-level provenance should be used where different fields have different support.

### 7.4 Progressive disclosure

Price history and billing history should not compete with the primary decision.

Present them as lower-priority sections, collapsible or visually de-emphasized where appropriate.

Do not remove access to them if they are part of approved product scope.

## 8. Gmail connection design

### 8.1 Entry point language

Prefer user-goal language over technical connection language.

Primary label:

**Find subscriptions from receipts**

Avoid making `Connect Gmail` the primary user-facing concept where the user's actual goal is discovery.

### 8.2 Disclosure structure

Before authorization, show:

**Find subscriptions from receipts**

Supporting explanation:

`Subtle looks for subscription receipts to help build your subscription list.`

Trust points:

- Looks for subscription receipts
- Shows what was detected
- Disconnect anytime

Actions:

- Primary: **Continue with Gmail**
- Secondary: **Not now**

The disclosure must remain consistent with the exact permissions and privacy behavior approved by Product / Engineering. Do not imply narrower access than the real OAuth scope provides.

### 8.3 Async scanning

During scanning:

- Keep the rest of the app navigable.
- Do not show fake progress percentages.
- Prevent duplicate scan activation.
- Announce scanning state through an appropriate live region.
- Announce result or failure.

Examples:

- `Scanning receipts…`
- `3 subscriptions found.`
- `No qualifying subscription receipts found.`
- `Receipts could not be scanned. Try again.`

## 9. Navigation

Current `Overview | Subscriptions | Savings` navigation should be reconsidered because Savings is not a distinct enough destination in the current experience.

Preferred design direction:

- **Overview**
- **Subscriptions**

Recommendations live naturally within Overview.

However, removing or renaming a top-level destination changes product information architecture and therefore requires Product Owner approval before implementation.

Until approved, do not silently remove the Savings destination.

### Mobile

Mobile navigation must not simply hide desktop links without replacement.

Approved implementation must provide a discoverable mobile navigation pattern, such as:

- compact menu
- bottom navigation, if later product direction supports it
- another explicit responsive pattern approved by Design

The Tech Lead owns implementation mechanics; Design owns discoverability and interaction behavior.

## 10. Component hierarchy

Target Overview hierarchy:

```text
AppShell
├── GlobalNav
├── OverviewHeader
├── SpendingSummary
│   ├── MonthlySpend
│   ├── SpendDelta
│   ├── PotentialSavings
│   └── SubscriptionCount
├── AttentionSection
│   ├── SectionHeader
│   └── RecommendationCard[]
├── UpcomingRenewals
├── SubscriptionSection
│   ├── SectionHeader
│   └── SubscriptionRow[]
└── LightweightSyncStatus
```

Target Subscription Detail hierarchy:

```text
SubscriptionDetail
├── IdentityAndCost
├── RecommendationSummary? 
├── EvidenceAndProvenance
├── PriceHistory
└── BillingHistory
```

## 11. Interaction behavior

- Recommendation primary action opens the relevant review/detail state.
- Subscription row is fully clickable/tappable.
- Secondary actions must not compete visually with primary actions.
- Dismiss controls require an accessible name.
- No entire-card click target should conflict with nested buttons.
- Dialogs must trap focus where appropriate and restore focus to the triggering element on close.
- Escape closes non-destructive dialogs.
- Loading and async states must not freeze unrelated navigation.

## 12. Loading states

### Overview initial loading

When real asynchronous data loading exists:

- Preserve page structure.
- Use lightweight skeletons or reserved space rather than spinner-heavy blocking screens.
- Avoid animating every card independently.
- Do not display fabricated values during loading.

### Recommendation loading

If recommendations are still being evaluated:

- Show neutral state text such as `Checking for opportunities…` only if a real process is occurring.
- Keep existing confirmed subscription information available.

### Gmail scanning

Use indeterminate scanning presentation unless real progress is available.

## 13. Empty states

### No subscriptions

Primary message should explain the next useful action.

Example:

**No subscriptions yet**  
`Add one manually or find subscriptions from receipts.`

Actions:

- **Find subscriptions from receipts**
- **Add manually**

### No recommendations

Do not present an empty `Worth your attention` container as an error.

Example:

**Nothing needs your attention right now.**

Do not imply permanent optimization or claim there are no savings opportunities beyond what the system actually knows.

### No upcoming renewals

Hide the section or show a minimal neutral empty state. Do not reserve a large card for no content.

## 14. Error states

### Overview data error

- Preserve any successfully loaded information.
- Show localized error near the affected section.
- Provide retry when recovery is possible.

### Gmail authorization error

Keep separate from scanning errors.

Example:

**Gmail couldn't be connected.**  
`Try again or continue without Gmail.`

### Gmail scan error

If authorization remains valid:

**Gmail is connected, but receipts couldn't be scanned.**

Action:

**Try again**

Do not incorrectly revert the connection state to `Not connected`.

## 15. Success states

### Added manually

Confirm success without blocking continuation.

Example:

`Netflix added.`

The subscription should immediately appear in the list and totals should update from real data.

### Gmail discovery

Success should communicate user value, not only technical connection.

Example:

`3 subscriptions found.`

Primary action:

**Review subscriptions**

## 16. Responsive behavior

### Desktop

- Keep generous whitespace.
- Primary content should remain visually dominant over supporting side content.
- Avoid returning to a dense three-column dashboard pattern.

### Tablet

- Collapse supporting content below the main content when horizontal space becomes constrained.
- Preserve information hierarchy, not merely column order.
- Recommendation cards remain full-width enough for readable copy.

### Mobile

Order:

1. Greeting
2. Monthly spend
3. Potential savings / summary
4. Worth your attention
5. Coming up
6. Subscriptions
7. Source / sync status

Requirements:

- No horizontal scrolling.
- Minimum 44 × 44 CSS-pixel interactive targets.
- Dialogs fit viewport and scroll internally when needed.
- Navigation remains discoverable.
- Subscription rows do not become miniature desktop tables.

## 17. Accessibility

Required:

- Minimum 44 × 44 CSS-pixel tap targets for primary interactive controls.
- Visible keyboard focus for all interactive elements.
- Semantic headings in logical order.
- State must never rely on color alone.
- Dialog focus trap and focus restoration.
- Escape dismissal for safe dialogs.
- Async scan/discovery/error updates announced through an appropriate live region.
- Recommendation impact and status labels must remain understandable without icons.
- Motion respects `prefers-reduced-motion`.
- Text contrast must meet WCAG AA for normal text and interactive controls.
- Entire clickable rows need clear accessible names and predictable keyboard activation.

## 18. Design-system components to reuse

Reuse and refine existing visual language rather than introducing a new brand direction:

- Brand mark
- Playfair Display for editorial emphasis
- Space Grotesk for functional interface copy
- DM Mono sparingly for metadata
- Existing paper / sage / coral visual palette
- Existing card borders and restrained surfaces
- Existing service icon treatment
- Existing button styles, adjusted to meet target-size/accessibility requirements
- Existing modal/detail presentation patterns, corrected for hierarchy and focus behavior

Do not introduce a new color palette, illustration system, heavy gradients, glassmorphism, or chat-first UI as part of DESIGN-001.

## 19. Visual simplification rules

1. Do not use a badge when plain text is enough.
2. Do not show a status when nothing requires attention.
3. Do not repeat the same AI insight in multiple components.
4. Do not give tertiary metadata equal visual weight to money or actions.
5. Prefer whitespace over additional container chrome.
6. Use accent color for meaning and emphasis, not decoration everywhere.
7. Keep metadata close to the decision it supports.
8. If an element does not help the user understand or act, remove or de-emphasize it.

## 20. UX/UI acceptance criteria

### Overview hierarchy

- [ ] Monthly recurring spend is the dominant financial element above the fold.
- [ ] Potential savings, when supported, is visually secondary to spend but more prominent than subscription count.
- [ ] Subscription count is tertiary metadata rather than an equal-weight summary card.
- [ ] Overview does not present multiple competing AI/recommendation widgets.

### Recommendations

- [ ] `Savings feed` is replaced by an approved user-centered label, with **Worth your attention** as the design recommendation.
- [ ] Each recommendation states the affected service(s), issue, supported impact, and one clear primary action.
- [ ] Recommendations do not include redundant system metadata that does not help a user decide.
- [ ] No separate `Subtle AI / Personalized analysis` card duplicates recommendation content.

### Subscription list

- [ ] Default subscription rows are scannable and do not present category, source, signal, renewal, price, cadence, and status simultaneously unless those fields are decision-relevant.
- [ ] Neutral subscriptions remain visually quiet.
- [ ] Attention signals appear only when actionable or important.
- [ ] Rows work cleanly on mobile without horizontal table behavior.

### Subscription Detail

- [ ] Detail clearly answers `What am I paying?`, `What did Subtle notice?`, and `How do we know?` in that order.
- [ ] Evidence/provenance is visible without overwhelming the primary decision.
- [ ] Price and billing history are visually subordinate to current cost and actionable recommendations.
- [ ] Missing evidence or values are not fabricated.

### Gmail

- [ ] User-facing entry point emphasizes finding subscriptions, not merely connecting a technical source.
- [ ] Disclosure includes purpose, relevant trust information, Continue, and Not now.
- [ ] Authorization state and scanning state remain distinct.
- [ ] Scanning does not block unrelated navigation.
- [ ] Scan results and errors are announced accessibly.

### Navigation and responsive behavior

- [ ] Mobile navigation has a discoverable replacement for desktop links.
- [ ] No interactive target intended for touch is smaller than 44 × 44 CSS pixels without an approved exception.
- [ ] No horizontal overflow occurs at supported mobile widths.
- [ ] Information hierarchy is preserved when columns collapse.

### Accessibility

- [ ] Dialogs trap focus and restore it to the trigger when closed.
- [ ] Visible focus styles exist for all controls.
- [ ] Async status changes use an appropriate live region.
- [ ] State and recommendation meaning are not communicated by color alone.
- [ ] Reduced-motion preference is respected.

## 21. Product decisions requiring Product Owner approval

DESIGN-001 recommends, but does not independently authorize:

1. Removing or renaming the top-level **Savings** navigation destination.
2. Moving persistent source management to a future **Settings / Connected accounts** destination.
3. Any change to product scope, recommendation types, or approved user actions.

The Coordinator should route these items to the Product Owner before implementation if the engineering plan depends on them.

## 22. Tech Lead handoff notes

The Tech Lead should preserve the existing Vite/JavaScript/PWA architecture unless a technical limitation requires otherwise.

Implementation should focus on hierarchy and component simplification rather than a rewrite.

Before issuing Copilot implementation instructions, the Tech Lead should identify:

- which existing Overview sections are removed, merged, or reordered
- how recommendation rendering is reused after the AI-card merge
- responsive navigation implementation
- focus-management strategy for dialogs
- live-region strategy for scanning and discovery
- whether any current product requirement conflicts with the simplified subscription-row design

## 23. Design review gate

After implementation, Senior Product Designer review is required before DESIGN-001 is considered complete.

Review will verify:

- visual hierarchy
- reduced dashboard density
- recommendation clarity
- mobile behavior
- detail hierarchy
- Gmail trust presentation
- accessibility states
- consistency with the existing Subtle visual identity

Significant UX regressions, inaccessible navigation, duplicated AI/recommendation concepts, or a return to equal-weight dashboard widgets are blocking issues.
