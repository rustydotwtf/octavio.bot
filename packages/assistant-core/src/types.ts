import { z } from "zod";

export const chatRequestInput = z.object({
  channel: z.string().min(1).optional(),
  channelMetadata: z.record(z.string(), z.unknown()).optional(),
  conversationId: z.string().min(1).optional(),
  message: z.string().min(1),
  messageMetadata: z.record(z.string(), z.unknown()).optional(),
});

export type ChatRequestInput = z.infer<typeof chatRequestInput>;

export const readFileInput = z.object({
  limit: z.number().int().positive().max(2000).default(2000),
  offset: z.number().int().positive().default(1),
  path: z.string().min(1),
});

export type ReadFileInput = z.infer<typeof readFileInput>;

export const patchFileInput = z.object({
  find: z.string(),
  occurrence: z.enum(["first", "all"]).default("first"),
  path: z.string().min(1),
  replace: z.string(),
});

export type PatchFileInput = z.infer<typeof patchFileInput>;

export const webSearchInput = z.object({
  limit: z.number().int().positive().max(10).default(5),
  query: z.string().min(1),
});

export type WebSearchInput = z.infer<typeof webSearchInput>;

export const saveMemoryInput = z.object({
  body: z
    .string()
    .min(1)
    .describe("Markdown body content to store for this memory entry."),
  title: z.string().trim().min(1),
});

export type SaveMemoryInput = z.infer<typeof saveMemoryInput>;

export const getMemoryInput = z.object({
  limit: z.number().int().positive().max(50).default(10),
  title: z.string().trim().min(1),
});

export type GetMemoryInput = z.infer<typeof getMemoryInput>;

export const messageRole = z.enum(["user", "assistant", "system"]);
export type MessageRole = z.infer<typeof messageRole>;

export interface ChatMessageRow {
  channel: string;
  contentJson: string;
  conversationId: string;
  createdAt: string;
  id: string;
  metadataJson: string | null;
  role: MessageRole;
}
