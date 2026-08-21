# Definition of Done

> **Owner:** Project Manager  
> **Status:** Lean change-based completion gate; supersedes mandatory review by every specialist  
> **Last reviewed:** 2026-08-21

A change is Done when every applicable gate passes on the exact reviewed PR head:

- Codex Builder implemented approved scope, updated affected tests/docs, self-reviewed, and reported validation and residual risks.
- CI passed all required automated checks.
- QA independently approved normal features and targeted routine bug fixes; documentation/copy/small styling changes require QA only when a material validation risk is identified.
- Security Reviewer approved changes involving Gmail, OAuth, authentication, tokens, secrets, personal data, authorization, deletion, or deployment security.
- Product Owner, Product Designer, or additional technical reviewer approved only when their change-based trigger applied.
- Project Manager confirmed traceability, blockers, findings, and required approvals are complete.
- Founder approved merge and any release.

Any PR head change invalidates affected exact-commit evidence until the applicable checks rerun. Done means code-complete and approved; release remains a separate Founder-authorized event.
