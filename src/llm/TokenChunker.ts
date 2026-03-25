export class TokenChunker {
  chunkText(text: string, maxTokens: number): string[] {
    const estimatedTokens = Math.ceil(text.length / 4);
    if (estimatedTokens <= maxTokens) {
      return [text];
    }

    const chunks: string[] = [];
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = "";
    let currentTokens = 0;

    for (const para of paragraphs) {
      const paraTokens = Math.ceil(para.length / 4);

      if (currentTokens + paraTokens > maxTokens && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
        currentTokens = 0;
      }

      // If a single paragraph exceeds maxTokens, split it by sentences
      if (paraTokens > maxTokens) {
        const sentences = para.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
          const sentTokens = Math.ceil(sentence.length / 4);
          if (
            currentTokens + sentTokens > maxTokens &&
            currentChunk.length > 0
          ) {
            chunks.push(currentChunk.trim());
            currentChunk = "";
            currentTokens = 0;
          }
          currentChunk += sentence + " ";
          currentTokens += sentTokens;
        }
      } else {
        currentChunk += para + "\n\n";
        currentTokens += paraTokens;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }
}
