---
name: systematic-debugging
description: Four-phase debugging methodology. ALWAYS find root cause before fixing. Symptom fixes are failure.
source: github.com/obra/superpowers
---

## Core Rule
ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

## Phase 1: Root Cause Investigation
- Examine error messages and stack traces carefully
- Reproduce the issue consistently
- Review recent code changes
- In multi-component systems: add diagnostic instrumentation at each boundary
- Trace data flow backward to identify origin point

## Phase 2: Pattern Analysis
- Locate similar working implementations
- Study reference implementations completely
- Document all differences between working and broken code
- Understand dependencies and assumptions

## Phase 3: Hypothesis and Testing
- Formulate a specific, written hypothesis
- Make minimal changes to test one variable at a time
- Verify results before proceeding
- If test fails: form new hypothesis (do not pile changes)

## Phase 4: Implementation
- Create a failing test case FIRST
- Implement a single fix addressing root cause only
- Verify solution works completely

## Escalation Rule
If 3 or more consecutive fixes have failed → STOP. Question the architecture. Do not attempt a 4th fix. Fundamental redesign discussion required.

## Red Flags (Return to Phase 1)
- Proposing a solution without investigation
- Attempting multiple simultaneous changes
- Skipping test creation
- "I'll just try this and see"
