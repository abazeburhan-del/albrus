---
name: test-driven-development
description: Write the test first. Watch it fail. Write minimal code to pass. No exceptions.
source: github.com/obra/superpowers
---

## The Rule
Write the test first. Watch it fail. Write minimal code to pass. This sequence is non-negotiable.

## The Three-Phase Cycle

**RED — Write a Failing Test**
- One test at a time
- Demonstrates desired behavior
- Use real code, not mocks when possible
- Must watch it fail before proceeding

**GREEN — Minimal Implementation**
- Write only enough code to pass that test
- No extra features, no over-engineering
- No unrelated changes

**REFACTOR — Clean Up**
- Remove duplication
- Improve clarity
- All tests must remain green

## Why Sequence Matters
Tests written after implementation pass immediately — proving nothing. You cannot verify the test validates what you intend. Watching the failure forces discovery of actual requirements.

## Non-Negotiable Standards
- Wrote code before the test? Delete it. Start over.
- No exceptions for "reference" code or "just checking"
- Watch each test fail correctly before coding
- Confirm all tests pass after implementation

## Red Flags Requiring Restart
- "Skip TDD just this once"
- "Keep it as reference code"
- "I'll add tests later"
- "Manual testing is enough here"

These rationalizations mean you've abandoned the methodology. Stop. Start over.
