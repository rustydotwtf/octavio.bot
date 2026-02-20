import type { RepoRef } from "@octavio/config";
import type {
  GitHubReviewClient,
  PullRequestFile,
} from "@octavio/github-review";
import type { OpenCodeReportRunner } from "@octavio/opencode-runner";

export interface CodeReviewWorkflowConfig {
  githubClient: GitHubReviewClient;
  opencodeRunner: OpenCodeReportRunner;
}

export interface ReviewRunInput {
  instructionsMarkdown: string;
  repo: RepoRef;
}

export interface ReviewRunResult {
  hasBlockingFindings: boolean;
  findings: ReviewFinding[];
  reportMarkdown: string;
  summary: string;
}

export interface ReviewFinding {
  fingerprint: string;
  comment: string;
  id: string;
  line: number;
  path: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
}

interface ReportFinding {
  comment: string;
  id: string;
  line: number;
  path: string;
  severity: string;
  title: string;
}

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);

const stripCodeFence = (jsonBlock: string): string =>
  jsonBlock
    .replace(/^```json\s*/u, "")
    .replace(/```$/u, "")
    .trim();

const normalizeSeverity = (
  severity: string
): "low" | "medium" | "high" | "critical" | null => {
  const normalized = severity.trim().toLowerCase();
  if (
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "critical"
  ) {
    return normalized;
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
    const blockingFindings = findings.filter((finding) =>
      BLOCKING_SEVERITIES.has(finding.severity)
    );

    return {
      findings,
      hasBlockingFindings: blockingFindings.length > 0,
      reportMarkdown,
      summary:
        blockingFindings.length > 0
          ? `Found ${blockingFindings.length} blocking findings (${blockingFindings.map((finding) => finding.severity).join(", ")}).`
          : "No blocking findings were detected.",
    };
  }
}
