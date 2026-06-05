---
name: verification-before-completion
description: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE. Run the command, read the output, then claim success.
source: github.com/obra/superpowers
---

## Core Rule
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.

## The 5-Step Gate (Mandatory)
1. Identify the command that proves the claim
2. Run the complete command — no cached results
3. Read full output thoroughly
4. Verify the output actually supports your claim
5. Only then make the claim — with the evidence

## Applies To All Positive Claims
- "Tests are passing"
- "The bug is fixed"
- "The build succeeds"
- "The feature works"
- "Requirements are met"

## Red Flag Language (Stop When You See This)
- "should work"
- "probably"
- "seems to"
- "Done!" (before verifying)
- "Perfect!" (before verifying)
- "I think this is ready"

These phrases signal rule violation. Run the verification first.

## What Does NOT Count as Verification
- Remembering the last run
- Assuming unchanged code still passes
- Delegating without independent confirmation
- Partial checks ("I verified the main part")

## Why It Matters
24 documented failure instances: broken trust, shipped undefined functions, missed requirements, wasted rework time. Skipping verification is dishonesty, not efficiency.
