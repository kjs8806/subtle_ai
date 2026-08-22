# FEATURE-001 Codespaces Validation Approval

> **Authority:** Founder
> **Decision date:** 2026-08-20
> **Status:** Approved for supervised FEATURE-001 validation only
> **Environment:** Existing `kjs8806/subtle_ai` GitHub Codespace

## Decision

The Founder approves the existing `kjs8806/subtle_ai` GitHub Codespace as the temporary, Founder-supervised validation environment for FEATURE-001, subject to the controls and completion criteria in this approval package.

This approval resolves the FEATURE-001 validation-environment decision. It does not authorize public staging, production use, public onboarding, unsupervised external testing, merge, release, or expansion of the approved test cohort.

## Environment and cost boundary

- Infrastructure cost ceiling: **$0**.
- The Codespace is development/test only.
- It may not be used for public staging, production, public onboarding, or unsupervised external testing.
- PostgreSQL may run inside the Codespace for FEATURE-001 validation.
- Codespaces Secrets may temporarily store credentials for this controlled environment.
- Secrets, OAuth credentials, tokens, and sensitive receipt data must never be committed to the repository or exposed to browser code or logs.

## Identity, token, and disconnect controls

- Gmail tokens must receive application-level encryption.
- Gmail tokens remain server-side.
- The signed-in application identity and the Gmail identity must match by Google subject identifier.
- Disconnect must revoke Gmail tokens and prevent future Gmail discovery.
- Disconnect must purge Gmail-derived data for the controlled FEATURE-001 validation environment.
- Sensitive authorization material and email bodies must not appear in development or debug logs.

These are approved constraints. The Tech Lead owns the technical design and verification approach.

## Gate before first real-Gmail validation

All of the following are required before the first real-Gmail validation:

- A separate Security Review Agent approves the applicable threat model and security controls.
- Independent QA validates the approved flow and applicable acceptance criteria.
- Required CI checks pass for the exact reviewed commit.
- The Founder explicitly authorizes the first real-Gmail validation.

Automation may prepare implementation and review artifacts, but may not merge, release, expand the validation cohort, or bypass these gates.

## Deferred decisions and controls

The following remain deferred and are not implied by this approval:

- Managed hosting.
- Managed PostgreSQL.
- Production KMS.
- Public Google OAuth verification.
- Human application-security assessment.
- Public staging or production operations.
- Public onboarding or unsupervised external testing.

These items must be reconsidered before their relevant release or environment gate. Deferral does not weaken the controls required for the supervised Codespaces validation.

## Traceability and related authority

- Product requirements and completion criteria: [FEATURE-001](../product/features/FEATURE-001.md).
- Current and target architecture: [ARCHITECTURE.md](ARCHITECTURE.md).
- Approved technical decisions: [TECH_DECISIONS.md](TECH_DECISIONS.md).
- Security boundaries and threat-model requirement: [SECURITY.md](SECURITY.md).
- Deployment and release gates: [DEPLOYMENT.md](DEPLOYMENT.md).
- Real-Gmail validation setup runbook and findings: [REAL_GMAIL_VALIDATION.md](REAL_GMAIL_VALIDATION.md).

FEATURE-001 remains **Implementing**. This approval authorizes the Tech Lead to produce the remaining implementation plan within these constraints; it does not itself authorize implementation beyond the approved plan or declare FEATURE-001 complete.

## Next handoff

The Project Coordinator routes this package, the approved FEATURE-001 validation envelope, the architecture and technical-decision documents, and current implementation/test evidence to the Tech Lead.

The Tech Lead must return:

- the remaining implementation sequence;
- the required threat model and security controls;
- the Codespaces PostgreSQL, identity, token-custody, revocation, and purge design;
- test and validation instructions;
- precise implementation-agent instructions; and
- any decision that materially exceeds this approval for Founder review.
