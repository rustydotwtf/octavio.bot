import { z } from "zod";

const envSchema = z.object({
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  OPENCODE_HOSTNAME: z.string().default("127.0.0.1"),
  OPENCODE_MODEL: z.string().default("openai/gpt-5"),
  OPENCODE_PORT: z.coerce.number().int().positive().default(4096),
  REVIEW_MODEL: z.string().default("anthropic/claude-sonnet-4.5"),
  VERCEL_AI_GATEWAY_API_KEY: z
    .string()
    .min(1, "VERCEL_AI_GATEWAY_API_KEY is required"),
});

export type RuntimeEnv = z.infer<typeof envSchema>;

export interface RepoRef {
  owner: string;
  repo: string;
  pullNumber: number;
}

export interface CliInput extends RepoRef {
  instructionsPath: string;
  workspaceDirectory: string;
  reportOutputPath?: string;
}

export const loadRuntimeEnv = (): RuntimeEnv => envSchema.parse(process.env);

export const resolveWorkspaceDirectory = (directory: string): string =>
  directory.startsWith("/")
    ? directory
    : `${process.cwd().replace(/\/$/, "")}/${directory}`;
