import { LLMProvider } from "../types";

export class OpenAIProvider implements LLMProvider {
  name = "OpenAI";
  maxInputTokens = 128000;

  constructor(
    private apiKey: string,
    private model = "gpt-4o"
  ) {}

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async generateText(): Promise<string> {
    // TODO: Implement OpenAI REST API via requestUrl
    throw new Error("OpenAI provider is not yet implemented");
  }

  async generateJSON<T>(): Promise<T> {
    throw new Error("OpenAI provider is not yet implemented");
  }
}
