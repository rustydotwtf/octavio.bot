import { tool } from "ai";
import { z } from "zod";

import type { ChatStore } from "./db";
import type { MemoryStore } from "./memory-db";
import { runPatchFileTool } from "./patch-file";
import { runReadFileTool } from "./read-file";
import { getMemoryInput, saveMemoryInput, webSearchInput } from "./types";
import { runWebSearchTool } from "./web-search";

interface BuildToolsInput {
  channel: string;
  channelMetadata?: Record<string, unknown>;
  conversationId: string;
  memoryStore: MemoryStore;
  store: ChatStore;
  workspaceDirectory: string;
}

const toJson = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "Unable to serialize value" });
  }
};

export const buildAssistantTools = ({
  channel,
  channelMetadata,
  conversationId,
  memoryStore,
  store,
  workspaceDirectory,
}: BuildToolsInput) => ({
  get_memory: tool({
    description:
      "Get memory entries by title, ordered newest first. Memory bodies are Markdown.",
    execute: (input) => {
      const callId = store.startToolCall({
        channel,
        conversationId,
        inputJson: toJson(input),
        metadataJson: channelMetadata ? toJson(channelMetadata) : undefined,
        toolName: "get_memory",
      });

      try {
        const memories = memoryStore.listMemoriesByTitle(
          input.title,
          input.limit
        );
        const result = {
          count: memories.length,
          memories,
          title: input.title,
        };
        store.finishToolCall({
          id: callId,
          outputJson: toJson(result),
          status: "completed",
        });
        return result;
      } catch (error: unknown) {
        store.finishToolCall({
          id: callId,
          outputJson: toJson({
            error: error instanceof Error ? error.message : String(error),
          }),
          status: "failed",
        });
        throw error;
      }
    },
    inputSchema: getMemoryInput,
  }),
  patch_file: tool({
    description: "Find and replace text in a file.",
    execute: async (input) => {
      const callId = store.startToolCall({
        channel,
        conversationId,
        inputJson: toJson(input),
        metadataJson: channelMetadata ? toJson(channelMetadata) : undefined,
        toolName: "patch_file",
      });

      try {
        const result = await runPatchFileTool(input, workspaceDirectory);
        store.finishToolCall({
          id: callId,
          outputJson: toJson(result),
          status: "completed",
        });
        return result;
      } catch (error: unknown) {
        store.finishToolCall({
          id: callId,
          outputJson: toJson({
            error: error instanceof Error ? error.message : String(error),
          }),
          status: "failed",
        });
        throw error;
      }
    },
    inputSchema: z.object({
      find: z.string(),
      occurrence: z.enum(["first", "all"]).default("first"),
      path: z.string().min(1),
      replace: z.string(),
    }),
  }),
  read_file: tool({
    description: "Read a file and return its content.",
    execute: async (input) => {
      const callId = store.startToolCall({
        channel,
        conversationId,
        inputJson: toJson(input),
        metadataJson: channelMetadata ? toJson(channelMetadata) : undefined,
        toolName: "read_file",
      });

      try {
        const result = await runReadFileTool(input, workspaceDirectory);
        store.finishToolCall({
          id: callId,
          outputJson: toJson(result),
          status: "completed",
        });
        return result;
      } catch (error: unknown) {
        store.finishToolCall({
          id: callId,
          outputJson: toJson({
            error: error instanceof Error ? error.message : String(error),
          }),
          status: "failed",
        });
        throw error;
      }
    },
    inputSchema: z.object({
      limit: z.number().int().positive().max(2000).default(2000),
      offset: z.number().int().positive().default(1),
      path: z.string().min(1),
    }),
  }),
  save_memory: tool({
    description:
      "Save a memory entry with a title and a Markdown body. Duplicate titles are stored as new entries.",
    execute: (input) => {
      const callId = store.startToolCall({
        channel,
        conversationId,
        inputJson: toJson(input),
        metadataJson: channelMetadata ? toJson(channelMetadata) : undefined,
        toolName: "save_memory",
      });

      try {
        const result = memoryStore.saveMemory({
          bodyMarkdown: input.body,
          title: input.title,
        });
        store.finishToolCall({
          id: callId,
          outputJson: toJson(result),
          status: "completed",
        });
        return result;
      } catch (error: unknown) {
        store.finishToolCall({
          id: callId,
          outputJson: toJson({
            error: error instanceof Error ? error.message : String(error),
          }),
          status: "failed",
        });
        throw error;
      }
    },
    inputSchema: saveMemoryInput,
  }),
  web_search: tool({
    description:
      "Search the web for current information and return normalized top results.",
    execute: async (input) => {
      const callId = store.startToolCall({
        channel,
        conversationId,
        inputJson: toJson(input),
        metadataJson: channelMetadata ? toJson(channelMetadata) : undefined,
        toolName: "web_search",
      });

      try {
        const result = await runWebSearchTool(input);
        store.finishToolCall({
          id: callId,
          outputJson: toJson(result),
          status: "completed",
        });
        return result;
      } catch (error: unknown) {
        store.finishToolCall({
          id: callId,
          outputJson: toJson({
            error: error instanceof Error ? error.message : String(error),
          }),
          status: "failed",
        });
        throw error;
      }
    },
    inputSchema: webSearchInput,
  }),
});

export type AssistantTools = ReturnType<typeof buildAssistantTools>;
