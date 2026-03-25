import {
  AltNoteData,
  SlideImage,
  LLMResult,
  ConceptNote,
  ImagePlacement,
  LLMProvider,
} from "../types";
import { sanitizeFilename, formatDate } from "../utils/helpers";

export class NoteGenerator {
  constructor(private llm: LLMProvider) {}

  async generate(
    altData: AltNoteData,
    images: SlideImage[],
    llmResult: LLMResult,
    subject: string
  ): Promise<{ lectureMarkdown: string; conceptNotes: ConceptNote[] }> {
    // Handle partial parse quality
    if (altData.parseQuality === "partial") {
      return this.generatePartialNote(altData, subject);
    }

    const title = sanitizeFilename(altData.title);
    const tags = [subject.toLowerCase(), ...llmResult.tags];

    // Build frontmatter (NO # prefix in YAML)
    const frontmatter = [
      "---",
      `title: "${altData.title}"`,
      `subject: "${subject}"`,
      `tags: [${tags.join(", ")}]`,
      `date: "${formatDate()}"`,
      `source: "alt2obsidian"`,
      altData.metadata.createdAt
        ? `alt_created: "${altData.metadata.createdAt}"`
        : null,
      `alt_id: "${altData.metadata.noteId}"`,
      "---",
      "",
    ]
      .filter((line) => line !== null)
      .join("\n");

    // Process summary with wikilinks and image embeds
    let content = llmResult.processedSummary || altData.summary;

    // Insert concept wikilinks
    for (const concept of llmResult.concepts) {
      const regex = new RegExp(`(?<!\\[\\[)${this.escapeRegex(concept.name)}(?!\\]\\])`, "gi");
      content = content.replace(regex, `[[${concept.name}]]`);
    }

    // Insert slide images
    if (images.length > 0) {
      content = this.insertImages(content, images, llmResult.imagePlacements);
    }

    const lectureMarkdown = frontmatter + `# ${altData.title}\n\n` + content;

    // Build concept notes
    const conceptNotes: ConceptNote[] = llmResult.concepts.map((c) => ({
      name: c.name,
      definition: c.definition,
      relatedLectures: [title],
      relatedConcepts: c.relatedConcepts,
    }));

    return { lectureMarkdown, conceptNotes };
  }

  async getImagePlacements(
    summary: string,
    imageCount: number
  ): Promise<ImagePlacement[]> {
    if (imageCount === 0) return [];

    // Extract section headers
    const headers = summary
      .split("\n")
      .filter((l) => l.startsWith("##"))
      .map((l) => l.replace(/^#+\s*/, "").trim());

    if (headers.length === 0) {
      // Evenly distribute if no headers
      return this.evenlyDistributeImages(imageCount, summary);
    }

    try {
      const prompt = `Given these section headers from a lecture note and ${imageCount} slide images (numbered 0 to ${imageCount - 1}), suggest where each image should be placed.

Section headers:
${headers.map((h, i) => `${i}: ${h}`).join("\n")}

Return a JSON array where each element has:
- imageIndex: number (0-based image index)
- afterSection: string (exact section header text the image should follow)

Distribute images across sections. Each image should go after the most relevant section.`;

      return this.llm.generateJSON(
        prompt,
        (raw: unknown): ImagePlacement[] => {
          if (!Array.isArray(raw)) throw new Error("Expected array");
          return raw.map((item: Record<string, unknown>) => ({
            imageIndex: Number(item.imageIndex),
            afterSection: String(item.afterSection),
          }));
        }
      );
    } catch {
      // Fallback: evenly distribute
      return this.evenlyDistributeImages(imageCount, summary);
    }
  }

  private insertImages(
    content: string,
    images: SlideImage[],
    placements: ImagePlacement[]
  ): string {
    if (placements.length === 0 || images.length === 0) {
      // Fallback: append all images at the end
      const imageEmbeds = images
        .map((img) => `\n![[${img.filename}]]\n`)
        .join("");
      return content + "\n" + imageEmbeds;
    }

    const lines = content.split("\n");
    const insertions = new Map<number, string[]>();

    for (const placement of placements) {
      if (placement.imageIndex >= images.length) continue;
      const img = images[placement.imageIndex];

      // Find the line index of the matching section header
      for (let i = 0; i < lines.length; i++) {
        if (
          lines[i].startsWith("#") &&
          lines[i].includes(placement.afterSection)
        ) {
          // Find end of section (next header or end of content after some text)
          let insertAt = i + 1;
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].startsWith("#")) {
              insertAt = j;
              break;
            }
            insertAt = j + 1;
          }

          if (!insertions.has(insertAt)) {
            insertions.set(insertAt, []);
          }
          insertions.get(insertAt)!.push(`\n![[${img.filename}]]\n`);
          break;
        }
      }
    }

    // Build result with insertions
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      // Insert images before this line if scheduled
      if (insertions.has(i)) {
        result.push(...insertions.get(i)!);
      }
      result.push(lines[i]);
    }
    // Insert any remaining at end
    if (insertions.has(lines.length)) {
      result.push(...insertions.get(lines.length)!);
    }

    return result.join("\n");
  }

  private evenlyDistributeImages(
    imageCount: number,
    content: string
  ): ImagePlacement[] {
    const headers = content
      .split("\n")
      .filter((l) => l.startsWith("##"))
      .map((l) => l.replace(/^#+\s*/, "").trim());

    if (headers.length === 0) return [];

    const placements: ImagePlacement[] = [];
    for (let i = 0; i < imageCount; i++) {
      const sectionIdx = Math.floor((i / imageCount) * headers.length);
      placements.push({
        imageIndex: i,
        afterSection: headers[Math.min(sectionIdx, headers.length - 1)],
      });
    }
    return placements;
  }

  private generatePartialNote(
    altData: AltNoteData,
    subject: string
  ): { lectureMarkdown: string; conceptNotes: ConceptNote[] } {
    const frontmatter = [
      "---",
      `title: "${altData.title}"`,
      `subject: "${subject}"`,
      `tags: [${subject.toLowerCase()}]`,
      `date: "${formatDate()}"`,
      `source: "alt2obsidian"`,
      `parse_quality: "partial"`,
      "---",
      "",
    ].join("\n");

    const lectureMarkdown =
      frontmatter +
      `# ${altData.title}\n\n` +
      `> ⚠️ Partial import — Alt page format may have changed. Only title and description were extracted.\n\n` +
      (altData.summary || "내용을 추출할 수 없습니다.");

    return { lectureMarkdown, conceptNotes: [] };
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
