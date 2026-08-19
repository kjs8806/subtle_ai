---
name: commit-and-push
description: "Use when the user explicitly asks to commit and push all current repository changes. Review the worktree, run available validation, stage all changes, create a commit, and push the current branch to its configured upstream."
user-invocable: true
---

# Commit And Push

Safely commit and push the repository's current changes when the user explicitly requests it.

## Workflow

1. Inspect the repository state:
   - Run `git status --short --untracked-files=all`.
   - Confirm the current branch and configured upstream with `git branch --show-current` and `git remote -v`.
   - Review the diff summary with `git diff --stat` and `git diff --cached --stat`.
2. Run the narrowest available validation for the repository. Prefer the documented test and build commands, then run `git diff --check`.
3. Report any failing validation and stop before committing unless the user explicitly asks to commit despite failures.
4. Stage all current changes with `git add -A`.
5. Recheck the staged diff with `git diff --cached --check` and `git diff --cached --stat`.
6. Create one non-interactive commit using the user-provided message. If no message was provided, choose a concise imperative message based on the staged changes.
7. Push the current branch to its configured upstream. If no upstream is configured, stop and ask the user which remote and branch to use.
8. Verify the result with `git status --short --untracked-files=all`, `git log -1 --oneline`, and the remote branch ref when practical.

## Safety Rules

- Only run this workflow after an explicit commit-and-push request.
- Never use `git reset --hard`, `git checkout --`, force-push, branch deletion, or history rewriting.
- Do not discard, revert, or overwrite existing user changes.
- Include all current changes only when the user said “all changes”; otherwise stage only the requested files.
- Do not expose credentials, tokens, or secret values in output.
- Do not bypass hooks or use `--no-verify` unless the user explicitly requests it.
- Do not claim success until both the commit and push commands succeed and the worktree result has been checked.

## Output

Report:

- Commit hash and message.
- Remote and branch pushed.
- Validation commands and results.
- Whether the worktree is clean.
- Any remaining limitation, rejected hook, merge conflict, or push failure.
