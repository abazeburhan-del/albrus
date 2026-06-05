---
name: dispatching-parallel-agents
description: Dispatch one agent per independent problem domain and let them work concurrently. Use when multiple unrelated failures exist.
source: github.com/obra/superpowers
---

## When to Use
- Multiple failures across different areas/files/subsystems
- Problems are independent with no shared dependencies
- Each investigation needs isolated context
- Agents won't interfere with each other

## When NOT to Use
- Failures are related or share a root cause
- Full system understanding is needed
- Agents would compete for shared resources

## Process
1. **Identify independent domains** — group failures by what's broken
2. **Create focused tasks** — one clear scope per agent
3. **Dispatch concurrently** — all agents work simultaneously
4. **Review and integrate** — verify no conflicts, run full test suite

## Agent Prompt Requirements
Each prompt must be:
- Focused on one problem domain only
- Self-contained with all necessary context
- Explicit about expected output format

**Bad:** "Fix all the tests"
**Good:** "Fix the failing tests in `auth.test.ts` — the login token validation is returning 401 for valid tokens. Baseline: commit abc123."

## Demonstrated Benefit
Fixed 6 failures across 3 files by dispatching 3 parallel agents → all fixes concurrent, zero conflicts.
