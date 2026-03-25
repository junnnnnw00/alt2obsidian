import { LLMProvider } from "../types";

export class ClaudeProvider implements LLMProvider {
  name = "Claude";
  maxInputTokens = 200000;

  constructor(
    private apiKey: string,
    private model = "claude-sonnet-4-20250514"
  ) {}

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async generateText(): Promise<string> {
    // TODO: Implement Claude REST API via requestUrl
    throw new Error("Claude provider is not yet implemented");
  }

  async generateJSON<T>(): Promise<T> {
    throw new Error("Claude provider is not yet implemented");
  }
}
