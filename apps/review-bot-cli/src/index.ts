import { CodeReviewWorkflow } from "@octavio/agent-code-review";
import type { ReviewFinding } from "@octavio/agent-code-review";
import type {
  ArtifactExecution,
  CliInput,
  ReviewConfig,
} from "@octavio/config";
import {
  loadReviewConfig,
  loadRuntimeEnv,
  resolvePathFromWorkspace,
  resolveWorkspaceDirectory,
} from "@octavio/config";
import { GitHubReviewClient } from "@octavio/github-review";
import { OpenCodeReportRunner } from "@octavio/opencode-runner";

const DEFAULT_INSTRUCTIONS_PATH = "prompts/code-review.md";
const REPORT_LOG_MAX_CHARS = 8000;

interface ResolvedInstructions {
  artifactExecution: ArtifactExecution;
  artifactSchema: {
    artifactDir: string;
    confidenceFile: string;
    maxAttempts: number;
    reviewFile: string;
    validatorCommand: string;
  };
  instructionsPath: string;
  policyFailOnRules?: string[];
  profileName?: string;
}

const DEFAULT_ARTIFACT_DIR = "artifacts";
const DEFAULT_REVIEW_FILE = "review.md";
const DEFAULT_CONFIDENCE_FILE = "confidence.json";
const DEFAULT_ARTIFACT_MAX_ATTEMPTS = 2;
const DEFAULT_ARTIFACT_EXECUTION: ArtifactExecution = "agent";

const parseArtifactExecution = (
  rawValue: string | undefined
): ArtifactExecution | undefined => {
  if (!rawValue) {
    return undefined;
  }

  return rawValue === "host" ? "host" : "agent";
};

const resolveArtifactSchema = (
  selectedProfile: ReviewConfig["profiles"][string] | undefined
): ResolvedInstructions["artifactSchema"] => {
  const artifactDir =
    selectedProfile?.artifactSchema?.artifactDir ?? DEFAULT_ARTIFACT_DIR;

  return {
    artifactDir,
    confidenceFile:
      selectedProfile?.artifactSchema?.confidenceFile ??
      DEFAULT_CONFIDENCE_FILE,
    maxAttempts:
      selectedProfile?.artifactSchema?.maxAttempts ??
      DEFAULT_ARTIFACT_MAX_ATTEMPTS,
    reviewFile:
      selectedProfile?.artifactSchema?.reviewFile ?? DEFAULT_REVIEW_FILE,
    validatorCommand:
      selectedProfile?.artifactSchema?.validatorCommand ??
      `bun run validate-artifacts --dir ${artifactDir}`,
  };
};

const parseArgs = (argv: string[]): CliInput => {
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];

    if (!key?.startsWith("--") || !value) {
      throw new Error(
        "Invalid arguments. Expected --owner --repo --pr [--instructions] [--instructions-profile] [--artifact-execution] [--workdir] [--report-output] [--findings-output] [--result-output] [--previous-findings]."
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
      "Missing required args. Example: --owner acme --repo web --pr 123 [--instructions prompts/code-review.md] [--instructions-profile balanced] [--artifact-execution agent]"
    );
  }

  return {
    artifactExecution: parseArtifactExecution(flags.get("artifact-execution")),
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
  const timestamp = new Date().toISOString().replaceAll(/[:.]/gu, "-");
  return `result-pr-${pullNumber}-${timestamp}.json`;
};

const truncateForLogs = (value: string): string =>
  value.length > REPORT_LOG_MAX_CHARS
    ? `${value.slice(0, REPORT_LOG_MAX_CHARS)}\n...truncated...`
    : value;

const computeFingerprint = (finding: {
  line: number;
  path: string;
  severity: string;
  title: string;
}): string =>
  [
    finding.path.trim().toLowerCase(),
    String(finding.line),
    finding.severity.trim().toLowerCase(),
    finding.title.trim().toLowerCase(),
  ].join("|");

const toReviewFinding = (value: unknown): ReviewFinding | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ReviewFinding>;
  if (
    typeof candidate.comment !== "string" ||
    typeof candidate.id !== "string" ||
    typeof candidate.line !== "number" ||
    !Number.isInteger(candidate.line) ||
    candidate.line <= 0 ||
    typeof candidate.path !== "string" ||
    typeof candidate.severity !== "string" ||
    typeof candidate.title !== "string"
  ) {
    return null;
  }

  return {
    comment: candidate.comment,
    fingerprint:
      candidate.fingerprint ??
      computeFingerprint({
        line: candidate.line,
        path: candidate.path,
        severity: candidate.severity,
        title: candidate.title,
      }),
    id: candidate.id,
    line: candidate.line,
    path: candidate.path,
    severity: candidate.severity,
    title: candidate.title,
  };
};

const extractFindingsFromConfidencePayload = (
  payload: unknown
): ReviewFinding[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const maybeFindings = (payload as { findings?: unknown }).findings;
  if (!Array.isArray(maybeFindings)) {
    return [];
  }

  return maybeFindings
    .map((item) => toReviewFinding(item))
    .filter((item) => item !== null);
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
  const confidenceFindings = extractFindingsFromConfidencePayload(parsed);
  if (confidenceFindings.length > 0) {
    return confidenceFindings;
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => toReviewFinding(item))
    .filter((item) => item !== null);
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

  process.stdout.write(
    `Running review for ${cliInput.owner}/${cliInput.repo}#${cliInput.pullNumber}...\n`
  );

  const result = await workflow.run({
    artifactExecution: resolvedInstructions.artifactExecution,
    artifactSchema: resolvedInstructions.artifactSchema,
    instructionsMarkdown,
    policyFailOnRules: resolvedInstructions.policyFailOnRules,
    previousFindings,
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

await Bun.sleep(0);
process.exit(process.exitCode ?? 0);
