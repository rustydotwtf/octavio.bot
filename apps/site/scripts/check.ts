type StepStatus = "pass" | "fail";

export interface CheckStep {
  command: string[];
  id: string;
  name: string;
}

export interface StepResult {
  durationMs: number;
  output: string;
  status: StepStatus;
  step: CheckStep;
}

interface TruncatedOutput {
  omittedLines: number;
  text: string;
}

interface StepCounts {
  failed: number;
  passed: number;
  status: StepStatus;
}

const LINT_CONFIG_ERROR =
  "No linter configuration found. Run `bun x ultracite init` once in this project.";
const NO_TESTS_MESSAGE = "No tests found; skipping test step.";
const MAX_OUTPUT_LINES = 120;
const LINT_TARGETS = [
  "README.md",
  "package.json",
  "tsconfig.json",
  ".oxlintrc.json",
  ".oxfmtrc.jsonc",
  "scripts",
  "src",
  "content",
  "assets",
  "styles",
  "site.jsonc",
];
const ROOT_TEST_FILE_PATTERNS = [
  "*.test.ts",
  "*.test.tsx",
  "*.test.js",
  "*.test.jsx",
  "*_test_*.ts",
  "*_test_*.tsx",
  "*_test_*.js",
  "*_test_*.jsx",
  "*.spec.ts",
  "*.spec.tsx",
  "*.spec.js",
  "*.spec.jsx",
  "*_spec_*.ts",
  "*_spec_*.tsx",
  "*_spec_*.js",
  "*_spec_*.jsx",
];
const NESTED_TEST_FILE_PATTERNS = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test.js",
  "**/*.test.jsx",
  "**/*_test_*.ts",
  "**/*_test_*.tsx",
  "**/*_test_*.js",
  "**/*_test_*.jsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.spec.js",
  "**/*.spec.jsx",
  "**/*_spec_*.ts",
  "**/*_spec_*.tsx",
  "**/*_spec_*.js",
  "**/*_spec_*.jsx",
];
const TEST_SOURCE_DIRS = ["content", "scripts", "src", "tests"];

const buildScopedTestFilePatterns = (): string[] => {
  const patterns = [...ROOT_TEST_FILE_PATTERNS];

  for (const dir of TEST_SOURCE_DIRS) {
    for (const nestedPattern of NESTED_TEST_FILE_PATTERNS) {
      patterns.push(`${dir}/${nestedPattern}`);
    }
  }

  return patterns;
};
const SCOPED_TEST_FILE_PATTERNS = buildScopedTestFilePatterns();

const steps: CheckStep[] = [
  {
    command: [process.execPath, "scripts/check-internal.ts"],
    id: "internal",
    name: "Internal",
  },
  {
    command: [process.execPath, "x", "ultracite", "check", ...LINT_TARGETS],
    id: "lint",
    name: "Lint",
  },
  {
    command: [process.execPath, "run", "typecheck"],
    id: "typecheck",
    name: "Typecheck",
  },
  {
    command: [process.execPath, "run", "test"],
    id: "tests",
    name: "Tests",
  },
];

const hasAnyLinterConfig = async (): Promise<boolean> => {
  const candidates = [
    ".oxlintrc.json",
    "eslint.config.js",
    "eslint.config.cjs",
    "eslint.config.mjs",
    "eslint.config.ts",
    "eslint.config.cts",
    "eslint.config.mts",
  ];

  for (const file of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await Bun.file(file).exists()) {
      return true;
    }
  }

  return false;
};

const hasAnyFilesMatching = async (pattern: string): Promise<boolean> => {
  const glob = new Bun.Glob(pattern);
  for await (const _path of glob.scan(".")) {
    return true;
  }
  return false;
};

const hasAnyTestFiles = async (): Promise<boolean> => {
  for (const pattern of SCOPED_TEST_FILE_PATTERNS) {
    // eslint-disable-next-line no-await-in-loop
    if (await hasAnyFilesMatching(pattern)) {
      return true;
    }
  }
  return false;
};

const isFailure = (result: StepResult): boolean => result.status === "fail";

const runCommandStep = async (step: CheckStep): Promise<StepResult> => {
  const startedAt = performance.now();
  const child = Bun.spawn(step.command, {
    cwd: process.cwd(),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return {
    durationMs: Math.round(performance.now() - startedAt),
    output: `${stdout}${stderr}`.trim(),
    status: exitCode === 0 ? "pass" : "fail",
    step,
  };
};

const lintConfigFailure = (step: CheckStep): StepResult => ({
  durationMs: 0,
  output: LINT_CONFIG_ERROR,
  status: "fail",
  step,
});

const skippedTestsResult = (step: CheckStep): StepResult => ({
  durationMs: 0,
  output: NO_TESTS_MESSAGE,
  status: "pass",
  step,
});

const runStep = async (step: CheckStep): Promise<StepResult> => {
  if (step.id === "lint" && !(await hasAnyLinterConfig())) {
    return lintConfigFailure(step);
  }
  if (step.id === "tests" && !(await hasAnyTestFiles())) {
    return skippedTestsResult(step);
  }

  return runCommandStep(step);
};

const runSteps = async (): Promise<StepResult[]> => {
  const results: StepResult[] = [];

  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runStep(step);
    results.push(result);

    if (isFailure(result)) {
      break;
    }
  }

  return results;
};

export const truncateOutput = (
  output: string,
  maxLines = MAX_OUTPUT_LINES
): TruncatedOutput => {
  const normalized = output.trim();
  if (normalized.length === 0) {
    return { omittedLines: 0, text: "" };
  }

  const lines = normalized.split("\n");
  if (lines.length <= maxLines) {
    return { omittedLines: 0, text: normalized };
  }

  return {
    omittedLines: lines.length - maxLines,
    text: lines.slice(0, maxLines).join("\n"),
  };
};

const getCounts = (results: StepResult[]): StepCounts => {
  const failed = results.filter(isFailure).length;
  const passed = results.length - failed;
  return {
    failed,
    passed,
    status: failed === 0 ? "pass" : "fail",
  };
};

const buildHeaderLines = (results: StepResult[]): string[] => {
  const counts = getCounts(results);
  return [
    "# Check Report",
    "",
    `- status: ${counts.status}`,
    `- steps_total: ${results.length}`,
    `- steps_passed: ${counts.passed}`,
    `- steps_failed: ${counts.failed}`,
    "",
  ];
};

const buildFailureOutputLines = (output: string): string[] => {
  if (output.length === 0) {
    return [];
  }

  const truncated = truncateOutput(output);
  const lines = ["", "### Output", "", "```text", truncated.text];

  if (truncated.omittedLines > 0) {
    lines.push(`[truncated: omitted ${truncated.omittedLines} lines]`);
  }

  lines.push("```");
  return lines;
};

const buildStepLines = (result: StepResult): string[] => {
  const lines = [
    `## ${result.step.name}`,
    "",
    `- status: ${result.status}`,
    `- duration_ms: ${result.durationMs}`,
  ];

  if (isFailure(result)) {
    lines.push(...buildFailureOutputLines(result.output));
  }

  lines.push("");
  return lines;
};

const buildSummaryRows = (results: StepResult[]): string[] =>
  results.map(
    (result) =>
      `| ${result.step.name} | ${result.status.toUpperCase()} | ${String(
        result.durationMs
      )} |`
  );

const buildSummaryLines = (results: StepResult[]): string[] => [
  "## Summary",
  "",
  "| Step | Status | Duration (ms) |",
  "| --- | --- | ---: |",
  ...buildSummaryRows(results),
];

export const renderReport = (results: StepResult[]): string => {
  const lines = [
    ...buildHeaderLines(results),
    ...results.flatMap(buildStepLines),
    ...buildSummaryLines(results),
  ];
  return `${lines.join("\n")}\n`;
};

const runCheck = async (): Promise<number> => {
  const results = await runSteps();
  process.stdout.write(renderReport(results));
  return results.some(isFailure) ? 1 : 0;
};

if (import.meta.main) {
  const code = await runCheck();
  process.exit(code);
}
