# AI Usage Policy

> **Owner:** Project Coordinator  
> **Technical and security reviewer:** Tech Lead  
> **Status:** Required control  
> **Last reviewed:** 2026-08-20

## Operating rule

AI tools help produce work; GitHub is the durable source of truth. If a decision or instruction matters after a conversation ends, record the approved outcome in an issue, PR, decision log, or canonical document.

## Required behavior

- Read the assigned role, issue, acceptance criteria, approved design, architecture, and decisions before acting.
- Treat AI output as untrusted until reviewed and validated.
- Record approved decisions, rationale, unresolved questions, status, code, and evidence—not raw chat transcripts.
- Never invent evidence, progress, test results, approvals, requirements, confidence, or user data.
- Keep facts, inferences, and recommendations distinct.
- Preserve stable IDs and evidence traceability.
- Stop and route conflicts or missing authority to the owning role.

## Security and permissions

- Never commit secrets, OAuth tokens, provider credentials, sensitive receipt content, or populated environment files.
- Use least-privilege, role-appropriate access and approved secret stores.
- AI/automation identities work only on short-lived branches and PRs.
- They may not push to `main`, merge, release, deploy, change protections, or bypass required checks.
- Production Gmail, AI, bank, notification, background-sync, database, or secret-bearing integration requires explicit approved decisions and gates.

## Privacy

Do not paste private conversations or unnecessary personal/source content into repository artifacts. Minimize examples, redact sensitive data, and record only durable project knowledge.
