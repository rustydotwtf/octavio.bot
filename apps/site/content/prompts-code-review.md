---
policy:
  fail_on:
    - "new:critical"
    - "new:high"
title: "Code Review"
group: "prompts"
order: 1
---

# Code Review Instructions

Review this pull request with a focus on correctness, security, and maintainability.

Prioritize findings that are:

1. likely bugs or regressions,
2. security-sensitive,
3. likely to cause production issues,
4. expensive to maintain later.

Only report findings that can be tied to a changed file and line number.

When suggesting comments, be concise and include:

- what is wrong,
- why it matters,
- what to change.
