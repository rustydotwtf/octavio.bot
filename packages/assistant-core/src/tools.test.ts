import { afterEach, describe, expect, it } from "bun:test";

import { runPatchFileTool } from "./patch-file";
import { runReadFileTool } from "./read-file";

const createdFiles: string[] = [];

afterEach(async () => {
  for (const filePath of createdFiles) {
    await Bun.file(filePath).delete();
  }
  createdFiles.length = 0;
});

describe("assistant tools", () => {
  it("reads file with offset and limit", async () => {
    const filePath = `/tmp/octavio-assistant-read-${crypto.randomUUID()}.txt`;
    createdFiles.push(filePath);
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
    expect(result.truncated).toBeTrue();
  });

  it("patches all matching text in a file", async () => {
    const filePath = `/tmp/octavio-assistant-patch-${crypto.randomUUID()}.txt`;
    createdFiles.push(filePath);
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
});
