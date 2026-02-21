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
  findingsOutputPath?: string;
  instructionsPath: string;
  previousFindingsPath?: string;
  resultOutputPath?: string;
  workspaceDirectory: string;
  reportOutputPath?: string;
}

export const loadRuntimeEnv = (): RuntimeEnv => envSchema.parse(process.env);

export const resolveWorkspaceDirectory = (directory: string): string =>
  directory.startsWith("/")
    ? directory
    : `${process.cwd().replace(/\/$/, "")}/${directory}`;
