---
name: requesting-code-review
description: Review early, review often. Dispatch a specialized reviewer subagent after each task and before merging.
source: github.com/obra/superpowers
---

## When Reviews Are Required
- After completing each task in subagent-driven development
- After major feature completion
- Before merging into main branch

## When Reviews Are Beneficial
- When stuck on a problem
- Before refactoring
- After resolving complex bugs

## Process
1. **Get git commits** — identify baseline SHA and current SHA
2. **Dispatch reviewer subagent** with focused context:
   - Description of what was implemented
   - Requirements from the spec
   - Baseline and current commit SHAs
3. **Categorize feedback:**
   - Critical → must fix before proceeding
   - Important → fix before merge
   - Minor → fix if time allows

## Critical Guidelines
- Never skip reviews
- Never ignore Critical issues
- Never proceed with unfixed Important problems
- Push back on feedback with technical reasoning when warranted — reviewers can be wrong
