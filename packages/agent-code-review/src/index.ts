import { createGatewayModel } from "@octavio/agent-runtime";
import type { RepoRef } from "@octavio/config";
import { GitHubReviewClient } from "@octavio/github-review";
import type {
  PullRequestFile,
  PullRequestReviewComment,
} from "@octavio/github-review";
import type { OpenCodeReportRunner } from "@octavio/opencode-runner";
import { stepCountIs, ToolLoopAgent, tool } from "ai";
import { z } from "zod";

export interface CodeReviewWorkflowConfig {
  githubClient: GitHubReviewClient;
  opencodeRunner: OpenCodeReportRunner;
  reviewModel: string;
  vercelGatewayApiKey: string;
}

export interface ReviewRunInput {
  instructionsMarkdown: string;
  repo: RepoRef;
}

export interface ReviewRunResult {
  appliedActions: string[];
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

const stripCodeFence = (jsonBlock: string): string =>
  jsonBlock
    .replace(/^```json\s*/u, "")
    .replace(/```$/u, "")
    .trim();

const parseFindingsFromReport = (reportMarkdown: string): ReportFinding[] => {
  const blockMatch = reportMarkdown.match(/```json[\s\S]*?```/u);
  if (!blockMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(stripCodeFence(blockMatch[0])) as {
      findings?: ReportFinding[];
    };

    return (
      parsed.findings?.filter(
        (finding) =>
          Boolean(finding.id) &&
          Boolean(finding.path) &&
          Number.isInteger(finding.line) &&
          finding.line > 0
      ) ?? []
    );
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

const formatComments = (comments: PullRequestReviewComment[]): string => {
  if (comments.length === 0) {
    return "No existing review comments.";
  }

  return comments
    .map(
      (comment) =>
        `- id=${comment.id} user=${comment.userLogin} path=${comment.path} line=${comment.line ?? "n/a"}\n${comment.body}`
    )
    .join("\n\n");
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
    const existingComments = await this.config.githubClient.listReviewComments(
      input.repo
    );

    const reportMarkdown = await this.config.opencodeRunner.generateReport({
      contextMarkdown: formatPullRequestContext(pullRequest, files),
      instructionsMarkdown: input.instructionsMarkdown,
    });

    const findings = parseFindingsFromReport(reportMarkdown);
    const appliedActions: string[] = [];
    const model = createGatewayModel({
      apiKey: this.config.vercelGatewayApiKey,
      model: this.config.reviewModel,
    });

    const agent = new ToolLoopAgent({
      instructions: `You are a pull request comment reconciliation agent.

Use the report and existing comments to decide whether to add or update comments.

Rules:
- Prefer updating existing bot comments over creating new duplicates.
- Only comment with concrete file path + line anchors.
- Keep each comment concise and actionable.
- Always include the finding fingerprint tag in each comment body.
- If no action is needed, explain why in your final text response.`,
      model,
      stopWhen: stepCountIs(12),
      tools: {
        createComment: tool({
          description: "Create a new GitHub PR review comment",
          execute: async ({ body, findingId, line, path }) => {
            const fingerprint =
              GitHubReviewClient.buildFingerprintTag(findingId);
            const formattedBody = `${body.trim()}\n\n${fingerprint}`;
            const created = await this.config.githubClient.createReviewComment(
              input.repo,
              {
                body: formattedBody,
                line,
                path,
              },
              pullRequest.headSha
            );
            appliedActions.push(`created:${created.id}`);
            return {
              commentId: created.id,
            };
          },
          inputSchema: z.object({
            body: z.string().min(1),
            findingId: z.string().min(1),
            line: z.number().int().positive(),
            path: z.string().min(1),
          }),
        }),
        updateComment: tool({
          description: "Update an existing GitHub PR review comment",
          execute: async ({ body, commentId, findingId }) => {
            const fingerprint =
              GitHubReviewClient.buildFingerprintTag(findingId);
            const formattedBody = `${body.trim()}\n\n${fingerprint}`;
            const updated = await this.config.githubClient.updateReviewComment(
              input.repo,
              commentId,
              formattedBody
            );
            appliedActions.push(`updated:${updated.id}`);
            return {
              commentId: updated.id,
            };
          },
          inputSchema: z.object({
            body: z.string().min(1),
            commentId: z.number().int().positive(),
            findingId: z.string().min(1),
          }),
        }),
      },
    });

    const prompt = [
      "Evaluate the report and existing comments, then call tools to apply updates.",
      "",
      "## Report",
      reportMarkdown,
      "",
      "## Parsed Findings",
      JSON.stringify({ findings }, null, 2),
      "",
      "## Existing Comments",
      formatComments(existingComments),
      "",
      "When deciding update targets, prefer comments with matching finding fingerprint tags.",
      "If none match, update only if the same file+line+issue is clearly equivalent; otherwise create.",
    ].join("\n");

    const result = await agent.generate({
      prompt,
    });

    return {
      appliedActions,
      reportMarkdown,
      summary: result.text,
    };
  }
}
