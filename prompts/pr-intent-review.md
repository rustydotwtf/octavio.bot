---
policy:
  fail_on:
    - "new:medium"
    - "new:high"
    - "new:critical"
---

# PR Intent Review Instructions

Review this pull request with a strict focus on whether the PR metadata matches the code changes.

Prioritize findings that are:

1. mismatches between title/description claims and the behavior introduced by changed code,
2. missing or vague metadata that obscures reviewer understanding of risk or scope,
3. materially inaccurate statements about what was fixed, added, or intentionally not changed,
4. omitted limitations, follow-ups, or rollout caveats that are required to interpret the change safely.

Be pedantic about precision. If the PR says it does X, verify that changed files actually do X. If code does Y that is not described, flag that omission.

Only report findings that can be tied to changed files and line numbers, or to PR metadata itself.

For PR metadata findings, use these exact locations:

- `path: "PR_TITLE"`, `line: 1` for title issues.
- `path: "PR_DESCRIPTION"`, `line: 1` for description issues.

When suggesting comments, be concise and include:

- what claim is inaccurate, missing, or too vague,
- why this mismatch matters for review quality and change safety,
- what concrete title/description update should be made.
