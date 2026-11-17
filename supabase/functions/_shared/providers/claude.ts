// Anthropic Claude client factory. Real calls go through the official SDK; mock mode uses a
// deterministic rule-based model (see ../ai/mock-model.ts) so the AI team works without a key.
import Anthropic from "@anthropic-ai/sdk";
import { getSecret, useReal } from "../integrations.ts";

export async function anthropicFor(companyId: string): Promise<Anthropic | null> {
  if (!(await useReal(companyId, "claude"))) return null;
  const key = await getSecret(companyId, "claude", "api_key");
  return key ? new Anthropic({ apiKey: key, maxRetries: 2, timeout: 120_000 }) : null;
}

export async function testClaude(apiKey: string): Promise<string> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
  const m = await client.models.retrieve("claude-haiku-5-5");
  return `API key works (${m.display_name ?? m.id} reachable)`;
}
