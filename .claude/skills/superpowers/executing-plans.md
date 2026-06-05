---
name: executing-plans
description: Implements a written plan step by step with review checkpoints.
source: github.com/obra/superpowers
---

## Steps

**1. Load and Review**
- Read the full plan critically
- Raise concerns before starting
- Create TodoWrite if no blockers

**2. Execute Tasks (Sequential)**
- Mark progress as you go
- Follow each step precisely
- Run verifications as specified
- Mark complete only after verification passes

**3. Completion**
- All tasks verified → invoke finishing-a-development-branch

## Critical Stopping Points
Stop immediately if you hit:
- Missing dependency or failing test
- Unclear instruction — ask, don't assume
- Repeated verification failures (3+) — something is architecturally wrong

## Rules
- Never implement directly on main/master without explicit user approval
- Always use git worktrees for isolation
- Verification is mandatory — "should work" is not evidence

## Dependencies
- using-git-worktrees (isolated workspace)
- writing-plans (the plan to execute)
- finishing-a-development-branch (after completion)
