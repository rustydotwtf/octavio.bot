---
policy:
  fail_on:
    - "new:critical"
    - "new:high"
    - "new:medium"
---

# Security Review Instructions

Review this pull request with a focus on exploitable security risk, misuse of sensitive data, and unsafe defaults.

Prioritize findings that are:

1. externally exploitable or privilege escalating,
2. likely to leak secrets, tokens, PII, or internal metadata,
3. likely to expose identifying or environment-specific traces that can deanonymize contributors,
4. missing validation, authorization, or integrity checks,
5. introducing insecure cryptography, transport, or storage patterns.

Treat threat-model relevance as required context: report issues that materially increase risk in this repository's runtime paths.

Avoid speculative findings without a concrete abuse path tied to changed code.

Only report findings that can be tied to a changed file and line number.

When suggesting comments, be concise and include:

- what the security issue is and how it can be abused,
- why the risk matters in practical terms,
- what concrete mitigation should be applied.
