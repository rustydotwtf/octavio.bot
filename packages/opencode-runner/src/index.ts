interface Part {
  text?: string;
  type: string;
}

interface OpenCodeClient {
  event: {
    subscribe(): Promise<{ stream: AsyncIterable<unknown> }>;
  };
  session: {
    create(input: {
      query: { directory: string };
    }): Promise<{ data?: { id: string } }>;
    prompt(input: {
      body: {
        parts: [{ text: string; type: "text" }];
        format?: {
          type: "json_schema";
          schema: unknown;
          retryCount?: number;
        };
      };
      path: { id: string };
      query: { directory: string };
      responseStyle?: "data" | "fields";
      throwOnError?: boolean;
    }): Promise<{
      data?: unknown;
      error?: unknown;
      response?: { status?: number };
    }>;
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

export interface OpenCodeRunnerOptions {
  hostname: string;
  model?: string;
  port: number;
  workspaceDirectory: string;
}

export interface GenerateReportInput {
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
  reportMarkdown: string;
  structuredFindings: ReportFinding[];
  usedStructuredOutput: boolean;
}

const collectTextFromParts = (parts: Part[]): string => {
  const textParts = parts
    .filter((part) => part.type === "text" || part.type === "reasoning")
    .map((part) => part.text?.trim() ?? "")
    .filter((part) => part.length > 0);

  return textParts.join("\n\n");
};

const isPart = (value: unknown): value is Part => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Part>;
  return typeof candidate.type === "string";
};

const asPartArray = (value: unknown): Part[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => isPart(item));
};

const extractResponseParts = (response: { data?: unknown }): Part[] => {
  const data = response.data as
    | {
        parts?: unknown;
        message?: { parts?: unknown };
        data?: { parts?: unknown };
      }
    | undefined;

  if (!data) {
    return [];
  }

  const candidates = [
    data.parts,
    data.message?.parts,
    data.data?.parts,
  ] as const;

  for (const candidate of candidates) {
    const parts = asPartArray(candidate);
    if (parts.length > 0) {
      return parts;
    }
  }

  return [];
};

const extractResponseText = (response: { data?: unknown }): string | null => {
  const { data } = response;
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as {
    data?: { text?: unknown };
    message?: { text?: unknown };
    output?: unknown;
    text?: unknown;
  };

  const possibleTextValues = [
    candidate.text,
    candidate.output,
    candidate.message?.text,
    candidate.data?.text,
  ];

  for (const value of possibleTextValues) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
};

const extractStructuredOutput = (response: { data?: unknown }): unknown => {
  const data = response.data as
    | {
        info?: { structured_output?: unknown };
        data?: { info?: { structured_output?: unknown } };
      }
    | undefined;

  return data?.info?.structured_output ?? data?.data?.info?.structured_output;
};

const asStructuredFindings = (value: unknown): ReportFinding[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => item as Partial<ReportFinding>)
    .filter(
      (item) =>
        typeof item.comment === "string" &&
        typeof item.id === "string" &&
        typeof item.line === "number" &&
        typeof item.path === "string" &&
        typeof item.severity === "string" &&
        typeof item.title === "string"
    )
    .map((item) => ({
      comment: item.comment ?? "",
      id: item.id ?? "",
      line: item.line ?? 0,
      path: item.path ?? "",
      severity: item.severity ?? "",
      title: item.title ?? "",
    }));
};

const extractStructuredReport = (response: {
  data?: unknown;
}): GenerateReportResult | null => {
  const structuredOutput = extractStructuredOutput(response);
  if (!structuredOutput || typeof structuredOutput !== "object") {
    return null;
  }

  const candidate = structuredOutput as {
    findings?: unknown;
    report_markdown?: unknown;
  };
  if (typeof candidate.report_markdown !== "string") {
    return null;
  }

  const reportMarkdown = candidate.report_markdown.trim();
  if (reportMarkdown.length === 0) {
    return null;
  }

  return {
    reportMarkdown,
    structuredFindings: asStructuredFindings(candidate.findings),
    usedStructuredOutput: true,
  };
};

const preview = (value: unknown): string => {
  try {
    const text = JSON.stringify(value) ?? "<empty>";
    return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
  } catch {
    return "<unserializable>";
  }
};

const writeRunnerLog = (message: string): void => {
  process.stdout.write(`[opencode-runner] ${message}\n`);
};

const HEARTBEAT_EVENT_TYPE = "server.heartbeat";

const startEventLogging = async (
  client: OpenCodeClient
): Promise<{ done: Promise<void>; stop: () => void }> => {
  const { stream } = await client.event.subscribe();
  let stopped = false;

  const done = (async () => {
    for await (const event of stream) {
      if (stopped) {
        break;
      }

      if (!event || typeof event !== "object") {
        continue;
      }

      const { properties, type } = event as {
        properties?: Record<string, unknown>;
        type?: unknown;
      };
      if (typeof type !== "string") {
        continue;
      }

      if (type === HEARTBEAT_EVENT_TYPE) {
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
      if (labels.length > 0) {
        writeRunnerLog(`event=${type} ${labels.join(" ")}`);
      } else {
        writeRunnerLog(`event=${type}`);
      }
    }
  })();

  return {
    done,
    stop: () => {
      stopped = true;
    },
  };
};

const buildLockedConfig = (model: string | undefined): Config => {
  const zenApiKey = process.env.OPENCODE_API_KEY;

  const config: Config = {
    enabled_providers: ["opencode"],
    permission: {
      bash: {
        "*": "deny",
        "git diff*": "allow",
        "git log*": "allow",
        "git show*": "allow",
        "git status*": "allow",
        "ls*": "allow",
        "pwd*": "allow",
        "rg*": "allow",
      },
      doom_loop: "deny",
      edit: "deny",
      external_directory: "deny",
      webfetch: "deny",
    },
  };

  if (model && model.trim().length > 0) {
    config.model = model;
    config.small_model = model;
  }

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
    writeRunnerLog("creating OpenCode instance");
    const opencode = await sdk.createOpencode({
      config: buildLockedConfig(this.options.model),
      hostname: this.options.hostname,
      port: this.options.port,
    });

    let eventLogger: { done: Promise<void>; stop: () => void } | null = null;
    try {
      writeRunnerLog("subscribing to OpenCode event stream");
      eventLogger = await startEventLogging(opencode.client);
    } catch (error: unknown) {
      writeRunnerLog(
        `event stream unavailable; continuing without live events (${error instanceof Error ? error.message : String(error)})`
      );
    }

    try {
      writeRunnerLog(
        `creating session for directory=${this.options.workspaceDirectory}`
      );
      const session = await opencode.client.session.create({
        query: { directory: this.options.workspaceDirectory },
      });
      const sessionId = session.data?.id;
      if (!sessionId) {
        throw new Error("OpenCode did not return a session ID.");
      }

      writeRunnerLog(`session created id=${sessionId}; sending prompt`);

      const startTimeMs = Date.now();
      const progressInterval = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startTimeMs) / 1000);
        writeRunnerLog(`prompt still running (${elapsedSeconds}s elapsed)`);
      }, 10_000);

      const response = await opencode.client.session
        .prompt({
          body: {
            format: {
              retryCount: 2,
              schema: {
                additionalProperties: false,
                properties: {
                  findings: {
                    items: {
                      additionalProperties: false,
                      properties: {
                        comment: { type: "string" },
                        id: { type: "string" },
                        line: { minimum: 1, type: "integer" },
                        path: { type: "string" },
                        severity: {
                          enum: ["low", "medium", "high", "critical"],
                          type: "string",
                        },
                        title: { type: "string" },
                      },
                      required: [
                        "id",
                        "severity",
                        "title",
                        "path",
                        "line",
                        "comment",
                      ],
                      type: "object",
                    },
                    type: "array",
                  },
                  report_markdown: { type: "string" },
                },
                required: ["report_markdown", "findings"],
                type: "object",
              },
              type: "json_schema",
            },
            parts: [
              {
                text: OpenCodeReportRunner.buildPrompt(
                  input.instructionsMarkdown,
                  input.contextMarkdown
                ),
                type: "text",
              },
            ],
          },
          path: { id: sessionId },
          query: { directory: this.options.workspaceDirectory },
          throwOnError: true,
        })
        .finally(() => {
          clearInterval(progressInterval);
        });

      if (!response.data) {
        throw new Error("OpenCode did not return a response payload.");
      }

      writeRunnerLog("received response payload from sdk");

      const structuredReport = extractStructuredReport(response);
      if (structuredReport) {
        writeRunnerLog(
          `structured output parsed findings=${structuredReport.structuredFindings.length}`
        );
        return structuredReport;
      }

      writeRunnerLog(
        "structured output unavailable; falling back to assistant message parsing"
      );

      const responseParts = extractResponseParts(response);
      if (responseParts.length === 0) {
        const responseText = extractResponseText(response);
        if (responseText) {
          writeRunnerLog("using text fallback response parsing");
          return {
            reportMarkdown: responseText,
            structuredFindings: [],
            usedStructuredOutput: false,
          };
        }

        throw new Error(
          `OpenCode response did not include assistant message parts. Response preview: ${preview(response.data)}`
        );
      }

      return {
        reportMarkdown: collectTextFromParts(responseParts),
        structuredFindings: [],
        usedStructuredOutput: false,
      };
    } finally {
      writeRunnerLog("closing OpenCode instance");
      eventLogger?.stop();
      opencode.server.close();
      if (eventLogger) {
        await Promise.race([eventLogger.done, Bun.sleep(1000)]);
      }
    }
  }

  private static buildPrompt(
    instructionsMarkdown: string,
    contextMarkdown: string
  ): string {
    return [
      "You are generating a pull request review report.",
      "Read project code in the current workspace only.",
      "Do not edit files or suggest commands that modify files.",
      "Return markdown with sections:",
      "1. Executive Summary",
      "2. Findings",
      "3. Suggested Comment Actions",
      "Use only findings with concrete path + line anchors.",
      "The markdown report and findings are also validated by structured JSON schema output.",
      "",
      "## Instructions",
      instructionsMarkdown,
      "",
      "## Context",
      contextMarkdown,
    ].join("\n");
  }
}
