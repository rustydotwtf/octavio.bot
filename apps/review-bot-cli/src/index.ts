import { CodeReviewWorkflow } from "@octavio.bot/agent-code-review";
import type {
  ArtifactExecution,
  CliInput,
  ReviewConfig,
} from "@octavio.bot/config";
import {
  loadReviewConfig,
  loadRuntimeEnv,
  resolvePathFromWorkspace,
  resolveWorkspaceDirectory,
} from "@octavio.bot/config";
import { GitHubReviewClient } from "@octavio.bot/github-review";
import { OpenCodeReportRunner } from "@octavio.bot/opencode-runner";
import {
  DEFAULT_PROMPT_PROFILE,
  isPromptProfile,
  PROMPT_PROFILES,
  resolvePromptPath,
} from "@octavio.bot/prompts";

import { scaffoldReviewSetup } from "./init";
import { ensureOpenCodeInstalled, runDoctor } from "./opencode";
import { troubleshootingGuidance } from "./troubleshooting";

const REPORT_LOG_MAX_CHARS = 8000;

interface ResolvedInstructions {
  artifactExecution: ArtifactExecution;
  artifactSchema: {
    artifactDir: string;
    confidenceFile: string;
    maxAttempts: number;
    reviewFile: string;
  };
  instructionsPath: string;
  policyFailOnRules?: string[];
  profileName?: string;
}

interface ParsedArgs {
  flags: Map<string, string | true>;
  positional: string[];
}

interface InitInput {
  force: boolean;
  workspaceDirectory: string;
}

const DEFAULT_ARTIFACT_DIR = "artifacts";
const DEFAULT_REVIEW_FILE = "review.md";
const DEFAULT_CONFIDENCE_FILE = "confidence.json";
const DEFAULT_ARTIFACT_MAX_ATTEMPTS = 2;
const DEFAULT_ARTIFACT_EXECUTION: ArtifactExecution = "agent";
const INSTRUCTIONS_PROFILE_LIST = PROMPT_PROFILES.join("|");

const usage = (): string =>
  [
    "Usage:",
    "  octavio-review review --owner <owner> --repo <repo> --pr <number> [options]",
    "  octavio-review init [options]",
    "  octavio-review doctor",
    "  octavio-review install-opencode",
    "",
    "Options for review:",
    "  --instructions <path>",
    `  --instructions-profile <${INSTRUCTIONS_PROFILE_LIST}>`,
    "  --artifact-execution <agent|host>",
    "  --workdir <path>",
    "  --report-output <path>",
    "  --findings-output <path>",
    "  --result-output <path>",
    "  --install-opencode (force auto-install if missing)",
    "",
    "Options for init:",
    "  --workdir <path>",
    "  --force (overwrite existing files)",
  ].join("\n");

const parseArtifactExecution = (
  rawValue: string | undefined
): ArtifactExecution | undefined => {
  if (!rawValue) {
    return undefined;
  }

  if (rawValue === "host" || rawValue === "agent") {
    return rawValue;
  }

  throw new Error(
    `Invalid --artifact-execution value '${rawValue}'. Supported values: agent, host.`
  );
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const maybeValue = argv[index + 1];
    if (!maybeValue || maybeValue.startsWith("--")) {
      flags.set(key, true);
      continue;
    }

    flags.set(key, maybeValue);
    index += 1;
  }

  return { flags, positional };
};

const getStringFlag = (
  flags: Map<string, string | true>,
  name: string
): string | undefined => {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
};

const hasBooleanFlag = (
  flags: Map<string, string | true>,
  name: string
): boolean => flags.get(name) === true;

const resolveArtifactSchema = (
  selectedProfile: ReviewConfig["profiles"][string] | undefined
): ResolvedInstructions["artifactSchema"] => ({
  artifactDir:
    selectedProfile?.artifactSchema?.artifactDir ?? DEFAULT_ARTIFACT_DIR,
  confidenceFile:
    selectedProfile?.artifactSchema?.confidenceFile ?? DEFAULT_CONFIDENCE_FILE,
  maxAttempts:
    selectedProfile?.artifactSchema?.maxAttempts ??
    DEFAULT_ARTIFACT_MAX_ATTEMPTS,
  reviewFile:
    selectedProfile?.artifactSchema?.reviewFile ?? DEFAULT_REVIEW_FILE,
});

const parseReviewInput = (
  argv: string[]
): CliInput & { installOpenCode: boolean } => {
  const { flags, positional } = parseArgs(argv);
  if (positional.length > 0) {
    throw new Error(
      `Unexpected positional arguments: ${positional.join(", ")}\n\n${usage()}`
    );
  }

  const owner = getStringFlag(flags, "owner");
  const repo = getStringFlag(flags, "repo");
  const pullNumber = Number.parseInt(getStringFlag(flags, "pr") ?? "", 10);
  const workspaceDirectory = resolveWorkspaceDirectory(
    getStringFlag(flags, "workdir") ?? process.cwd()
  );

  if (!owner || !repo || Number.isNaN(pullNumber)) {
    throw new Error(`Missing required args for review.\n\n${usage()}`);
  }

  return {
    artifactExecution: parseArtifactExecution(
      getStringFlag(flags, "artifact-execution")
    ),
    findingsOutputPath: getStringFlag(flags, "findings-output"),
    installOpenCode: hasBooleanFlag(flags, "install-opencode"),
    instructionsPath: getStringFlag(flags, "instructions"),
    instructionsProfile: getStringFlag(flags, "instructions-profile"),
    owner,
    pullNumber,
    repo,
    reportOutputPath: getStringFlag(flags, "report-output"),
    resultOutputPath: getStringFlag(flags, "result-output"),
    workspaceDirectory,
  };
};

const parseInitInput = (argv: string[]): InitInput => {
  const { flags, positional } = parseArgs(argv);
  if (positional.length > 0) {
    throw new Error(
      `Unexpected positional arguments for init: ${positional.join(", ")}\n\n${usage()}`
    );
  }

  return {
    force: hasBooleanFlag(flags, "force"),
    workspaceDirectory: resolveWorkspaceDirectory(
      getStringFlag(flags, "workdir") ?? process.cwd()
    ),
  };
};

const resolveInstructions = (
  cliInput: CliInput,
  config: ReviewConfig | null
): ResolvedInstructions => {
  const selectedProfileName =
    cliInput.instructionsProfile ?? config?.defaultProfile;
  const selectedProfile = selectedProfileName
    ? config?.profiles[selectedProfileName]
    : undefined;

  if (selectedProfileName && !selectedProfile) {
    throw new Error(
      `Instructions profile '${selectedProfileName}' was not found in .octavio/review.config.json.`
    );
  }

  let resolvedPath = resolvePromptPath(DEFAULT_PROMPT_PROFILE);
  if (selectedProfile) {
    const profilePrompt = selectedProfile.instructionsPrompt;
    if (!isPromptProfile(profilePrompt)) {
      throw new Error(
        `Unsupported instructionsPrompt '${profilePrompt}'. Supported values: ${PROMPT_PROFILES.join(", ")}.`
      );
    }

    resolvedPath = resolvePromptPath(profilePrompt);
  }

  if (cliInput.instructionsPath) {
    resolvedPath = resolvePathFromWorkspace(
      cliInput.workspaceDirectory,
      cliInput.instructionsPath
    );
  }

  return {
    artifactExecution:
      cliInput.artifactExecution ??
      selectedProfile?.artifactExecution ??
      DEFAULT_ARTIFACT_EXECUTION,
    artifactSchema: resolveArtifactSchema(selectedProfile),
    instructionsPath: resolvedPath,
    policyFailOnRules: selectedProfile?.policy?.failOn,
    profileName: selectedProfileName,
  };
};

const defaultResultPath = (pullNumber: number): string => {
  const timestamp = new Date()
    .toISOString()
    .split(":")
    .join("-")
    .split(".")
    .join("-");
  return `result-pr-${pullNumber}-${timestamp}.json`;
};

const truncateForLogs = (value: string): string =>
  value.length > REPORT_LOG_MAX_CHARS
    ? `${value.slice(0, REPORT_LOG_MAX_CHARS)}\n...truncated...`
    : value;

const runInit = async (argv: string[]): Promise<void> => {
  const input = parseInitInput(argv);
  process.stdout.write(
    `Initializing Octavio review in ${input.workspaceDirectory}...\n`
  );

  const results = await scaffoldReviewSetup(
    input.workspaceDirectory,
    input.force
  );
  for (const result of results) {
    process.stdout.write(`- ${result.status}: ${result.relativePath}\n`);
  }

  const skippedCount = results.filter(
    (result) => result.status === "skipped"
  ).length;
  if (skippedCount > 0 && !input.force) {
    process.stdout.write(
      "Some files already existed and were skipped. Re-run with --force to overwrite.\n"
    );
  }

  process.stdout.write("Next steps:\n");
  process.stdout.write(
    "1. Commit .octavio/review.config.json and .github/workflows/review-check.yml.\n"
  );
  process.stdout.write(
    "2. Optional: set OPENCODE_API_KEY if you switch away from the default free model.\n"
  );
};

const runReview = async (argv: string[]): Promise<void> => {
  const cliInput = parseReviewInput(argv);
  await ensureOpenCodeInstalled(cliInput.installOpenCode);

  const env = loadRuntimeEnv();
  const reviewConfig = await loadReviewConfig(cliInput.workspaceDirectory);
  const resolvedInstructions = resolveInstructions(cliInput, reviewConfig);

  const instructionsMarkdown = await Bun.file(
    resolvedInstructions.instructionsPath
  ).text();

  const githubClient = new GitHubReviewClient({
    token: env.GITHUB_TOKEN,
  });

  const opencodeRunner = new OpenCodeReportRunner({
    hostname: env.OPENCODE_HOSTNAME,
    model: env.OPENCODE_MODEL,
    port: env.OPENCODE_PORT,
    workspaceDirectory: cliInput.workspaceDirectory,
  });

  const workflow = new CodeReviewWorkflow({
    githubClient,
    opencodeRunner,
  });

  process.stdout.write(
    `Running review for ${cliInput.owner}/${cliInput.repo}#${cliInput.pullNumber}...\n`
  );

  const result = await workflow.run({
    artifactExecution: resolvedInstructions.artifactExecution,
    artifactSchema: resolvedInstructions.artifactSchema,
    instructionsMarkdown,
    policyFailOnRules: resolvedInstructions.policyFailOnRules,
    repo: {
      owner: cliInput.owner,
      pullNumber: cliInput.pullNumber,
      repo: cliInput.repo,
    },
  });

  process.stdout.write("Review run completed. Writing artifacts...\n");
  process.stdout.write("Generated report markdown:\n");
  process.stdout.write("----- BEGIN REPORT -----\n");
  process.stdout.write(`${truncateForLogs(result.reportMarkdown)}\n`);
  process.stdout.write("----- END REPORT -----\n");

  const reportPath =
    cliInput.reportOutputPath ??
    `${resolvedInstructions.artifactSchema.artifactDir}/${resolvedInstructions.artifactSchema.reviewFile}`;
  await Bun.write(reportPath, result.reportMarkdown);

  const findingsPath =
    cliInput.findingsOutputPath ??
    `${resolvedInstructions.artifactSchema.artifactDir}/${resolvedInstructions.artifactSchema.confidenceFile}`;
  await Bun.write(findingsPath, `${result.confidenceJson.trim()}\n`);

  const resultPath =
    cliInput.resultOutputPath ?? defaultResultPath(cliInput.pullNumber);
  await Bun.write(
    resultPath,
    `${JSON.stringify(
      {
        hasBlockingFindings: result.hasBlockingFindings,
        policy: result.policy,
        summary: result.summary,
      },
      null,
      2
    )}\n`
  );

  process.stdout.write(`Report written: ${reportPath}\n`);
  process.stdout.write(`Findings written: ${findingsPath}\n`);
  process.stdout.write(`Result written: ${resultPath}\n`);
  process.stdout.write(
    `Instructions path: ${resolvedInstructions.instructionsPath}\n`
  );
  if (resolvedInstructions.profileName) {
    process.stdout.write(
      `Instructions profile: ${resolvedInstructions.profileName}\n`
    );
  }
  process.stdout.write("Review summary:\n");
  process.stdout.write(`${result.summary}\n`);
  process.stdout.write(
    `Policy source: ${result.policy.source}; rules=${result.policy.failOnRules.join(", ") || "none"}; matched=${result.policy.matchedRules.join(", ") || "none"}\n`
  );

  if (result.hasBlockingFindings) {
    process.stderr.write("Blocking findings detected.\n");
    process.exitCode = 1;
  }
};

const run = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const [firstArg] = args;

  if (!firstArg || firstArg === "--help" || firstArg === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (firstArg === "doctor") {
    await runDoctor();
    return;
  }

  if (firstArg === "init") {
    await runInit(args.slice(1));
    return;
  }

  if (firstArg === "install-opencode") {
    await ensureOpenCodeInstalled(true);
    return;
  }

  if (firstArg === "review") {
    await runReview(args.slice(1));
    return;
  }

  if (firstArg.startsWith("--")) {
    await runReview(args);
    return;
  }

  throw new Error(`Unknown command '${firstArg}'.\n\n${usage()}`);
};

try {
  await run();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`octavio-review failed: ${message}\n`);
  const guidance = troubleshootingGuidance(message);
  if (guidance.length > 0) {
    process.stderr.write("Troubleshooting:\n");
    for (const line of guidance) {
      process.stderr.write(`- ${line}\n`);
    }
  }
  process.exitCode = 1;
}

await Bun.sleep(0);
process.exit(process.exitCode ?? 0);
