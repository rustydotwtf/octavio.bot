interface OpenCodeClient {
  event: {
    subscribe(): Promise<{ stream: AsyncIterable<unknown> }>;
  };
  session: {
    create(input: {
      query: { directory: string };
    }): Promise<{ data?: { id: string } }>;
    prompt(input: {
      body: { parts: [{ text: string; type: "text" }] };
      path: { id: string };
      query: { directory: string };
      throwOnError?: boolean;
    }): Promise<{ data?: unknown }>;
  };
}

interface OpenCodeInstance {
  client: OpenCodeClient;
  server: {
    close: () => void;
  };
}

interface Config {
  enabled_providers?: string[];
  model?: string;
  provider?: {
    opencode?: {
      options?: {
        apiKey?: string;
      };
    };
  };
  small_model?: string;
  permission: {
    bash: Record<string, "allow" | "ask" | "deny">;
    doom_loop: "allow" | "ask" | "deny";
    edit: "allow" | "ask" | "deny";
    external_directory: "allow" | "ask" | "deny";
    webfetch: "allow" | "ask" | "deny";
  };
}

interface OpenCodeModule {
  createOpencode(input: {
    config: Config;
    hostname: string;
    port: number;
  }): Promise<OpenCodeInstance>;
}

export type ArtifactExecution = "host" | "agent";

export interface ArtifactSchemaConfig {
  artifactDir: string;
  confidenceFile: string;
  maxAttempts: number;
  reviewFile: string;
  validatorCommand: string;
}

export interface OpenCodeRunnerOptions {
  hostname: string;
  model?: string;
  port: number;
  workspaceDirectory: string;
}

export interface GenerateReportInput {
  artifactExecution: ArtifactExecution;
  artifactSchema: ArtifactSchemaConfig;
  contextMarkdown: string;
  instructionsMarkdown: string;
}

export interface ReportFinding {
  comment: string;
  id: string;
  line: number;
  path: string;
  severity: string;
  title: string;
}

export interface GenerateReportResult {
  confidenceJson: string;
  reportMarkdown: string;
  structuredFindings: ReportFinding[];
  usedStructuredOutput: boolean;
}

interface ArtifactValidationResult {
  confidenceJson: string;
  findings: ReportFinding[];
  reportMarkdown: string;
}

const HEARTBEAT_EVENT_TYPE = "server.heartbeat";

const writeRunnerLog = (message: string): void => {
  process.stdout.write(`[opencode-runner] ${message}\n`);
};

const preview = (value: unknown): string => {
  try {
    const text = JSON.stringify(value) ?? "<empty>";
    return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
  } catch {
    return "<unserializable>";
  }
};

const startEventLogging = async (
  client: OpenCodeClient
): Promise<{ done: Promise<void>; stop: () => void }> => {
  const { stream } = await client.event.subscribe();
  const iterator = stream[Symbol.asyncIterator]();
  let stopped = false;

  const closeStream = async (): Promise<void> => {
    if (typeof iterator.return !== "function") {
      return;
    }

    try {
      await iterator.return();
    } catch {
      // Ignore close failures while shutting down logging.
    }
  };

  const done = (async () => {
    while (true) {
      const next = await iterator.next();
      if (next.done || stopped) {
        break;
      }

      const event = next.value;
      if (!event || typeof event !== "object") {
        continue;
      }

      const { properties, type } = event as {
        properties?: Record<string, unknown>;
        type?: unknown;
      };
      if (typeof type !== "string" || type === HEARTBEAT_EVENT_TYPE) {
        continue;
      }

      const { phase, status, tool } = properties ?? {};
      const labels = [
        typeof status === "string" ? `status=${status}` : null,
        typeof phase === "string" ? `phase=${phase}` : null,
        typeof tool === "string" ? `tool=${tool}` : null,
      ].filter(Boolean) as string[];
      if (properties && Object.keys(properties).length > 0) {
        labels.push(`properties=${preview(properties)}`);
      }

      writeRunnerLog(
        labels.length > 0
          ? `event=${type} ${labels.join(" ")}`
          : `event=${type}`
      );
    }
  })();

  return {
    done,
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      void closeStream();
    },
  };
};

const buildBashPermission = (
  artifactExecution: ArtifactExecution
): Record<string, "allow" | "ask" | "deny"> => {
  if (artifactExecution === "host") {
    return {
      "*": "deny",
      "git diff*": "allow",
      "git log*": "allow",
      "git show*": "allow",
      "git status*": "allow",
      "ls*": "allow",
      "pwd*": "allow",
      "rg*": "allow",
    };
  }

  return {
    "*": "deny",
    "bun run validate-artifacts*": "allow",
    "git diff*": "allow",
    "git log*": "allow",
    "git show*": "allow",
    "git status*": "allow",
    "ls*": "allow",
    "mkdir*": "allow",
    "pwd*": "allow",
    "rg*": "allow",
  };
};

const buildLockedConfig = (
  model: string | undefined,
  artifactExecution: ArtifactExecution
): Config => {
  const config: Config = {
    enabled_providers: ["opencode"],
    permission: {
      bash: buildBashPermission(artifactExecution),
      doom_loop: "deny",
      edit: artifactExecution === "agent" ? "allow" : "deny",
      external_directory: "deny",
      webfetch: "deny",
    },
  };

  if (model && model.trim().length > 0) {
    config.model = model;
    config.small_model = model;
  }

  const zenApiKey = process.env.OPENCODE_API_KEY;
  if (zenApiKey && zenApiKey.trim().length > 0) {
    config.provider = {
      opencode: {
        options: {
          apiKey: zenApiKey,
        },
      },
    };
  }

  return config;
};

const parseFindingsFromConfidence = (value: unknown): ReportFinding[] => {
  if (!value || typeof value !== "object") {
    return [];
  }

  const findingsCandidate = (value as { findings?: unknown }).findings;
  if (!Array.isArray(findingsCandidate)) {
    return [];
  }

  const findings: ReportFinding[] = [];
  for (const item of findingsCandidate) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const finding = item as Partial<ReportFinding>;
    if (
      typeof finding.comment !== "string" ||
      typeof finding.id !== "string" ||
      typeof finding.line !== "number" ||
      !Number.isInteger(finding.line) ||
      finding.line <= 0 ||
      typeof finding.path !== "string" ||
      typeof finding.severity !== "string" ||
      typeof finding.title !== "string"
    ) {
      continue;
    }

    findings.push({
      comment: finding.comment,
      id: finding.id,
      line: finding.line,
      path: finding.path,
      severity: finding.severity,
      title: finding.title,
    });
  }

  return findings;
};

const pathFromWorkspace = (workspace: string, filePath: string): string =>
  `${workspace.replace(/\/$/u, "")}/${filePath.replace(/^\//u, "")}`;

const readProcessStream = async (
  stream: ReadableStream<Uint8Array> | null
): Promise<string> => (stream ? await new Response(stream).text() : "");

const runValidatorCommand = async (
  command: string,
  workspaceDirectory: string
): Promise<{ ok: boolean; output: string }> => {
  const subprocess = Bun.spawn(["bash", "-lc", command], {
    cwd: workspaceDirectory,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    subprocess.exited,
    readProcessStream(subprocess.stderr),
    readProcessStream(subprocess.stdout),
  ]);

  const output = [stdout.trim(), stderr.trim()]
    .filter((entry) => entry.length > 0)
    .join("\n");
  return { ok: exitCode === 0, output };
};

const validateArtifactsFromDisk = async (
  workspaceDirectory: string,
  artifactSchema: ArtifactSchemaConfig
): Promise<ArtifactValidationResult> => {
  const reviewPath = pathFromWorkspace(
    workspaceDirectory,
    `${artifactSchema.artifactDir}/${artifactSchema.reviewFile}`
  );
  const confidencePath = pathFromWorkspace(
    workspaceDirectory,
    `${artifactSchema.artifactDir}/${artifactSchema.confidenceFile}`
  );

  const reviewFile = Bun.file(reviewPath);
  if (!(await reviewFile.exists())) {
    throw new Error(`Missing artifact file: ${reviewPath}`);
  }
  const confidenceFile = Bun.file(confidencePath);
  if (!(await confidenceFile.exists())) {
    throw new Error(`Missing artifact file: ${confidencePath}`);
  }

  const reviewText = await reviewFile.text();
  const reportMarkdown = reviewText.trim();
  if (reportMarkdown.length === 0) {
    throw new Error(`Artifact file is empty: ${reviewPath}`);
  }

  const confidenceRaw = await confidenceFile.text();
  const confidenceJson = confidenceRaw.trim();
  if (confidenceJson.length === 0) {
    throw new Error(`Artifact file is empty: ${confidencePath}`);
  }

  let confidenceParsed: unknown;
  try {
    confidenceParsed = JSON.parse(confidenceJson);
  } catch (error: unknown) {
    throw new Error(
      `Invalid JSON at ${confidencePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }

  return {
    confidenceJson,
    findings: parseFindingsFromConfidence(confidenceParsed),
    reportMarkdown,
  };
};

export class OpenCodeReportRunner {
  private readonly options: OpenCodeRunnerOptions;

  public constructor(options: OpenCodeRunnerOptions) {
    this.options = options;
  }

  public async generateReport(
    input: GenerateReportInput
  ): Promise<GenerateReportResult> {
    writeRunnerLog(
      `initializing sdk client host=${this.options.hostname} port=${this.options.port} model=${this.options.model ?? "<default>"}`
    );
    const sdk = (await import("@opencode-ai/sdk")) as OpenCodeModule;
    const opencode = await sdk.createOpencode({
      config: buildLockedConfig(this.options.model, input.artifactExecution),
      hostname: this.options.hostname,
      port: this.options.port,
    });

    let eventLogger: { done: Promise<void>; stop: () => void } | null = null;
    try {
      eventLogger = await startEventLogging(opencode.client);
    } catch (error: unknown) {
      writeRunnerLog(
        `event stream unavailable; continuing (${error instanceof Error ? error.message : String(error)})`
      );
    }

    try {
      const session = await opencode.client.session.create({
        query: { directory: this.options.workspaceDirectory },
      });
      const sessionId = session.data?.id;
      if (!sessionId) {
        throw new Error("OpenCode did not return a session ID.");
      }

      let validationErrors = "";
      for (
        let attempt = 1;
        attempt <= input.artifactSchema.maxAttempts;
        attempt += 1
      ) {
        writeRunnerLog(
          `prompt attempt ${attempt}/${input.artifactSchema.maxAttempts}`
        );

        const text =
          attempt === 1
            ? OpenCodeReportRunner.buildPrompt(
                input.instructionsMarkdown,
                input.contextMarkdown,
                input.artifactSchema
              )
            : OpenCodeReportRunner.buildRetryPrompt(
                input.artifactSchema,
                validationErrors
              );

        const response = await opencode.client.session.prompt({
          body: { parts: [{ text, type: "text" }] },
          path: { id: sessionId },
          query: { directory: this.options.workspaceDirectory },
          throwOnError: true,
        });
        writeRunnerLog(`assistant response preview: ${preview(response.data)}`);

        const validatorResult = await runValidatorCommand(
          input.artifactSchema.validatorCommand,
          this.options.workspaceDirectory
        );
        if (!validatorResult.ok) {
          validationErrors =
            validatorResult.output ||
            "Validator command failed without output.";
          writeRunnerLog(`artifact validation failed: ${validationErrors}`);
          continue;
        }

        try {
          const artifacts = await validateArtifactsFromDisk(
            this.options.workspaceDirectory,
            input.artifactSchema
          );
          return {
            confidenceJson: artifacts.confidenceJson,
            reportMarkdown: artifacts.reportMarkdown,
            structuredFindings: artifacts.findings,
            usedStructuredOutput: true,
          };
        } catch (error: unknown) {
          validationErrors =
            error instanceof Error ? error.message : String(error);
          writeRunnerLog(`artifact read failed: ${validationErrors}`);
        }
      }

      throw new Error(
        `Artifact generation failed after ${input.artifactSchema.maxAttempts} attempts. Last validation error: ${validationErrors || "unknown"}`
      );
    } finally {
      eventLogger?.stop();
      opencode.server.close();
      if (eventLogger) {
        await Promise.race([eventLogger.done, Bun.sleep(1000)]);
      }
    }
  }

  private static buildPrompt(
    instructionsMarkdown: string,
    contextMarkdown: string,
    artifactSchema: ArtifactSchemaConfig
  ): string {
    return [
      "You are generating a pull request review report.",
      "Read project code in the current workspace only.",
      "Create artifact files directly on disk and validate them before finishing.",
      "",
      "## Artifact Schema",
      `Artifact directory: ${artifactSchema.artifactDir}`,
      `Required markdown report: ${artifactSchema.artifactDir}/${artifactSchema.reviewFile}`,
      `Required JSON report: ${artifactSchema.artifactDir}/${artifactSchema.confidenceFile}`,
      "JSON must include: summary (string), overallConfidence (low|medium|high), findings (array), meta (object).",
      "Each finding must include: id, severity (low|medium|high|critical), title, path, line (>0 int), comment.",
      `Validator command: ${artifactSchema.validatorCommand}`,
      "",
      "## Instructions",
      instructionsMarkdown,
      "",
      "## Context",
      contextMarkdown,
    ].join("\n");
  }

  private static buildRetryPrompt(
    artifactSchema: ArtifactSchemaConfig,
    validationErrors: string
  ): string {
    return [
      "Artifacts failed validation. Fix files and re-run validator.",
      `Artifact directory: ${artifactSchema.artifactDir}`,
      `Required files: ${artifactSchema.artifactDir}/${artifactSchema.reviewFile}, ${artifactSchema.artifactDir}/${artifactSchema.confidenceFile}`,
      `Validator command: ${artifactSchema.validatorCommand}`,
      "",
      "Validation errors:",
      validationErrors,
    ].join("\n");
  }
}
