import { describe, expect, it } from "bun:test";

import type { GitHubReviewClient } from "@octavio/github-review";
import type { OpenCodeReportRunner } from "@octavio/opencode-runner";

import { CodeReviewWorkflow } from "./index";

const createWorkflow = (severity: "low" | "medium" | "high" | "critical") =>
  new CodeReviewWorkflow({
    githubClient: {
      getPullRequest: async () => {
        await Bun.sleep(0);
        return {
          baseSha: "base",
          body: null,
          headSha: "head",
          number: 1,
          title: "Test PR",
        };
      },
      listPullRequestFiles: async () => {
        await Bun.sleep(0);
        return [];
      },
    } as unknown as GitHubReviewClient,
    opencodeRunner: {
      generateReport: async () => {
        await Bun.sleep(0);
        return {
          confidenceJson: "{}",
          reportMarkdown: "# Review",
          structuredFindings: [
            {
              comment: "Example",
              id: "F-1",
              line: 11,
              path: "src/file.ts",
              severity,
              title: "Example finding",
            },
          ],
          usedStructuredOutput: true,
        };
      },
    } as unknown as OpenCodeReportRunner,
  });

describe("policy parsing precedence", () => {
  it("falls back when config failOn is empty", async () => {
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
      policyFailOnRules: [],
      previousFindings: [],
      repo: {
        owner: "acme",
        pullNumber: 1,
        repo: "web",
      },
    });

    expect(result.policy.source).toBe("fallback");
    expect(result.policy.shouldFail).toBeFalse();
    expect(result.policy.failOnRules).toEqual([]);
    expect(result.policy.warnings).toContain(
      "Config policy.failOn did not include any valid rules; using fail-open fallback."
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
});
