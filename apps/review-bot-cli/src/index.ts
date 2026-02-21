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
  resolvePromptPath,
} from "@octavio.bot/prompts";

const REPORT_LOG_MAX_CHARS = 8000;
const OPEN_CODE_INSTALL_COMMAND =
  "curl -fsSL https://opencode.ai/install | bash";
const OPEN_CODE_INSTALL_COMMAND_NO_PATH =
  "curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path";

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

interface OpenCodeInstallResult {
  path: string;
  version: string;
}

const DEFAULT_ARTIFACT_DIR = "artifacts";
const DEFAULT_REVIEW_FILE = "review.md";
const DEFAULT_CONFIDENCE_FILE = "confidence.json";
const DEFAULT_ARTIFACT_MAX_ATTEMPTS = 2;
const DEFAULT_ARTIFACT_EXECUTION: ArtifactExecution = "agent";

const usage = (): string =>
  [
    "Usage:",
    "  octavio-review review --owner <owner> --repo <repo> --pr <number> [options]",
    "  octavio-review doctor",
    "  octavio-review install-opencode",
    "",
    "Options for review:",
    "  --instructions <path>",
    "  --instructions-profile <balanced|styling|security>",
    "  --artifact-execution <agent|host>",
    "  --workdir <path>",
    "  --report-output <path>",
    "  --findings-output <path>",
    "  --result-output <path>",
    "  --install-opencode (force auto-install if missing)",
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
        `Unsupported instructionsPrompt '${profilePrompt}'. Supported values: balanced, styling, security.`
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

const knownOpenCodePaths = (): string[] => {
  const home = process.env.HOME;
  return [
    Bun.which("opencode") ?? "",
    home ? `${home}/.opencode/bin/opencode` : "",
    home ? `${home}/.local/bin/opencode` : "",
  ].filter(
    (value, index, values) =>
      value.length > 0 && values.indexOf(value) === index
  );
};

const readProcessOutput = async (
  stream: ReadableStream<Uint8Array> | null
): Promise<string> => (stream ? await new Response(stream).text() : "");

const getOpenCodeVersion = async (
  binaryPath: string
): Promise<string | null> => {
  const subprocess = Bun.spawn([binaryPath, "--version"], {
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    subprocess.exited,
    readProcessOutput(subprocess.stderr),
    readProcessOutput(subprocess.stdout),
  ]);
  if (exitCode !== 0) {
    const details = stderr.trim();
    return details.length > 0 ? details : null;
  }

  const version = stdout.trim();
  return version.length > 0 ? version : null;
};

const detectOpenCode = async (): Promise<OpenCodeInstallResult | null> => {
  for (const candidatePath of knownOpenCodePaths()) {
    const file = Bun.file(candidatePath);
    if (!(await file.exists())) {
      continue;
    }

    const version = await getOpenCodeVersion(candidatePath);
    return {
      path: candidatePath,
      version: version ?? "unknown",
    };
  }

  return null;
};

const runOpenCodeInstall = async (): Promise<void> => {
  process.stdout.write("OpenCode was not found. Installing now...\n");
  process.stdout.write(
    `Install command: ${OPEN_CODE_INSTALL_COMMAND_NO_PATH}\n`
  );

  const subprocess = Bun.spawn(
    ["bash", "-lc", OPEN_CODE_INSTALL_COMMAND_NO_PATH],
    {
      stderr: "inherit",
      stdout: "inherit",
    }
  );
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(
      [
        "Failed to auto-install OpenCode.",
        `Run this manually and retry: ${OPEN_CODE_INSTALL_COMMAND}`,
      ].join("\n")
    );
  }
};

const ensureOpenCodeInstalled = async (
  forceInstall: boolean
): Promise<OpenCodeInstallResult> => {
  const detectedBeforeInstall = await detectOpenCode();
  if (detectedBeforeInstall) {
    process.stdout.write(
      `OpenCode detected at ${detectedBeforeInstall.path} (${detectedBeforeInstall.version}).\n`
    );
    return detectedBeforeInstall;
  }

  const shouldAutoInstall =
    forceInstall || process.env.GITHUB_ACTIONS === "true";
  if (!shouldAutoInstall) {
    throw new Error(
      [
        "OpenCode CLI is required but was not found.",
        `Install it with: ${OPEN_CODE_INSTALL_COMMAND}`,
        "Then rerun this command, or pass --install-opencode to auto-install.",
      ].join("\n")
    );
  }

  await runOpenCodeInstall();
  const detectedAfterInstall = await detectOpenCode();
  if (!detectedAfterInstall) {
    throw new Error(
      [
        "OpenCode install completed but the binary was still not detected.",
        `Try opening a new shell or run manually: ${OPEN_CODE_INSTALL_COMMAND}`,
      ].join("\n")
    );
  }

  process.stdout.write(
    `OpenCode installed at ${detectedAfterInstall.path} (${detectedAfterInstall.version}).\n`
  );
  return detectedAfterInstall;
};

const runDoctor = async (): Promise<void> => {
  const detected = await detectOpenCode();
  process.stdout.write("Octavio doctor\n");
  process.stdout.write(`- bun: ${Bun.version}\n`);
  if (detected) {
    process.stdout.write(`- opencode: installed (${detected.version})\n`);
    process.stdout.write(`- opencode-path: ${detected.path}\n`);
  } else {
    process.stdout.write("- opencode: missing\n");
    process.stdout.write(`- install: ${OPEN_CODE_INSTALL_COMMAND}\n`);
  }
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
  process.exitCode = 1;
}

await Bun.sleep(0);
process.exit(process.exitCode ?? 0);
