---
name: subagent-driven-development
description: Orchestrates fresh subagents per task with mandatory two-stage code review for high-quality parallel execution.
source: github.com/obra/superpowers
---

## Core Concept
Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration.

## Process
1. Extract all tasks upfront from the plan
2. Per task:
   - Dispatch **implementer** subagent
   - Dispatch **spec reviewer** subagent → must pass
   - Dispatch **code quality reviewer** subagent → must pass
3. Address feedback loops until both reviewers approve
4. Mark complete → next task (no pausing between items)
5. Final review of entire implementation before done

## Critical Rules
- Never skip review stages
- Never accept "close enough" on spec compliance
- Address subagent questions BEFORE they begin work
- If reviewers find issues → implementer fixes → re-review
- Code quality review only AFTER spec compliance passes
- Fresh subagents per task — never reuse context across tasks

## Why Fresh Subagents?
- Minimizes file-reading overhead
- Surfaces questions early
- Catches defects via review checkpoints
- Maintains continuous momentum
- Isolated contexts prevent cross-contamination
