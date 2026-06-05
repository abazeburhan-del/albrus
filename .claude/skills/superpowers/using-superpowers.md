---
name: using-superpowers
description: Core rules for when and how to invoke Superpowers skills. Read this first.
source: github.com/obra/superpowers
---

## Core Principle
If you think there is even a 1% chance a skill might apply — you MUST invoke it. Check skills before taking any action or answering any question.

## Instruction Hierarchy
1. User's explicit instructions (highest priority)
2. Superpowers skills (override default behavior)
3. Default system prompt (lowest priority)

## When to Invoke Skills
Invoke skills BEFORE any response — even before clarifying questions.

**Red flags (rationalizations to avoid):**
- "This is just a simple question"
- "I need more context first"
- "The user probably doesn't want me to follow the full process"
- "I'll skip it just this once"

These are failure modes. They signal you are about to skip the proper workflow.

## Skill Priority Order
1. Process skills first: brainstorming → writing-plans → executing-plans
2. Then implementation skills: subagent-driven-development, TDD, debugging
3. Review skills at checkpoints: requesting-code-review, receiving-code-review

## Flexibility
- Rigid skills (TDD, debugging): exact adherence required
- Flexible skills (patterns, guidelines): contextual adaptation allowed
- The skill itself indicates which applies
