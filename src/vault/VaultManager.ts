import { App, TFolder, normalizePath } from "obsidian";
import {
  ConceptNote,
  ExamPeriod,
  MANAGED_NOTE_START,
  MANAGED_NOTE_END,
} from "../types";
import { sanitizeFilename } from "../utils/helpers";
import { ConceptRegistry } from "./ConceptRegistry";

export class VaultManager {
  private conceptRegistry = new ConceptRegistry();

  constructor(
    private app: App,
    private basePath: string
  ) {}

  setBasePath(path: string): void {
    this.basePath = path;
  }

  getBasePath(): string {
    return this.basePath;
  }

  async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFolder) return;

    try {
      await this.app.vault.createFolder(normalized);
    } catch {
      // Folder may already exist (race condition) — that's fine
    }
  }

  async saveNote(content: string, path: string): Promise<string> {
    const normalized = normalizePath(path);
    const dir = normalized.substring(0, normalized.lastIndexOf("/"));
    await this.ensureFolder(dir);

    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing) {
      await this.app.vault.modify(existing as any, content);
    } else {
      await this.app.vault.create(normalized, content);
    }

    return normalized;
  }

  async saveManagedNote(
    content: string,
    path: string
  ): Promise<{ path: string; wasUpdate: boolean }> {
    const normalized = normalizePath(path);
    const dir = normalized.substring(0, normalized.lastIndexOf("/"));
    await this.ensureFolder(dir);

    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (!existing) {
      await this.app.vault.create(normalized, content);
      return { path: normalized, wasUpdate: false };
    }

    const currentContent = await this.app.vault.read(existing as any);
    const updatedContent = this.mergeManagedNote(currentContent, content);
    await this.app.vault.modify(existing as any, updatedContent);

    return { path: normalized, wasUpdate: true };
  }

  async saveConceptNotes(
    concepts: ConceptNote[],
    lectureTitle: string,
    subject?: string
  ): Promise<string[]> {
    // Organize concepts inside subject folder: Alt2Obsidian/{subject}/Concepts/
    const conceptsFolder = subject
      ? normalizePath(`${this.basePath}/${sanitizeFilename(subject)}/Concepts`)
      : normalizePath(`${this.basePath}/Concepts`);
    await this.ensureFolder(conceptsFolder);

    const acquiredNames: string[] = [];
    const savedPaths: string[] = [];

    try {
      for (const concept of concepts) {
        const filename = sanitizeFilename(concept.name);
        const path = normalizePath(`${conceptsFolder}/${filename}.md`);
        const existing = this.app.vault.getAbstractFileByPath(path);

        if (existing) {
          // Update existing concept note: append lecture reference
          const currentContent = await this.app.vault.read(existing as any);
          if (!currentContent.includes(`[[${lectureTitle}]]`)) {
            const updated = this.appendLectureReference(
              currentContent,
              lectureTitle
            );
            await this.app.vault.modify(existing as any, updated);
          }
          savedPaths.push(path);
        } else if (this.conceptRegistry.acquire(concept.name)) {
          acquiredNames.push(concept.name);
          const content = this.buildConceptNoteContent(concept);
          await this.app.vault.create(path, content);
          savedPaths.push(path);
        }
      }
    } finally {
      this.conceptRegistry.releaseAll(acquiredNames);
    }

    return savedPaths;
  }

  async getExistingConceptNames(subject: string): Promise<Set<string>> {
    const conceptsFolder = normalizePath(
      `${this.basePath}/${sanitizeFilename(subject)}/Concepts`
    );
    const folder = this.app.vault.getAbstractFileByPath(conceptsFolder);
    const names = new Set<string>();

    if (!(folder instanceof TFolder)) return names;

    for (const child of folder.children) {
      if (child.name.endsWith(".md")) {
        names.add(child.name.replace(/\.md$/, ""));
      }
    }

    return names;
  }

  async readNotesForSubject(
    subject: string,
    period?: ExamPeriod
  ): Promise<{ title: string; content: string }[]> {
    const subjectFolder = normalizePath(`${this.basePath}/${sanitizeFilename(subject)}`);
    const folder = this.app.vault.getAbstractFileByPath(subjectFolder);

    if (!(folder instanceof TFolder)) return [];

    const notes: { title: string; content: string }[] = [];
    for (const child of folder.children) {
      if (!child.name.endsWith(".md")) continue;
      const content = await this.app.vault.read(child as any);

      if (period) {
        const tagsMatch = content.match(/^tags:\s*\[([^\]]+)\]/m);
        const tags = tagsMatch
          ? tagsMatch[1].split(",").map((t) => t.trim())
          : [];
        if (!tags.includes(period)) continue;
      }

      notes.push({ title: child.name.replace(/\.md$/, ""), content });
    }

    return notes;
  }

  async saveRawFile(data: ArrayBuffer, path: string): Promise<string> {
    const normalized = normalizePath(path);
    const dir = normalized.substring(0, normalized.lastIndexOf("/"));
    await this.ensureFolder(dir);

    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing) {
      await this.app.vault.modifyBinary(existing as any, data);
    } else {
      await this.app.vault.createBinary(normalized, data);
    }
    return normalized;
  }

  getKnownSubjects(): string[] {
    const baseFolder = this.app.vault.getAbstractFileByPath(
      normalizePath(this.basePath)
    );
    if (!(baseFolder instanceof TFolder)) return [];

    return baseFolder.children
      .filter(
        (child) =>
          child instanceof TFolder &&
          child.name !== "Concepts" &&
          child.name !== "Exam"
      )
      .map((child) => child.name);
  }

  private buildConceptNoteContent(concept: ConceptNote): string {
    const related = concept.relatedConcepts
      .map((c) => `[[${c}]]`)
      .join(", ");
    const lectures = concept.relatedLectures
      .map((l) => `[[${l}]]`)
      .join(", ");

    return [
      "---",
      `tags: [concept]`,
      "---",
      "",
      `# ${concept.name}`,
      "",
      `**정의:** ${concept.definition}`,
      "",
      lectures ? `**관련 강의:** ${lectures}` : "",
      related ? `**관련 개념:** ${related}` : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private appendLectureReference(
    content: string,
    lectureTitle: string
  ): string {
    const ref = `[[${lectureTitle}]]`;
    if (content.includes(ref)) return content;

    const marker = "**관련 강의:**";
    const existingLine = content.match(/^(\*\*관련 강의:\*\*\s*)(.*)$/m);
    if (existingLine) {
      const currentRefs = existingLine[2].trim();
      const nextRefs = currentRefs ? `${currentRefs}, ${ref}` : ref;
      return content.replace(existingLine[0], `${marker} ${nextRefs}`);
    }
    return content + `\n**관련 강의:** ${ref}\n`;
  }

  private mergeManagedNote(currentContent: string, nextContent: string): string {
    const nextParts = this.splitManagedNote(nextContent);
    const currentParts = this.splitManagedNote(currentContent);

    if (currentParts.managed) {
      return [
        nextParts.frontmatter,
        currentParts.before.trim(),
        nextParts.managed,
        currentParts.after.trim(),
      ]
        .filter(Boolean)
        .join("\n\n")
        .trimEnd() + "\n";
    }

    return [
      nextContent.trimEnd(),
      "",
      "## 이전 노트 백업",
      "",
      "> [!note]",
      "> 이 내용은 Alt2Obsidian 관리 구간이 도입되기 전의 기존 노트입니다.",
      "",
      currentContent.trim(),
      "",
    ].join("\n");
  }

  private splitManagedNote(content: string): {
    frontmatter: string;
    before: string;
    managed: string;
    after: string;
  } {
    const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n*/);
    const frontmatter = frontmatterMatch ? frontmatterMatch[0].trimEnd() : "";
    const contentStart = frontmatterMatch ? frontmatterMatch[0].length : 0;
    const start = content.indexOf(MANAGED_NOTE_START);
    const end = content.indexOf(MANAGED_NOTE_END);

    if (start === -1 || end === -1 || end < start) {
      return { frontmatter, before: "", managed: "", after: "" };
    }

    const managedEnd = end + MANAGED_NOTE_END.length;
    return {
      frontmatter,
      before: content.slice(contentStart, start),
      managed: content.slice(start, managedEnd).trimEnd(),
      after: content.slice(managedEnd),
    };
  }
}
