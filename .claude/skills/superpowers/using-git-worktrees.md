---
name: using-git-worktrees
description: Create isolated workspaces using git worktrees for safe parallel development.
source: github.com/obra/superpowers
---

## Step 0: Detection First
Check if you're already in isolation before creating anything.
Rule: "Detect existing isolation first. Then use native tools. Then fall back to git. Never fight the harness."

## Step 1a: Native Tools (Preferred)
Use platform-specific worktree creation if available — handles directory, branch, and cleanup automatically.

## Step 1b: Git Fallback
Only when no native tool exists. Directory priority:
1. User-declared preference in instructions
2. `.worktrees/` in project root (if git-ignored)
3. `worktrees/` in project root (if git-ignored)
4. Default: `.worktrees/`

## Critical Safety Rules
- **Verify git-ignore** before creating project-local worktrees — prevent accidental commits
- **Run baseline tests** after setup — report results before proceeding
- Never create nested worktrees without Step 0 detection

## Red Flags
- Creating worktrees when already isolated
- Using git commands when native tools exist
- Skipping ignore verification
- Proceeding with failed baseline tests without user permission
