export const PROMPT_PROFILES = ["balanced", "styling", "security"] as const;

export type PromptProfile = (typeof PROMPT_PROFILES)[number];

export const PROMPT_PATHS: Record<PromptProfile, string> = {
  balanced: "../prompts/code-review.md",
  security: "../prompts/security-review.md",
  styling: "../prompts/styling-review.md",
};

export const DEFAULT_PROMPT_PROFILE: PromptProfile = "balanced";

export const isPromptProfile = (value: string): value is PromptProfile =>
  PROMPT_PROFILES.some((profile) => profile === value);

export const resolvePromptPath = (profile: PromptProfile): string =>
  Bun.fileURLToPath(new URL(PROMPT_PATHS[profile], import.meta.url));

export const readPrompt = async (profile: PromptProfile): Promise<string> =>
  await Bun.file(resolvePromptPath(profile)).text();
