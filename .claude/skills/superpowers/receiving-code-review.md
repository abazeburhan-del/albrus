---
name: receiving-code-review
description: Evaluate code review feedback with technical rigor. Verify before implementing. Actions speak — just fix it.
source: github.com/obra/superpowers
---

## Core Approach
Read completely → verify → implement one item at a time → test each fix.

## Response Framework
- Do NOT say "You're absolutely right!" or "Great catch!"
- Restate the technical requirement or just fix it
- Actions speak. The code shows you heard the feedback.

## Handling Unclear Items
If you understand items 1-3 and 6 but not 4-5:
- Stop before implementing anything
- Request clarification on items 4 and 5 specifically
- Do not partial-implement what you understand

## Evaluating External Feedback
Before implementing, verify:
- Does it align with the codebase's actual needs?
- Could it break existing functionality?
- Does the reviewer understand the full context?

If technically incorrect → push back with specific reasoning, not deference.

## Implementation Order
1. Blocking issues first (breaks, security risks)
2. Simple fixes (typos, imports)
3. Complex changes last

Test each fix individually before moving to the next.

## When You Were Wrong
State the correction factually. No lengthy apologies. No over-explanation. Fix it and move on.
