---
name: brainstorming
description: Use before any implementation. Explores intent, requirements and design before writing code. MANDATORY for new features, components, or behavior changes.
source: github.com/obra/superpowers
---

## Core Gate
Do NOT write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it.

## Process (9 Steps)
1. Explore project context — read existing files and docs
2. Offer visual companion (mockup/diagram) if applicable — in a separate message
3. Ask clarifying questions — ONE at a time
4. Propose 2-3 approaches with trade-offs
5. Present design sections and gather approval
6. Write design doc to `docs/superpowers/specs/`
7. Self-review spec for completeness and consistency
8. Ask user to review the written spec
9. Invoke writing-plans skill for implementation planning

## Key Constraints
- **One question per message** — never overwhelm with a list
- **Multiple-choice preferred** over open-ended questions
- **No "too simple" exceptions** — even trivial tasks require design approval
- **Only writing-plans comes next** — no direct implementation

## Self-Review Checklist (Before Handing Off)
- [ ] No placeholder language ("TBD", "TODO", "later")
- [ ] Internally consistent across all sections
- [ ] Scope is a single implementation unit
- [ ] Requirements are unambiguous
