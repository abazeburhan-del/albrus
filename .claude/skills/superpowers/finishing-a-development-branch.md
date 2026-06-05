---
name: finishing-a-development-branch
description: Complete development work safely: verify tests → detect environment → present options → execute → clean up.
source: github.com/obra/superpowers
---

## Workflow
verify tests → detect environment → present options → execute choice → clean up

## Step 1: Test Verification (Gate)
Run the full test suite. If tests fail → stop. Fix issues. Do not proceed until tests pass.

## Step 2: Environment Detection
Determine: normal repo (named branch) or git worktree (detached HEAD)?
This determines which menu to present.

## Step 3: Identify Base Branch
Find which main branch (`main` or `master`) the feature branch came from.

## Step 4: Present Options

**Normal repo (4 options):**
1. Merge locally → merge to base, verify tests, cleanup
2. Create PR → push branch, open pull request (preserve worktree)
3. Keep as-is → preserve everything for later
4. Discard → requires typed confirmation; permanently deletes work

**Detached HEAD (3 options):**
1. Merge locally
2. Keep as-is
3. Discard

## Step 5: Execute and Clean Up
- Cleanup only for merge or discard operations
- Only remove Superpowers-managed worktrees
- Never delete worktrees created by external systems

## Critical Rules
- Never proceed with failing tests
- Never merge without post-merge verification
- Never delete work without explicit typed confirmation
- Always detect environment before offering options
