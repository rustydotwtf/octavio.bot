import { PROMPT_PROFILES } from "@octavio.bot/prompts";
import { z } from "zod";

const envSchema = z.object({
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  OPENCODE_HOSTNAME: z.string().default("127.0.0.1"),
  OPENCODE_MODEL: z.string().optional(),
  OPENCODE_PORT: z.coerce.number().int().positive().default(4096),
});

export type RuntimeEnv = z.infer<typeof envSchema>;

export interface RepoRef {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface CliInput extends RepoRef {
  artifactExecution?: ArtifactExecution;
  findingsOutputPath?: string;
  instructionsPath?: string;
  instructionsProfile?: string;
  resultOutputPath?: string;
  workspaceDirectory: string;
  reportOutputPath?: string;
}

const POLICY_RULE_REGEX = /^(any|new):(low|medium|high|critical)$/u;

const artifactExecutionSchema = z.enum(["host", "agent"]);
const instructionsPromptSchema = z.enum(PROMPT_PROFILES);

export type ArtifactExecution = z.infer<typeof artifactExecutionSchema>;

const artifactSchemaConfigSchema = z
  .object({
    artifactDir: z.string().min(1).optional(),
    confidenceFile: z.string().min(1).optional(),
    maxAttempts: z.coerce.number().int().min(1).max(6).optional(),
    reviewFile: z.string().min(1).optional(),
  })
  .optional();

const reviewProfileSchema = z.object({
  artifactExecution: artifactExecutionSchema.optional(),
  artifactSchema: artifactSchemaConfigSchema,
  instructionsPrompt: instructionsPromptSchema,
  policy: z
    .object({
      failOn: z
        .array(z.string().regex(POLICY_RULE_REGEX, "Invalid policy rule"))
        .optional(),
    })
    .optional(),
});

const reviewConfigSchema = z.object({
  defaultProfile: z.string().min(1).optional(),
  profiles: z.record(z.string(), reviewProfileSchema).default({}),
});

export type ReviewConfig = z.infer<typeof reviewConfigSchema>;
export type ReviewProfile = z.infer<typeof reviewProfileSchema>;

export const loadRuntimeEnv = (): RuntimeEnv => envSchema.parse(process.env);

export const resolveWorkspaceDirectory = (directory: string): string =>
  directory.startsWith("/")
    ? directory
    : `${process.cwd().replace(/\/$/, "")}/${directory}`;

export const resolvePathFromWorkspace = (
  workspaceDirectory: string,
  filePath: string
): string =>
  filePath.startsWith("/")
    ? filePath
    : `${workspaceDirectory.replace(/\/$/, "")}/${filePath}`;

export const loadReviewConfig = async (
  workspaceDirectory: string
): Promise<ReviewConfig | null> => {
  const configPath = resolvePathFromWorkspace(
    workspaceDirectory,
    ".octavio/review.config.json"
  );
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    return null;
  }

  const parsed = (await file.json()) as unknown;
  const result = reviewConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid review config at ${configPath}: ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}`
    );
  }

  return result.data;
};
