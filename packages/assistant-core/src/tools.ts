import { tool } from "ai";
import { z } from "zod";

import type { ChatStore } from "./db";
import { runPatchFileTool } from "./patch-file";
import { runReadFileTool } from "./read-file";

interface BuildToolsInput {
  conversationId: string;
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
  conversationId,
  store,
  workspaceDirectory,
}: BuildToolsInput) => ({
  patch_file: tool({
    description: "Find and replace text in a file.",
    execute: async (input) => {
      const callId = store.startToolCall({
        conversationId,
        inputJson: toJson(input),
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
        conversationId,
        inputJson: toJson(input),
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
});

export type AssistantTools = ReturnType<typeof buildAssistantTools>;
