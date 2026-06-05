---
name: writing-skills
description: How to create new Superpowers skills using TDD principles. NO SKILL WITHOUT A FAILING TEST FIRST.
source: github.com/obra/superpowers
---

## Core Rule
NO SKILL WITHOUT A FAILING TEST FIRST.

## What Makes a Valid Skill
- Reusable technique, pattern, or reference guide
- Not a narrative about solving one-off problems
- Lives in `~/.claude/skills` or `.claude/skills/`

## The TDD Cycle for Skills

**RED — Baseline Without the Skill**
- Run baseline scenarios without the skill
- Document exactly how the agent naturally behaves (wrong behaviors)
- These failures define what the skill must fix

**GREEN — Minimal Documentation**
- Write minimal skill content addressing those specific failures
- Nothing more than what's needed to fix the observed failures

**REFACTOR — Bulletproof Against Rationalization**
- Identify new rationalizations agents discover
- Add explicit counters for each rationalization
- Build a red flags list

## Critical: Description Field
The description must describe ONLY the triggering conditions — never summarize the workflow.

**Bad:** "Performs two-stage code review between tasks" → agent follows description instead of reading the skill
**Good:** "Code review required after each task and before merge"

## Deployment Requirement
Each skill must be tested before deployment. No batching, no skipping. Complete the checklist per individual skill.
