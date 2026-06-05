---
name: writing-plans
description: Creates detailed step-by-step implementation plans after brainstorming is approved.
source: github.com/obra/superpowers
---

## Purpose
Generate comprehensive, actionable plans — assume the engineer has minimal codebase context but strong development skills.

## Plan Structure
1. **Header:** Goal, architecture overview, tech stack
2. **File structure map:** Each file's responsibility
3. **Numbered tasks** with files affected
4. **Steps with checkboxes** for progress tracking

## Task Requirements
- Bite-sized: 2-5 minutes each
- Exact file paths — no vague "update the component"
- Complete code snippets — no placeholders like "add error handling"
- TDD cycle per task: failing test → implement → passing test → commit
- Expected output after each verification step

## Anti-Patterns (Never Do)
- "TBD", "TODO", "add appropriate logic"
- Generic instructions without concrete code
- Tasks longer than 5 minutes
- Inconsistent type/function names across tasks

## Save Location
`docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`

## After Writing
Offer two execution modes:
- **Subagent-driven:** Fresh agent per task (higher quality)
- **Inline:** Sequential with checkpoints (faster)
