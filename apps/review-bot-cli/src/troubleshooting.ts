export const troubleshootingGuidance = (message: string): string[] => {
  const lower = message.toLowerCase();
  const guidance = new Set<string>();

  if (lower.includes("github_token is required")) {
    guidance.add("Set GITHUB_TOKEN before running the review command.");
  }

  if (
    lower.includes("github api request failed (401") ||
    lower.includes("github api request failed (403")
  ) {
    guidance.add(
      "Check GITHUB_TOKEN permissions: repository contents read and pull requests read."
    );
  }

  if (
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("connect")
  ) {
    guidance.add(
      "Verify OpenCode connectivity (OPENCODE_HOSTNAME and OPENCODE_PORT)."
    );
  }

  if (
    lower.includes("opencode_api_key") ||
    lower.includes("api key") ||
    lower.includes("unauthorized")
  ) {
    guidance.add(
      "If you are not using a free model, set OPENCODE_API_KEY (repository secret in GitHub Actions, env var locally)."
    );
  }

  if (
    lower.includes("model") &&
    (lower.includes("not found") ||
      lower.includes("unsupported") ||
      lower.includes("unavailable"))
  ) {
    guidance.add(
      "Use OPENCODE_MODEL=opencode/minimax-m2.5-free, or provide OPENCODE_API_KEY for paid/private models."
    );
  }

  if (lower.includes("429") || lower.includes("rate limit")) {
    guidance.add(
      "You hit provider limits. Retry later or use a model/account with higher quota."
    );
  }

  return [...guidance];
};
