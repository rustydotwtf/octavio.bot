import type { ReviewFinding } from "@octavio/agent-code-review";

const computeFingerprint = (finding: {
  line: number;
  path: string;
  severity: string;
  title: string;
}): string =>
  [
    finding.path.trim().toLowerCase(),
    String(finding.line),
    finding.severity.trim().toLowerCase(),
    finding.title.trim().toLowerCase(),
  ].join("|");

const toReviewFinding = (value: unknown): ReviewFinding | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ReviewFinding>;
  if (
    typeof candidate.comment !== "string" ||
    typeof candidate.id !== "string" ||
    typeof candidate.line !== "number" ||
    !Number.isInteger(candidate.line) ||
    candidate.line <= 0 ||
    typeof candidate.path !== "string" ||
    typeof candidate.severity !== "string" ||
    typeof candidate.title !== "string"
  ) {
    return null;
  }

  return {
    comment: candidate.comment,
    fingerprint:
      candidate.fingerprint ??
      computeFingerprint({
        line: candidate.line,
        path: candidate.path,
        severity: candidate.severity,
        title: candidate.title,
      }),
    id: candidate.id,
    line: candidate.line,
    path: candidate.path,
    severity: candidate.severity,
    title: candidate.title,
  };
};

const extractFindingsFromConfidencePayload = (
  payload: unknown
): ReviewFinding[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const maybeFindings = (payload as { findings?: unknown }).findings;
  if (!Array.isArray(maybeFindings)) {
    return [];
  }

  return maybeFindings
    .map((item) => toReviewFinding(item))
    .filter((item) => item !== null);
};

export const parsePreviousFindingsPayload = (
  payload: unknown
): ReviewFinding[] => {
  const confidenceFindings = extractFindingsFromConfidencePayload(payload);
  if (confidenceFindings.length > 0) {
    return confidenceFindings;
  }

  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => toReviewFinding(item))
    .filter((item) => item !== null);
};

export const readPreviousFindings = async (
  previousFindingsPath: string | undefined
): Promise<ReviewFinding[]> => {
  if (!previousFindingsPath) {
    return [];
  }

  const file = Bun.file(previousFindingsPath);
  if (!(await file.exists())) {
    return [];
  }

  const parsed = (await file.json()) as unknown;
  return parsePreviousFindingsPayload(parsed);
};
