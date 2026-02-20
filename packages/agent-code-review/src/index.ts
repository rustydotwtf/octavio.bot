import type { RepoRef } from "@octavio/config";
import type {
  GitHubReviewClient,
  PullRequestFile,
} from "@octavio/github-review";
import type { OpenCodeReportRunner } from "@octavio/opencode-runner";

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
  instructionsMarkdown: string;
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
  source: "frontmatter" | "fallback";
  warnings: string[];
}

export interface ReviewRunResult {
  comparison: FindingsComparison;
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

const VALID_SEVERITIES = new Set<FindingSeverity>([
  "low",
  "medium",
  "high",
  "critical",
]);

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/u;

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

const parsePolicyRulesFromInstructions = (
  instructionsMarkdown: string
): {
  rules: PolicyRule[];
  source: "frontmatter" | "fallback";
  warnings: string[];
} => {
  const frontmatter = extractFrontmatter(instructionsMarkdown);
  if (!frontmatter) {
    return {
      rules: [],
      source: "fallback",
      warnings: [
        "No policy frontmatter was found in instructions; using fail-open fallback.",
      ],
    };
  }

  const failOnBlock = frontmatter.match(
    /^policy:\s*\n(?:[ \t].*\n)*?[ \t]+fail_on:\s*\n((?:[ \t]+-\s*.*\n?)*)/mu
  );

  if (!failOnBlock?.[1]) {
    return {
      rules: [],
      source: "fallback",
      warnings: [
        "Instructions frontmatter is present but policy.fail_on is missing; using fail-open fallback.",
      ],
    };
  }

  const warnings: string[] = [];
  const rules: PolicyRule[] = [];
  const matches = failOnBlock[1].matchAll(/-\s*["']?([a-z]+:[a-z]+)["']?/gu);

  for (const match of matches) {
    const rawRule = match[1]?.trim().toLowerCase();
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
      warnings.push(
        `Ignoring unsupported policy rule '${rawRule}'. Supported format: <any|new|persisting|resolved>:<low|medium|high|critical>.`
      );
      continue;
    }

    const parsedScope = scope as PolicyScope;
    const parsedSeverity = severity as FindingSeverity;

    rules.push({
      raw: rawRule,
      scope: parsedScope,
      severity: parsedSeverity,
    });
  }

  if (rules.length === 0) {
    warnings.push(
      "No valid policy rules were found in policy.fail_on; using fail-open fallback."
    );
    return {
      rules: [],
      source: "fallback",
      warnings,
    };
  }

  return {
    rules,
    source: "frontmatter",
    warnings,
  };
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
  source: "frontmatter" | "fallback",
  warnings: string[],
  findings: ReviewFinding[],
  comparison: FindingsComparison
): PolicyEvaluation => {
  if (rules.length === 0) {
    return {
      failOnRules: [],
      matchedRules: [],
      shouldFail: false,
      source,
      warnings,
    };
  }

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
    warnings,
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
    pullRequest.body ?? "",
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
    const pullRequest = await this.config.githubClient.getPullRequest(
      input.repo
    );
    const files = await this.config.githubClient.listPullRequestFiles(
      input.repo
    );

    const reportMarkdown = await this.config.opencodeRunner.generateReport({
      contextMarkdown: formatPullRequestContext(pullRequest, files),
      instructionsMarkdown: input.instructionsMarkdown,
    });

    const findings = parseFindingsFromReport(reportMarkdown);
    const comparison = compareFindings(findings, input.previousFindings ?? []);
    const parsedPolicy = parsePolicyRulesFromInstructions(
      input.instructionsMarkdown
    );
    const policy = evaluatePolicy(
      parsedPolicy.rules,
      parsedPolicy.source,
      parsedPolicy.warnings,
      findings,
      comparison
    );

    return {
      comparison,
      findings,
      hasBlockingFindings: policy.shouldFail,
      policy,
      reportMarkdown,
      summary: policy.shouldFail
        ? `Policy matched fail rules: ${policy.matchedRules.join(", ")}.`
        : "Policy did not match any fail rules.",
    };
  }
}
