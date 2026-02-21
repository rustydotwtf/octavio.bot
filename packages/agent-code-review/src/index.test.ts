import { describe, expect, it } from "bun:test";

import type { GitHubReviewClient } from "@octavio.bot/github-review";
import type {
  GenerateReportInput,
  OpenCodeReportRunner,
  ReportFinding,
} from "@octavio.bot/opencode-runner";

import { CodeReviewWorkflow } from "./index";

interface CreateWorkflowOptions {
  findings?: ReportFinding[];
  onGenerateReport?: (input: GenerateReportInput) => void;
  pullRequestBody?: string | null;
  pullRequestTitle?: string;
}

const createWorkflow = (
  severity: "low" | "medium" | "high" | "critical",
  options: CreateWorkflowOptions = {}
) =>
  new CodeReviewWorkflow({
    githubClient: {
      getPullRequest: async () => {
        await Bun.sleep(0);
        return {
          baseSha: "base",
          body: options.pullRequestBody ?? null,
          headSha: "head",
          number: 1,
          title: options.pullRequestTitle ?? "Test PR",
        };
      },
      listPullRequestFiles: async () => {
        await Bun.sleep(0);
        return [];
      },
    } as unknown as GitHubReviewClient,
    opencodeRunner: {
      generateReport: async (input: GenerateReportInput) => {
        await Bun.sleep(0);
        options.onGenerateReport?.(input);

        const findings = options.findings ?? [
          {
            comment: "Example",
            id: "F-1",
            line: 11,
            path: "src/file.ts",
            severity,
            title: "Example finding",
          },
        ];

        return {
          confidenceJson: "{}",
          reportMarkdown: "# Review",
          structuredFindings: findings,
          usedStructuredOutput: true,
        };
      },
    } as unknown as OpenCodeReportRunner,
  });

describe("policy parsing precedence", () => {
  it("fails when config failOn is empty", async () => {
    const workflow = createWorkflow("critical");

    await expect(
      workflow.run({
        artifactExecution: "agent",
        artifactSchema: {
          artifactDir: "artifacts",
          confidenceFile: "confidence.json",
          maxAttempts: 1,
          reviewFile: "review.md",
          validatorCommand: "bun run validate-artifacts --dir artifacts",
        },
        instructionsMarkdown: `---\npolicy:\n  fail_on:\n    - "any:critical"\n---\n`,
        policyFailOnRules: [],
        previousFindings: [],
        repo: {
          owner: "acme",
          pullNumber: 1,
          repo: "web",
        },
      })
    ).rejects.toThrow(
      "Config policy.failOn must include at least one valid rule."
    );
  });

  it("fails when no config policy is set and frontmatter is missing", async () => {
    const workflow = createWorkflow("critical");

    await expect(
      workflow.run({
        artifactExecution: "agent",
        artifactSchema: {
          artifactDir: "artifacts",
          confidenceFile: "confidence.json",
          maxAttempts: 1,
          reviewFile: "review.md",
          validatorCommand: "bun run validate-artifacts --dir artifacts",
        },
        instructionsMarkdown: "# No policy",
        previousFindings: [],
        repo: {
          owner: "acme",
          pullNumber: 1,
          repo: "web",
        },
      })
    ).rejects.toThrow(
      "Instructions must include frontmatter policy.fail_on when config policy.failOn is not set."
    );
  });

  it("uses frontmatter when config failOn is undefined", async () => {
    const workflow = createWorkflow("critical");

    const result = await workflow.run({
      artifactExecution: "agent",
      artifactSchema: {
        artifactDir: "artifacts",
        confidenceFile: "confidence.json",
        maxAttempts: 1,
        reviewFile: "review.md",
        validatorCommand: "bun run validate-artifacts --dir artifacts",
      },
      instructionsMarkdown: `---\npolicy:\n  fail_on:\n    - "any:critical"\n---\n`,
      previousFindings: [],
      repo: {
        owner: "acme",
        pullNumber: 1,
        repo: "web",
      },
    });

    expect(result.policy.source).toBe("frontmatter");
    expect(result.policy.shouldFail).toBeTrue();
    expect(result.policy.matchedRules).toEqual(["any:critical"]);
  });

  it("passes PR title and body into the OpenCode context", async () => {
    let capturedContext = "";
    const workflow = createWorkflow("low", {
      onGenerateReport: (input) => {
        capturedContext = input.contextMarkdown;
      },
      pullRequestBody: "Implements explicit retry behavior.",
      pullRequestTitle: "Clarify retry behavior",
    });

    await workflow.run({
      artifactExecution: "agent",
      artifactSchema: {
        artifactDir: "artifacts",
        confidenceFile: "confidence.json",
        maxAttempts: 1,
        reviewFile: "review.md",
        validatorCommand: "bun run validate-artifacts --dir artifacts",
      },
      instructionsMarkdown:
        '---\npolicy:\n  fail_on:\n    - "any:critical"\n---\n# Test',
      previousFindings: [],
      repo: {
        owner: "acme",
        pullNumber: 1,
        repo: "web",
      },
    });

    expect(capturedContext).toContain("PR #1: Clarify retry behavior");
    expect(capturedContext).toContain("Implements explicit retry behavior.");
  });

  it("keeps PR metadata findings when path and line are valid", async () => {
    const workflow = createWorkflow("low", {
      findings: [
        {
          comment: "Title is too vague for changed behavior.",
          id: "PR-TITLE-1",
          line: 1,
          path: "PR_TITLE",
          severity: "medium",
          title: "Title does not describe behavior change",
        },
      ],
    });

    const result = await workflow.run({
      artifactExecution: "agent",
      artifactSchema: {
        artifactDir: "artifacts",
        confidenceFile: "confidence.json",
        maxAttempts: 1,
        reviewFile: "review.md",
        validatorCommand: "bun run validate-artifacts --dir artifacts",
      },
      instructionsMarkdown:
        '---\npolicy:\n  fail_on:\n    - "any:critical"\n---\n# Test',
      previousFindings: [],
      repo: {
        owner: "acme",
        pullNumber: 1,
        repo: "web",
      },
    });

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.path).toBe("PR_TITLE");
    expect(result.findings[0]?.line).toBe(1);
  });

  it("uses explicit placeholder when PR description is missing", async () => {
    let capturedContext = "";
    const workflow = createWorkflow("low", {
      onGenerateReport: (input) => {
        capturedContext = input.contextMarkdown;
      },
      pullRequestBody: null,
      pullRequestTitle: "Test title",
    });

    await workflow.run({
      artifactExecution: "agent",
      artifactSchema: {
        artifactDir: "artifacts",
        confidenceFile: "confidence.json",
        maxAttempts: 1,
        reviewFile: "review.md",
        validatorCommand: "bun run validate-artifacts --dir artifacts",
      },
      instructionsMarkdown:
        '---\npolicy:\n  fail_on:\n    - "any:critical"\n---\n# Test',
      previousFindings: [],
      repo: {
        owner: "acme",
        pullNumber: 1,
        repo: "web",
      },
    });

    expect(capturedContext).toContain("(No PR description provided)");
  });
});
