interface Part {
  text?: string;
  type: string;
}

interface OpenCodeClient {
  session: {
    create(input: {
      query: { directory: string };
    }): Promise<{ data?: { id: string } }>;
    prompt(input: {
      body: { parts: [{ text: string; type: "text" }] };
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
  model?: string;
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

const safeJsonPreview = (value: unknown): string => {
  try {
    const encoded = JSON.stringify(value);
    if (!encoded) {
      return "<empty>";
    }

    const maxChars = 1200;
    return encoded.length > maxChars
      ? `${encoded.slice(0, maxChars)}...`
      : encoded;
  } catch {
    return "<unserializable>";
  }
};

const buildLockedConfig = (model: string | undefined): Config => {
  const config: Config = {
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
  }

  return config;
};

export class OpenCodeReportRunner {
  private readonly options: OpenCodeRunnerOptions;

  public constructor(options: OpenCodeRunnerOptions) {
    this.options = options;
  }

  public async generateReport(input: GenerateReportInput): Promise<string> {
    const sdk = (await import("@opencode-ai/sdk")) as OpenCodeModule;
    const opencode = await sdk.createOpencode({
      config: buildLockedConfig(this.options.model),
      hostname: this.options.hostname,
      port: this.options.port,
    });

    try {
      const session = await opencode.client.session.create({
        query: { directory: this.options.workspaceDirectory },
      });
      const sessionId = session.data?.id;
      if (!sessionId) {
        throw new Error("OpenCode did not return a session ID.");
      }

      const response = await opencode.client.session.prompt({
        body: {
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
      });

      if (!response.data) {
        throw new Error("OpenCode did not return a response payload.");
      }

      const responseParts = extractResponseParts(response);
      if (responseParts.length === 0) {
        const responseText = extractResponseText(response);
        if (responseText) {
          return responseText;
        }

        throw new Error(
          `OpenCode response did not include assistant message parts. Response preview: ${safeJsonPreview(response.data)}`
        );
      }

      return collectTextFromParts(responseParts);
    } finally {
      opencode.server.close();
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
      "In the Findings section, include a JSON code block with this schema:",
      '{"findings":[{"id":"string","severity":"low|medium|high|critical","title":"string","path":"string","line":1,"comment":"string"}]}.',
      "Use only findings with concrete path + line anchors.",
      "",
      "## Instructions",
      instructionsMarkdown,
      "",
      "## Context",
      contextMarkdown,
    ].join("\n");
  }
}
