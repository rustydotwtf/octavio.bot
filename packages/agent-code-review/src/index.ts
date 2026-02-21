import type { RepoRef } from "@octavio.bot/config";
import type {
  GitHubReviewClient,
  PullRequestFile,
} from "@octavio.bot/github-review";
import type {
  ArtifactExecution,
  ArtifactSchemaConfig,
  GenerateReportResult,
  OpenCodeReportRunner,
} from "@octavio.bot/opencode-runner";

type FindingSeverity = "low" | "medium" | "high" | "critical";
type PolicyScope = "any" | "new" | "persisting" | "resolved";

export interface ReviewFinding {
  fingerprint: string;
  comment: string;
  id: string;
  line: number;
  path: string;
  severity: FindingSeverity;
  title: string;
}

export interface CodeReviewWorkflowConfig {
  githubClient: GitHubReviewClient;
  opencodeRunner: OpenCodeReportRunner;
}

export interface ReviewRunInput {
  artifactExecution: ArtifactExecution;
  artifactSchema: ArtifactSchemaConfig;
  instructionsMarkdown: string;
  policyFailOnRules?: string[];
  previousFindings?: ReviewFinding[];
  repo: RepoRef;
}

export interface FindingsComparison {
  newFindings: ReviewFinding[];
  persistingFindings: ReviewFinding[];
  resolvedFindings: ReviewFinding[];
}

export interface PolicyEvaluation {
  failOnRules: string[];
  matchedRules: string[];
  shouldFail: boolean;
  source: "config" | "frontmatter";
}

export interface ReviewRunResult {
  comparison: FindingsComparison;
  confidenceJson: string;
  hasBlockingFindings: boolean;
  findings: ReviewFinding[];
  policy: PolicyEvaluation;
  reportMarkdown: string;
  summary: string;
}

interface ReportFinding {
  comment: string;
  id: string;
  line: number;
  path: string;
  severity: string;
  title: string;
}

interface PolicyRule {
  raw: string;
  scope: PolicyScope;
  severity: FindingSeverity;
}

interface PolicyParseResult {
  rules: PolicyRule[];
  source: "config" | "frontmatter";
}

const VALID_SEVERITIES = new Set<FindingSeverity>([
  "low",
  "medium",
  "high",
  "critical",
]);

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/u;

const writeWorkflowLog = (message: string): void => {
  process.stdout.write(`[review-workflow] ${message}\n`);
};

const stripCodeFence = (jsonBlock: string): string =>
  jsonBlock
    .replace(/^```json\s*/u, "")
    .replace(/```$/u, "")
    .trim();

const normalizeSeverity = (severity: string): FindingSeverity | null => {
  const normalized = severity.trim().toLowerCase();
  if (VALID_SEVERITIES.has(normalized as FindingSeverity)) {
    return normalized as FindingSeverity;
  }

  return null;
};

const computeFingerprint = (finding: {
  path: string;
  line: number;
  severity: string;
  title: string;
}): string =>
  [
    finding.path.trim().toLowerCase(),
    String(finding.line),
    finding.severity.trim().toLowerCase(),
    finding.title.trim().toLowerCase(),
  ].join("|");

const parseFindingsFromReport = (reportMarkdown: string): ReviewFinding[] => {
  const blockMatch = reportMarkdown.match(/```json[\s\S]*?```/u);
  if (!blockMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(stripCodeFence(blockMatch[0])) as {
      findings?: ReportFinding[];
    };

    const rawFindings = parsed.findings ?? [];
    const findings: ReviewFinding[] = [];

    for (const finding of rawFindings) {
      const severity = normalizeSeverity(finding.severity);
      if (
        !severity ||
        !finding.id ||
        !finding.path ||
        !Number.isInteger(finding.line) ||
        finding.line <= 0
      ) {
        continue;
      }

      findings.push({
        comment: finding.comment,
        fingerprint: computeFingerprint({
          line: finding.line,
          path: finding.path,
          severity,
          title: finding.title,
        }),
        id: finding.id,
        line: finding.line,
        path: finding.path,
        severity,
        title: finding.title,
      });
    }

    return findings;
  } catch {
    return [];
  }
};

const parseFindingsFromRunner = (
  report: GenerateReportResult
): ReviewFinding[] => {
  if (report.usedStructuredOutput) {
    const findings: ReviewFinding[] = [];

    for (const finding of report.structuredFindings) {
      const severity = normalizeSeverity(finding.severity);
      if (
        !severity ||
        !finding.id ||
        !finding.path ||
        !Number.isInteger(finding.line) ||
        finding.line <= 0
      ) {
        continue;
      }

      findings.push({
        comment: finding.comment,
        fingerprint: computeFingerprint({
          line: finding.line,
          path: finding.path,
          severity,
          title: finding.title,
        }),
        id: finding.id,
        line: finding.line,
        path: finding.path,
        severity,
        title: finding.title,
      });
    }

    return findings;
  }

  return parseFindingsFromReport(report.reportMarkdown);
};

const compareFindings = (
  currentFindings: ReviewFinding[],
  previousFindings: ReviewFinding[]
): FindingsComparison => {
  const previousByFingerprint = new Map(
    previousFindings.map((finding) => [finding.fingerprint, finding])
  );
  const currentByFingerprint = new Map(
    currentFindings.map((finding) => [finding.fingerprint, finding])
  );

  const newFindings = currentFindings.filter(
    (finding) => !previousByFingerprint.has(finding.fingerprint)
  );
  const persistingFindings = currentFindings.filter((finding) =>
    previousByFingerprint.has(finding.fingerprint)
  );
  const resolvedFindings = previousFindings.filter(
    (finding) => !currentByFingerprint.has(finding.fingerprint)
  );

  return {
    newFindings,
    persistingFindings,
    resolvedFindings,
  };
};

const extractFrontmatter = (instructionsMarkdown: string): string | null => {
  const match = instructionsMarkdown.match(FRONTMATTER_REGEX);
  if (!match) {
    return null;
  }

  return match[1]?.trim() ?? null;
};

const parseRawPolicyRules = (
  rawRules: string[],
  source: "config" | "frontmatter"
): PolicyParseResult => {
  const rules: PolicyRule[] = [];
  const invalidRules: string[] = [];

  for (const rawRuleCandidate of rawRules) {
    const rawRule = rawRuleCandidate.trim().toLowerCase();
    if (!rawRule) {
      continue;
    }

    const [scope, severity] = rawRule.split(":");
    const isValidScope =
      scope === "any" ||
      scope === "new" ||
      scope === "persisting" ||
      scope === "resolved";
    const isValidSeverity = VALID_SEVERITIES.has(
      (severity ?? "") as FindingSeverity
    );

    if (!isValidScope || !isValidSeverity) {
      invalidRules.push(rawRule);
      continue;
    }

    rules.push({
      raw: rawRule,
      scope: scope as PolicyScope,
      severity: severity as FindingSeverity,
    });
  }

  if (invalidRules.length > 0) {
    throw new Error(
      `Invalid ${source === "config" ? "config policy.failOn" : "instructions policy.fail_on"} rules: ${invalidRules.join(", ")}. Supported format: <any|new|persisting|resolved>:<low|medium|high|critical>.`
    );
  }

  if (rules.length === 0) {
    throw new Error(
      `${source === "config" ? "Config policy.failOn" : "Instructions policy.fail_on"} must include at least one valid rule.`
    );
  }

  return {
    rules,
    source,
  };
};

const parsePolicyRulesFromInstructions = (
  instructionsMarkdown: string,
  configFailOnRules: string[] | undefined
): PolicyParseResult => {
  if (configFailOnRules !== undefined) {
    return parseRawPolicyRules(configFailOnRules, "config");
  }

  const frontmatter = extractFrontmatter(instructionsMarkdown);
  if (!frontmatter) {
    throw new Error(
      "Instructions must include frontmatter policy.fail_on when config policy.failOn is not set."
    );
  }

  const failOnBlock = frontmatter.match(
    /^policy:\s*\n(?:[ \t].*\n)*?[ \t]+fail_on:\s*\n((?:[ \t]+-\s*.*\n?)*)/mu
  );

  if (!failOnBlock?.[1]) {
    throw new Error(
      "Instructions frontmatter must include policy.fail_on when config policy.failOn is not set."
    );
  }

  const extractedRules = [
    ...failOnBlock[1].matchAll(/-\s*["']?([a-z]+:[a-z]+)["']?/gu),
  ]
    .map((match) => match[1])
    .filter(Boolean) as string[];

  return parseRawPolicyRules(extractedRules, "frontmatter");
};

const findingsForScope = (
  comparison: FindingsComparison,
  findings: ReviewFinding[],
  scope: PolicyScope
): ReviewFinding[] => {
  if (scope === "new") {
    return comparison.newFindings;
  }

  if (scope === "persisting") {
    return comparison.persistingFindings;
  }

  if (scope === "resolved") {
    return comparison.resolvedFindings;
  }

  return findings;
};

const evaluatePolicy = (
  rules: PolicyRule[],
  source: "config" | "frontmatter",
  findings: ReviewFinding[],
  comparison: FindingsComparison
): PolicyEvaluation => {
  const matchedRules: string[] = [];
  for (const rule of rules) {
    const scopedFindings = findingsForScope(comparison, findings, rule.scope);
    const hasMatch = scopedFindings.some(
      (finding) => finding.severity === rule.severity
    );
    if (hasMatch) {
      matchedRules.push(rule.raw);
    }
  }

  return {
    failOnRules: rules.map((rule) => rule.raw),
    matchedRules,
    shouldFail: matchedRules.length > 0,
    source,
  };
};

const truncatePatch = (patch: string | null): string => {
  if (!patch) {
    return "";
  }

  const MAX_PATCH_CHARS = 2500;
  return patch.length > MAX_PATCH_CHARS
    ? `${patch.slice(0, MAX_PATCH_CHARS)}\n...truncated...`
    : patch;
};

const formatPullRequestContext = (
  pullRequest: { title: string; body: string | null; number: number },
  files: PullRequestFile[]
): string => {
  const descriptionText = pullRequest.body?.trim() ?? "";
  const description =
    descriptionText.length > 0
      ? descriptionText
      : "(No PR description provided)";

  const fileList = files
    .map(
      (file) =>
        `### ${file.filename} (${file.status})\n\n\
${truncatePatch(file.patch)}`
    )
    .join("\n\n");

  return [
    `PR #${pullRequest.number}: ${pullRequest.title}`,
    "",
    description,
    "",
    "## Changed Files",
    fileList,
  ].join("\n");
};

export class CodeReviewWorkflow {
  private readonly config: CodeReviewWorkflowConfig;

  public constructor(config: CodeReviewWorkflowConfig) {
    this.config = config;
  }

  public async run(input: ReviewRunInput): Promise<ReviewRunResult> {
    writeWorkflowLog(
      `loading PR metadata for ${input.repo.owner}/${input.repo.repo}#${input.repo.pullNumber}`
    );
    const pullRequest = await this.config.githubClient.getPullRequest(
      input.repo
    );
    writeWorkflowLog(`loaded PR title: ${pullRequest.title}`);

    writeWorkflowLog("loading changed files");
    const files = await this.config.githubClient.listPullRequestFiles(
      input.repo
    );
    writeWorkflowLog(`loaded ${files.length} changed files`);

    writeWorkflowLog("sending PR context to OpenCode");
    const report = await this.config.opencodeRunner.generateReport({
      artifactExecution: input.artifactExecution,
      artifactSchema: input.artifactSchema,
      contextMarkdown: formatPullRequestContext(pullRequest, files),
      instructionsMarkdown: input.instructionsMarkdown,
    });
    writeWorkflowLog(
      `received report markdown (${report.reportMarkdown.length} chars)`
    );

    const findings = parseFindingsFromRunner(report);
    writeWorkflowLog(`parsed ${findings.length} findings`);
    const comparison = compareFindings(findings, input.previousFindings ?? []);
    const parsedPolicy = parsePolicyRulesFromInstructions(
      input.instructionsMarkdown,
      input.policyFailOnRules
    );
    const policy = evaluatePolicy(
      parsedPolicy.rules,
      parsedPolicy.source,
      findings,
      comparison
    );

    return {
      comparison,
      confidenceJson: report.confidenceJson,
      findings,
      hasBlockingFindings: policy.shouldFail,
      policy,
      reportMarkdown: report.reportMarkdown,
      summary: policy.shouldFail
        ? `Policy matched fail rules: ${policy.matchedRules.join(", ")}.`
        : "Policy did not match any fail rules.",
    };
  }
}
