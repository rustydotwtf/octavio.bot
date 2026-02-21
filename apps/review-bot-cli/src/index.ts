import { CodeReviewWorkflow } from "@octavio/agent-code-review";
import type { ReviewFinding } from "@octavio/agent-code-review";
import {
  loadReviewConfig,
  loadRuntimeEnv,
  resolvePathFromWorkspace,
  resolveWorkspaceDirectory,
} from "@octavio/config";
import type { CliInput, ReviewConfig } from "@octavio/config";
import { GitHubReviewClient } from "@octavio/github-review";
import { OpenCodeReportRunner } from "@octavio/opencode-runner";

const DEFAULT_INSTRUCTIONS_PATH = "prompts/code-review.md";

interface ResolvedInstructions {
  instructionsPath: string;
  policyFailOnRules?: string[];
  profileName?: string;
}

const parseArgs = (argv: string[]): CliInput => {
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Invalid arguments. Expected --owner --repo --pr [--instructions] [--instructions-profile] [--workdir] [--report-output] [--findings-output] [--result-output] [--previous-findings]."
      );
    }

    flags.set(key.slice(2), value);
  }

  const owner = flags.get("owner");
  const repo = flags.get("repo");
  const pullNumber = Number.parseInt(flags.get("pr") ?? "", 10);
  const instructionsPath = flags.get("instructions");
  const workspaceDirectory = resolveWorkspaceDirectory(
    flags.get("workdir") ?? process.cwd()
  );

  if (!owner || !repo || Number.isNaN(pullNumber)) {
    throw new Error(
      "Missing required args. Example: --owner acme --repo web --pr 123 [--instructions prompts/code-review.md] [--instructions-profile balanced]"
    );
  }

  return {
    findingsOutputPath: flags.get("findings-output"),
    instructionsPath,
    instructionsProfile: flags.get("instructions-profile"),
    owner,
    previousFindingsPath: flags.get("previous-findings"),
    pullNumber,
    repo,
    reportOutputPath: flags.get("report-output"),
    resultOutputPath: flags.get("result-output"),
    workspaceDirectory,
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

  let resolvedPath = resolvePathFromWorkspace(
    cliInput.workspaceDirectory,
    DEFAULT_INSTRUCTIONS_PATH
  );
  if (selectedProfile) {
    resolvedPath = resolvePathFromWorkspace(
      cliInput.workspaceDirectory,
      selectedProfile.instructionsPath
    );
  }
  if (cliInput.instructionsPath) {
    resolvedPath = resolvePathFromWorkspace(
      cliInput.workspaceDirectory,
      cliInput.instructionsPath
    );
  }

  return {
    instructionsPath: resolvedPath,
    policyFailOnRules: selectedProfile?.policy?.failOn,
    profileName: selectedProfileName,
  };
};

const defaultReportPath = (pullNumber: number): string => {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  return `report-pr-${pullNumber}-${timestamp}.md`;
};

const defaultFindingsPath = (pullNumber: number): string => {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  return `findings-pr-${pullNumber}-${timestamp}.json`;
};

const defaultResultPath = (pullNumber: number): string => {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  return `result-pr-${pullNumber}-${timestamp}.json`;
};

const isReviewFinding = (value: unknown): value is ReviewFinding => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ReviewFinding>;
  return (
    typeof candidate.comment === "string" &&
    typeof candidate.fingerprint === "string" &&
    typeof candidate.id === "string" &&
    typeof candidate.line === "number" &&
    Number.isInteger(candidate.line) &&
    candidate.line > 0 &&
    typeof candidate.path === "string" &&
    typeof candidate.severity === "string" &&
    typeof candidate.title === "string"
  );
};

const readPreviousFindings = async (
  previousFindingsPath: string | undefined
): Promise<ReviewFinding[]> => {
  if (!previousFindingsPath) {
    return [];
  }

  const file = Bun.file(previousFindingsPath);
  if (!(await file.exists())) {
    return [];
  }

  const parsed = (await file.json()) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item) => isReviewFinding(item));
};

const run = async (): Promise<void> => {
  const cliInput = parseArgs(process.argv.slice(2));
  const env = loadRuntimeEnv();
  const reviewConfig = await loadReviewConfig(cliInput.workspaceDirectory);
  const resolvedInstructions = resolveInstructions(cliInput, reviewConfig);

  const instructionsMarkdown = await Bun.file(
    resolvedInstructions.instructionsPath
  ).text();
  const previousFindings = await readPreviousFindings(
    cliInput.previousFindingsPath
  );

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

  const result = await workflow.run({
    instructionsMarkdown,
    policyFailOnRules: resolvedInstructions.policyFailOnRules,
    previousFindings,
    repo: {
      owner: cliInput.owner,
      pullNumber: cliInput.pullNumber,
      repo: cliInput.repo,
    },
  });

  const reportPath =
    cliInput.reportOutputPath ?? defaultReportPath(cliInput.pullNumber);
  await Bun.write(reportPath, result.reportMarkdown);

  const findingsPath =
    cliInput.findingsOutputPath ?? defaultFindingsPath(cliInput.pullNumber);
  await Bun.write(
    findingsPath,
    `${JSON.stringify(result.findings, null, 2)}\n`
  );

  const resultPath =
    cliInput.resultOutputPath ?? defaultResultPath(cliInput.pullNumber);
  await Bun.write(
    resultPath,
    `${JSON.stringify(
      {
        comparison: {
          new: result.comparison.newFindings.length,
          persisting: result.comparison.persistingFindings.length,
          resolved: result.comparison.resolvedFindings.length,
        },
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
  if (result.policy.warnings.length > 0) {
    process.stdout.write(
      `Policy warnings: ${result.policy.warnings.join(" | ")}\n`
    );
  }
  process.stdout.write(
    `Comparison: new=${result.comparison.newFindings.length} persisting=${result.comparison.persistingFindings.length} resolved=${result.comparison.resolvedFindings.length}\n`
  );

  if (result.hasBlockingFindings) {
    process.stderr.write("Blocking findings detected.\n");
    process.exitCode = 1;
  }
};

try {
  await run();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`review-bot failed: ${message}\n`);
  process.exitCode = 1;
}
