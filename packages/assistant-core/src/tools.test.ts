import { afterEach, describe, expect, it } from "bun:test";

import { runPatchFileTool } from "./patch-file";
import { runReadFileTool } from "./read-file";

const createdPaths: string[] = [];

afterEach(async () => {
  for (const path of createdPaths) {
    try {
      await Bun.file(path).delete();
    } catch {
      // Cleanup is best-effort.
    }
  }
  createdPaths.length = 0;
});

describe("assistant tools", () => {
  it("reads file with offset and limit", async () => {
    const filePath = `octavio-assistant-read-${crypto.randomUUID()}.txt`;
    createdPaths.push(filePath);
    await Bun.write(filePath, "line1\nline2\nline3\nline4\n");

    const result = await runReadFileTool(
      {
        limit: 2,
        offset: 2,
        path: filePath,
      },
      process.cwd()
    );

    expect(result.content).toBe("line2\nline3");
    expect(result.lineCount).toBe(2);
    expect(result.path.endsWith(`/${filePath}`)).toBeTrue();
    expect(result.truncated).toBeTrue();
  });

  it("patches all matching text in a file", async () => {
    const filePath = `octavio-assistant-patch-${crypto.randomUUID()}.txt`;
    createdPaths.push(filePath);
    await Bun.write(filePath, "alpha beta alpha\n");

    const result = await runPatchFileTool(
      {
        find: "alpha",
        occurrence: "all",
        path: filePath,
        replace: "omega",
      },
      process.cwd()
    );

    const updated = await Bun.file(filePath).text();
    expect(result.changed).toBeTrue();
    expect(result.replacements).toBe(2);
    expect(updated).toBe("omega beta omega\n");
  });

  it("rejects read_file path traversal outside the workspace", async () => {
    await expect(
      runReadFileTool(
        {
          limit: 1,
          offset: 1,
          path: "../package.json",
        },
        process.cwd()
      )
    ).rejects.toThrow("Path escapes workspace directory");
  });

  it("rejects patch_file absolute paths outside the workspace", async () => {
    const filePath = `/tmp/octavio-assistant-outside-${crypto.randomUUID()}.txt`;
    createdPaths.push(filePath);
    await Bun.write(filePath, "hello");

    await expect(
      runPatchFileTool(
        {
          find: "hello",
          occurrence: "first",
          path: filePath,
          replace: "world",
        },
        process.cwd()
      )
    ).rejects.toThrow("Path escapes workspace directory");
  });
});
