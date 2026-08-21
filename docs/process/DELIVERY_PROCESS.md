# Delivery Process

> **Owner:** Project Manager  
> **Status:** Canonical lean workflow; supersedes the former mandatory multi-role chain  
> **Last reviewed:** 2026-08-21

## Operating model

Always active: Founder, Project Manager, Codex Builder, QA Agent, and CI.

On demand:

- Product Owner: new behavior, unclear requirements, prioritization, or scope conflict.
- Product Designer: meaningful flow, information-architecture, or UI decision.
- Security Reviewer: authentication, OAuth, Gmail, tokens, personal data, authorization, secrets, deletion, or deployment security.
- External Consultant: periodic process review, serious delivery problems, or Founder-requested assessment.

The previous requirement to invoke every specialist for every feature is superseded. Existing approved product, design, and technical decisions remain valid.

## Normal workflow

1. Select one approved GitHub issue and confirm its acceptance criteria are understandable.
2. Codex Builder writes a concise technical plan, identifies assumptions and material risks, then implements unless a genuine decision or material risk requires escalation.
3. Codex Builder adds tests, updates affected documentation, self-reviews, and runs required validation.
4. Open one focused pull request and run CI.
5. QA Agent independently validates the completed implementation.
6. Verified defects return directly to Codex Builder; affected validation reruns after changes.
7. When CI and QA pass, Project Manager tells the Founder the PR is ready for review and merge.

No agent or automation may merge, release, deploy, push to `main`, or bypass controls.

## Change-based review

| Change | Minimum controls |
| --- | --- |
| Copy, documentation, or small styling | Codex Builder and CI |
| Routine bug fix | Codex Builder, CI, and targeted QA |
| Normal feature | Codex Builder, CI, and QA |
| Material UX change | Product Designer before implementation |
| New or materially changed product behavior | Product Owner before implementation |
| High-risk shared architecture or database change | Additional independent technical review |
| Gmail, OAuth, authentication, tokens, secrets, or personal data | Independent Security Reviewer |
| Production merge or release | Founder approval |

Do not create review rounds beyond the applicable row.

## Decision escalation

Agents resolve normal decisions within their authority. Escalate to the Founder only for product vision, business model or pricing, target customer, material cost, public release, accepted sensitive-data/security/privacy risk, or destructive/difficult-to-reverse changes.

When a Founder decision is needed, the Project Manager immediately reports: decision required; why; whether work is blocked; recommended default and reason; viable alternatives; cost, risk, and delivery effect; deadline if any; and safe work that can continue.

## FEATURE-001 work-in-progress limit

Until FEATURE-001 is complete, maintain one active implementation workstream and one implementation PR. Do not run multiple Codex implementation workers or start unrelated feature implementation. Unrelated documentation or analysis is allowed only when it does not delay FEATURE-001.

## Durable records

Keep GitHub issues for scope and criteria, README for setup and commands, architecture documentation for the current system, ADRs only for consequential decisions, PR descriptions for implementation/validation evidence, and one concise current-status record. Do not store raw chat transcripts or lengthy handoff reports when a short GitHub update is sufficient.

Lifecycle vocabulary remains: **Proposed → Product Defined → Design Ready → Technical Ready → Implementing → Review → Changes Required / Approved → QA Approved → Done → Released → Measured**. A stage may be skipped when its trigger does not apply; it may move backward when new evidence invalidates a gate.
