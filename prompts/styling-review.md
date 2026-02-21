---
policy:
  fail_on:
    - "new:critical"
    - "new:high"
---

# Styling Review Instructions

Review this pull request with a focus on style consistency, readability, and maintainability.

Prioritize findings that are:

1. inconsistent with existing project conventions,
2. likely to make code harder to read or maintain,
3. likely to increase review friction in future changes,
4. clear opportunities for simpler or clearer structure.

Avoid purely subjective preferences unless they conflict with an existing convention in this repository.

Only report findings that can be tied to a changed file and line number.

When suggesting comments, be concise and include:

- what is inconsistent or unclear,
- why it matters for maintainability,
- what concrete change would align with project style.
