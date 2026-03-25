import { LLMProvider } from "../types";
import { GeminiProvider } from "./GeminiProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { ClaudeProvider } from "./ClaudeProvider";

export function createProvider(
  type: string,
  apiKey: string,
  model?: string,
  rateDelayMs = 4000
): LLMProvider {
  switch (type) {
    case "gemini":
      return new GeminiProvider(apiKey, model || "gemini-2.5-flash", rateDelayMs);
    case "openai":
      return new OpenAIProvider(apiKey, model);
    case "claude":
      return new ClaudeProvider(apiKey, model);
    default:
      throw new Error(`Unknown LLM provider: ${type}`);
  }
}
