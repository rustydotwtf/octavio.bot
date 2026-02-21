import { z } from "zod";

const overallConfidenceSchema = z.enum(["low", "medium", "high"]);
const severitySchema = z.enum(["low", "medium", "high", "critical"]);

const findingSchema = z
  .object({
    comment: z.string().min(1),
    confidence: overallConfidenceSchema.optional(),
    id: z.string().min(1),
    line: z.coerce.number().int().positive(),
    path: z.string().min(1),
    severity: severitySchema,
    title: z.string().min(1),
  })
  .strict();

const confidenceArtifactSchema = z
  .object({
    findings: z.array(findingSchema),
    meta: z.record(z.string(), z.unknown()).default({}),
    overallConfidence: overallConfidenceSchema,
    summary: z.string().min(1),
  })
  .strict();

const parseFlag = (name: string): string | undefined => {
  const index = Bun.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  return Bun.argv[index + 1];
};

const pathFromDir = (directory: string, fileName: string): string =>
  `${directory.replace(/\/$/u, "")}/${fileName}`;

const run = async (): Promise<void> => {
  const artifactDirectory = parseFlag("--dir") ?? "artifacts";
  const reviewFile = parseFlag("--review-file") ?? "review.md";
  const confidenceFile = parseFlag("--confidence-file") ?? "confidence.json";

  const reviewPath = pathFromDir(artifactDirectory, reviewFile);
  const confidencePath = pathFromDir(artifactDirectory, confidenceFile);

  const review = Bun.file(reviewPath);
  if (!(await review.exists())) {
    throw new Error(`Missing required artifact: ${reviewPath}`);
  }

  const reviewText = await review.text();
  const reviewContents = reviewText.trim();
  if (reviewContents.length === 0) {
    throw new Error(`Artifact is empty: ${reviewPath}`);
  }

  const confidence = Bun.file(confidencePath);
  if (!(await confidence.exists())) {
    throw new Error(`Missing required artifact: ${confidencePath}`);
  }

  let confidenceJson: unknown;
  try {
    confidenceJson = await confidence.json();
  } catch (error: unknown) {
    throw new Error(
      `Invalid JSON in ${confidencePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  const parsed = confidenceArtifactSchema.safeParse(confidenceJson);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const location = issue.path.length > 0 ? issue.path.join(".") : "root";
        return `${location}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(
      `Schema validation failed for ${confidencePath}: ${details}`
    );
  }

  process.stdout.write(
    `Artifacts valid: ${reviewPath}, ${confidencePath}; findings=${parsed.data.findings.length}\n`
  );
};

try {
  await run();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`validate-artifacts failed: ${message}\n`);
  process.exitCode = 1;
}
