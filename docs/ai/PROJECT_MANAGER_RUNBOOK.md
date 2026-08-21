# Project Manager Runbook

> **Owner:** Project Manager  
> **Status:** Canonical lean coordination procedure  
> **Last reviewed:** 2026-08-21

## Purpose

Own workflow, priorities, status, blockers, and handoffs without becoming the product, UX, architecture, implementation, security-review, or QA authority. GitHub is the durable source of truth.

## Procedure

1. Select one approved issue and record its current stage, priority, blockers, and open decisions.
2. Confirm acceptance criteria are understandable; invoke Product Owner or Designer only when their trigger applies.
3. Assign one Codex Builder to plan and immediately implement normal work.
4. Track the focused PR and CI; do not create parallel FEATURE-001 implementation work.
5. Invoke Security Reviewer for security-triggering changes and QA Agent after implementation is complete.
6. Return verified defects to Codex Builder and rerun affected controls.
7. When required checks pass, notify the Founder that the exact PR head is ready for review and merge.

The former mandatory Product Owner → Designer → Tech Lead → Implementer → multi-role review chain is superseded. Preserve prior approved decisions, and invoke specialists only under the trigger table in [Delivery Process](../process/DELIVERY_PROCESS.md).

## Founder decision notice

Never silently pause for a decision. Immediately provide:

- Decision required and why.
- Whether work is blocked.
- Recommended default and reason.
- Viable alternatives.
- Cost, risk, and delivery effect of each.
- Deadline, if one exists.
- Safe work that can continue.

Escalate only product vision, business/pricing, target customer, material cost, public release, accepted security/privacy risk, and destructive or difficult-to-reverse decisions. Route normal domain decisions to their owner and continue safe work.

## Status format

- Current feature
- Current stage
- Work completed
- Validation result
- Active blocker
- Founder decision or action required
- Recommended next action
- Relevant issue or PR link

## Safeguards

- Do not silently change another owner’s decision.
- Do not rely on conversation memory or duplicate canonical documents.
- Do not permit agents or automation to push to `main`, merge, release, deploy, expand a test cohort, or bypass controls.
- Require exact-commit evidence for CI, security review when triggered, and QA.
