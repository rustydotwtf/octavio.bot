import { afterEach, describe, expect, it } from "bun:test";

import {
  parsePreviousFindingsPayload,
  readPreviousFindings,
} from "./previous-findings";

const tempDirectories: string[] = [];

const randomSuffix = (): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const runCommand = async (args: string[]): Promise<void> => {
  const result = Bun.spawn(args, {
    stderr: "pipe",
    stdout: "pipe",
  });
  const exitCode = await result.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(result.stderr).text();
    throw new Error(stderr || `Command failed: ${args.join(" ")}`);
  }
};

const createTempFile = async (
  fileName: string,
  contents: unknown
): Promise<string> => {
  const directory = `/tmp/octavio-review-${randomSuffix()}`;
  await runCommand(["mkdir", "-p", directory]);
  tempDirectories.push(directory);
  const path = `${directory}/${fileName}`;
  await Bun.write(path, `${JSON.stringify(contents, null, 2)}\n`);
  return path;
};

afterEach(async () => {
  for (const directory of tempDirectories.splice(0)) {
    await runCommand(["rm", "-rf", directory]);
  }
});

describe("parsePreviousFindingsPayload", () => {
  it("parses confidence payload findings", () => {
    const parsed = parsePreviousFindingsPayload({
      findings: [
        {
          comment: "Example comment",
          id: "F-1",
          line: 12,
          path: "src/File.ts",
          severity: "high",
          title: "Example title",
        },
      ],
    });

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.fingerprint).toBe("src/file.ts|12|high|example title");
  });

  it("parses legacy array payload findings", () => {
    const parsed = parsePreviousFindingsPayload([
      {
        comment: "Legacy payload",
        id: "F-2",
        line: 42,
        path: "packages/app/index.ts",
        severity: "medium",
        title: "Legacy finding",
      },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.fingerprint).toBe(
      "packages/app/index.ts|42|medium|legacy finding"
    );
  });

  it("keeps existing fingerprint from payload", () => {
    const parsed = parsePreviousFindingsPayload([
      {
        comment: "Precomputed",
        fingerprint: "legacy-fingerprint",
        id: "F-3",
        line: 7,
        path: "src/other.ts",
        severity: "low",
        title: "Existing fingerprint",
      },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.fingerprint).toBe("legacy-fingerprint");
  });
});

describe("readPreviousFindings", () => {
  it("returns [] when file is missing", async () => {
    const path = `/tmp/missing-${randomSuffix()}.json`;
    const parsed = await readPreviousFindings(path);
    expect(parsed).toEqual([]);
  });

  it("reads findings from confidence artifact file", async () => {
    const path = await createTempFile("confidence.json", {
      findings: [
        {
          comment: "Persisting",
          id: "F-4",
          line: 10,
          path: "src/sample.ts",
          severity: "critical",
          title: "Critical issue",
        },
      ],
      meta: {},
      overallConfidence: "high",
      summary: "One finding",
    });

    const parsed = await readPreviousFindings(path);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.fingerprint).toBe(
      "src/sample.ts|10|critical|critical issue"
    );
  });
});
