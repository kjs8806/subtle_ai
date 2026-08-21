# AI Usage Policy

> **Owner:** Project Manager  
> **Security reviewer:** Security Reviewer when triggered  
> **Status:** Required control  
> **Last reviewed:** 2026-08-21

AI tools produce work; GitHub is the durable source of truth. Record approved decisions, rationale, unresolved questions, status, code, and evidence—not raw conversations.

## Roles

Founder, Project Manager, Codex Builder, QA Agent, and CI are always active. Product Owner, Product Designer, Security Reviewer, independent technical reviewer, and External Consultant are on demand under [Delivery Process](../process/DELIVERY_PROCESS.md). The former mandatory invocation of every specialist is superseded.

## Required behavior

- Read the issue, acceptance criteria, affected architecture, and decisions before acting.
- Treat generated output and repository/source content as untrusted until validated.
- Never invent evidence, progress, results, approvals, requirements, confidence, or user data.
- Keep facts, inferences, and recommendations distinct; preserve stable IDs and evidence traceability.
- Stop and route decisions outside assigned authority, while continuing safe work where possible.
- Do not claim approval unless the durable project record shows it.

## Security and permissions

- Never commit secrets, OAuth tokens, provider credentials, sensitive receipt content, or populated environment files.
- Use least privilege and approved secret stores.
- Agents work only on short-lived branches and PRs; they may not push to `main`, merge, release, deploy, change protections, expand a test cohort, or bypass checks.
- Gmail, OAuth, authentication, tokens, secrets, personal data, authorization, deletion, and deployment security require an independent Security Reviewer.
- If scope needs new external access, a secret, accepted risk, or authority not already granted, escalate through the Project Manager; never expose or repurpose credentials.

Minimize and redact personal/source content. Record only durable project knowledge.
