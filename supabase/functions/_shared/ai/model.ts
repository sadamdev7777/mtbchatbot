// Model access: real Claude (official SDK, beta Messages API for server-side refusal fallbacks)
// or the deterministic mock model used when Claude is not connected in dev/tests.
import Anthropic from "@anthropic-ai/sdk";
import { runCostUsd } from "../core/rules.ts";
import { MOCK_PROVIDERS } from "../env.ts";
import { anthropicFor } from "../providers/claude.ts";
import { mockModelCall } from "./mock-model.ts";

export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type TextBlockParam = Anthropic.Beta.Messages.BetaTextBlockParam;
export type ToolDef = Anthropic.Beta.Messages.BetaTool;
export type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
export type ToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;

export type Purpose = "agent" | "router" | "summary" | "rewrite" | "judge" | "itinerary" | "night" | "receipt" | "followup";

export interface ModelCall {
  purpose: Purpose;
  model: string;
  system: TextBlockParam[];
  messages: MessageParam[];
  tools?: ToolDef[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh";
  /** JSON schema for structured output (output_config.format). */
  jsonSchema?: Record<string, unknown>;
}

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ModelResult { content: ContentBlock[]; stopReason: string | null; usage: Usage; model: string; costUsd: number }

export interface ChatModel {
  readonly mode: "real" | "mock";
  call(c: ModelCall): Promise<ModelResult>;
}

/** Sonnet/Opus support the server-side refusal fallback ("default" routing by refusal category). */
function supportsFallback(model: string): boolean {
  return /^claude-(sonnet|opus)-5-5/.test(model);
}

export class RealModel implements ChatModel {
  readonly mode = "real" as const;
  constructor(private client: Anthropic) {}
  async call(c: ModelCall): Promise<ModelResult> {
    const params: Record<string, unknown> = {
      model: c.model,
      max_tokens: c.maxTokens ?? 16000,
      system: c.system,
      messages: c.messages,
      ...(c.tools?.length ? { tools: c.tools } : {}),
      output_config: {
        ...(c.effort ? { effort: c.effort } : {}),
        ...(c.jsonSchema ? { format: { type: "json_schema", schema: c.jsonSchema } } : {}),
      },
    };
    if (supportsFallback(c.model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    const res = await this.client.beta.messages.create(params as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
    const usage: Usage = {
      input: res.usage.input_tokens ?? 0,
      output: res.usage.output_tokens ?? 0,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
    };
    return { content: res.content, stopReason: res.stop_reason, usage, model: res.model, costUsd: runCostUsd(res.model, usage) };
  }
}

export class MockModel implements ChatModel {
  readonly mode = "mock" as const;
  call(c: ModelCall): Promise<ModelResult> {
    return Promise.resolve(mockModelCall(c));
  }
}

/** Real Claude when connected; the mock model in local dev/tests (MOCK_PROVIDERS); otherwise null (AI inactive). */
export async function modelFor(companyId: string): Promise<ChatModel | null> {
  const client = await anthropicFor(companyId);
  if (client) return new RealModel(client);
  return MOCK_PROVIDERS() ? new MockModel() : null;
}

export function textOf(content: ContentBlock[]): string {
  return content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
}

export function jsonOf<T>(content: ContentBlock[]): T | null {
  const t = textOf(content);
  try {
    return JSON.parse(t) as T;
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]) as T; } catch { return null; }
  }
}
