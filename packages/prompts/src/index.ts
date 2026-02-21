export const PROMPT_PATHS = {
  balanced: "../prompts/code-review.md",
  security: "../prompts/security-review.md",
  styling: "../prompts/styling-review.md",
} as const;

export type PromptProfile = keyof typeof PROMPT_PATHS;

export const DEFAULT_PROMPT_PROFILE: PromptProfile = "balanced";

export const isPromptProfile = (value: string): value is PromptProfile =>
  Object.hasOwn(PROMPT_PATHS, value);

export const resolvePromptPath = (profile: PromptProfile): string =>
  Bun.fileURLToPath(new URL(PROMPT_PATHS[profile], import.meta.url));

export const readPrompt = async (profile: PromptProfile): Promise<string> =>
  await Bun.file(resolvePromptPath(profile)).text();
