import { Plugin } from "obsidian";
import {
  PluginData,
  DEFAULT_PLUGIN_DATA,
  ImportRecord,
  ImportPreview,
  LLMProvider as ILLMProvider,
  ExamPeriod,
  ConceptData,
  ImportUpdateSummary,
} from "./types";
import { AltScraper } from "./scraper/AltScraper";
import { PdfProcessor } from "./pdf/PdfProcessor";
import { createProvider } from "./llm/index";
import { ConceptExtractor } from "./generator/ConceptExtractor";
import { NoteGenerator } from "./generator/NoteGenerator";
import { ExamSummaryGenerator } from "./generator/ExamSummaryGenerator";
import { VaultManager } from "./vault/VaultManager";
import { Alt2ObsidianSettingsTab } from "./ui/SettingsTab";
import {
  Alt2ObsidianSidebarView,
  VIEW_TYPE_SIDEBAR,
} from "./ui/SidebarView";
import { sanitizeFilename, formatDate } from "./utils/helpers";

export default class Alt2ObsidianPlugin extends Plugin {
  data: PluginData = DEFAULT_PLUGIN_DATA;
  vaultManager: VaultManager | null = null;

  private scraper = new AltScraper();
  private pdfProcessor: PdfProcessor | null = null;

  async onload(): Promise<void> {
    await this.loadPluginData();

    // Initialize vault manager
    this.vaultManager = new VaultManager(
      this.app,
      this.data.settings.baseFolderPath
    );

    // Initialize PDF processor with worker path
    const vaultBasePath =
      (this.app.vault.adapter as any).getBasePath?.() || "";
    this.pdfProcessor = new PdfProcessor(this.manifest.dir || "", vaultBasePath);

    // Register sidebar view
    this.registerView(VIEW_TYPE_SIDEBAR, (leaf) => {
      return new Alt2ObsidianSidebarView(leaf, this);
    });

    // Add ribbon icon
    this.addRibbonIcon("book-open", "Alt2Obsidian", () => {
      this.activateSidebarView();
    });

    // Add command
    this.addCommand({
      id: "open-sidebar",
      name: "Open Alt2Obsidian sidebar",
      callback: () => this.activateSidebarView(),
    });

    this.addCommand({
      id: "import-note",
      name: "Import Alt note from URL",
      callback: () => this.activateSidebarView(),
    });

    // Register settings tab
    this.addSettingTab(new Alt2ObsidianSettingsTab(this.app, this));
  }

  onunload(): void {
    // Views are automatically cleaned up by Obsidian
  }

  updateBasePath(): void {
    this.vaultManager?.setBasePath(this.data.settings.baseFolderPath);
  }

  /**
   * Phase 1: Preview — scrape page and defer PDF download until import.
   */
  async previewImport(
    url: string,
    onProgress?: (stage: string, percent: number) => void
  ): Promise<ImportPreview> {
    onProgress?.("Alt 노트 페이지 가져오는 중...", 10);
    const altData = await this.scraper.fetch(url);
    onProgress?.("Alt 노트 파싱 완료", 30);

    // Quick subject detection from title
    const codeMatch = altData.title.match(/([A-Z]{2,}[\s-]?\d{2,})/i);
    const suggestedSubject = codeMatch
      ? codeMatch[1].replace(/\s+/g, "").toUpperCase()
      : altData.title.split(/[\s-_]/)[0];

    onProgress?.("미리보기 준비 완료", 100);

    return {
      altData,
      pdfData: null,
      pdfUrl: altData.pdfUrl,
      suggestedSubject,
    };
  }

  /**
   * Phase 2: Import — process with LLM and save to vault.
   */
  async importNote(
    url: string,
    preview: ImportPreview,
    subjectOverride?: string,
    examPeriod?: ExamPeriod,
    onProgress?: (stage: string, percent: number) => void,
    onConfirmUpdate?: (summary: ImportUpdateSummary) => Promise<boolean>
  ): Promise<ImportRecord> {
    const settings = this.data.settings;
    if (!settings.apiKey) {
      throw new Error("API 키를 설정에서 입력해주세요");
    }

    const llm = createProvider(
      settings.provider,
      settings.apiKey,
      settings.geminiModel,
      settings.rateDelayMs
    );

    const altData = preview.altData;
    const pdfDataPromise = this.downloadPdfForImport(preview);

    // For partial quality, skip LLM processing
    if (altData.parseQuality === "partial") {
      const subject = subjectOverride || "Unknown";
      return this.savePartialNote(
        altData,
        subject,
        url,
        llm,
        pdfDataPromise,
        onProgress,
        onConfirmUpdate
      );
    }

    // Enhance summary with transcript if available
    if (altData.transcript) {
      const transcriptText = altData.transcript.slice(0, 15000);
      const summaryTooShort = !altData.summary || altData.summary.length < 500;
      const summaryAlreadyDetailed = altData.summary.length >= 2500;

      if (summaryTooShort) {
        onProgress?.("트랜스크립트에서 강의 노트 생성 중...", 10);
        const memoContext = altData.summary
          ? `\n\n[학생 메모]\n${altData.summary}`
          : "";

        altData.summary = await llm.generateText(
          `다음은 강의 트랜스크립트입니다. 이 내용을 구조화된 강의 노트로 정리해주세요.

규칙:
- 마크다운 형식으로, ## 섹션 헤더 사용
- 핵심 개념은 **볼드**, 전문 용어는 영어 병기 (예: **파이프라인 해저드(Pipeline Hazard)**)
- 각 섹션에 핵심 포인트를 불릿 리스트로 정리
- 중요 정의는 Obsidian callout 사용:
  > [!definition] 개념명
  > 정의 내용
- 시험 출제 가능 핵심 포인트는:
  > [!important] 핵심 포인트 제목
  > 내용
- 예시, 의사코드, 수식이 있으면:
  > [!example] 예시 제목
  > 내용
${memoContext}

트랜스크립트:
${transcriptText}`,
          {
            systemPrompt: "You are an academic note-taking assistant. Create well-structured, comprehensive lecture notes in Korean with markdown formatting and Obsidian callout blocks.",
            maxOutputTokens: 4096,
          }
        );
      } else if (!summaryAlreadyDetailed) {
        onProgress?.("트랜스크립트로 요약 보강 중...", 10);

        altData.summary = await llm.generateText(
          `다음은 강의 요약본과 실제 강의 트랜스크립트입니다.
요약본을 기반으로 하되, 트랜스크립트에서 빠진 부연설명, 예시, 세부 내용을 추가하여 더 풍부한 강의 노트를 만들어주세요.

규칙:
- 기존 요약본의 구조와 핵심 내용을 유지
- 트랜스크립트에서 추가 설명, 예시, 교수 코멘트 등을 보강
- 마크다운 형식, ## 섹션 헤더 사용
- 핵심 개념을 **볼드**로, 전문 용어는 영어 병기
- 트랜스크립트에만 있는 중요 내용은 새 섹션이나 불릿으로 추가
- 중요 정의는 > [!definition] 개념명 callout으로 표시
- 시험 출제 포인트는 > [!important] callout으로 표시
- 예시/코드는 > [!example] callout으로 표시

[기존 요약본]
${altData.summary}

[강의 트랜스크립트]
${transcriptText}`,
          {
            systemPrompt: "You are an academic note-taking assistant. Enhance lecture summaries with additional details from transcripts.",
            maxOutputTokens: 8192,
          }
        );
      } else {
        onProgress?.("기존 요약이 충분해 보강 호출을 건너뜁니다...", 10);
      }
    }

    onProgress?.("LLM으로 개념 추출 중...", 30);

    // LLM: Extract concepts + detect subject
    const conceptExtractor = new ConceptExtractor(llm);
    const subject = subjectOverride || preview.suggestedSubject;
    const vm = this.vaultManager!;
    const existingConceptNames = await vm.getExistingConceptNames(subject);

    const conceptResult = await conceptExtractor.extract(
      altData.summary,
      subject,
      Array.from(existingConceptNames)
    );
    conceptResult.concepts = this.normalizeConcepts(
      conceptResult.concepts,
      existingConceptNames
    );

    onProgress?.("개념 추출 완료", 50);

    // Generate markdown
    onProgress?.("마크다운 노트 생성 중...", 70);

    const llmResult = {
      processedSummary: altData.summary,
      concepts: conceptResult.concepts,
      tags: examPeriod ? [...conceptResult.tags, examPeriod] : conceptResult.tags,
      subjectSuggestion: subject,
    };

    const noteGenerator = new NoteGenerator(llm);
    const { lectureMarkdown, conceptNotes } = await noteGenerator.generate(
      altData,
      llmResult,
      subject
    );

    // Save everything to vault
    onProgress?.("Vault에 저장 중...", 90);

    const subjectFolder = `${vm.getBasePath()}/${sanitizeFilename(subject)}`;
    const assetsFolder = `${subjectFolder}/assets`;

    const noteFilename = sanitizeFilename(altData.title);
    const notePath = `${subjectFolder}/${noteFilename}.md`;
    const updateSummary = await vm.buildManagedNoteUpdateSummary(
      notePath,
      lectureMarkdown,
      conceptNotes.map((concept) => concept.name)
    );
    if (updateSummary.isUpdate && onConfirmUpdate) {
      const confirmed = await onConfirmUpdate(updateSummary);
      if (!confirmed) throw new Error("업데이트가 취소되었습니다");
      onProgress?.("Vault에 저장 중...", 90);
    }

    const saveResult = await vm.saveManagedNote(lectureMarkdown, notePath);
    await vm.saveConceptNotes(conceptNotes, noteFilename, subject);

    // Save raw PDF to vault for side-by-side view
    let pdfPath: string | undefined;
    const pdfData = await pdfDataPromise;
    if (pdfData) {
      onProgress?.("PDF 저장 중...", 95);
      const pdfFilename = sanitizeFilename(altData.title);
      const rawPdfPath = `${assetsFolder}/${pdfFilename}.pdf`;
      pdfPath = await vm.saveRawFile(pdfData, rawPdfPath);
    }

    onProgress?.("완료!", 100);

    const record: ImportRecord = {
      url,
      title: altData.title,
      subject,
      path: notePath,
      date: formatDate(),
      parseQuality: "full",
      altId: altData.metadata.noteId || undefined,
      examPeriod,
      pdfPath,
      wasUpdate: saveResult.wasUpdate,
      updateSummary,
    };
    record.wasUpdate = this.upsertRecentImport(record) || saveResult.wasUpdate;
    await this.savePluginData();

    return record;
  }

  async generateExamSummary(subject: string, period?: ExamPeriod): Promise<string> {
    const settings = this.data.settings;
    if (!settings.apiKey) {
      throw new Error("API 키를 설정에서 입력해주세요");
    }

    const llm = createProvider(
      settings.provider,
      settings.apiKey,
      settings.geminiModel,
      settings.rateDelayMs
    );

    const generator = new ExamSummaryGenerator(llm, this.vaultManager!);
    return generator.generate(subject, period);
  }

  private async savePartialNote(
    altData: import("./types").AltNoteData,
    subject: string,
    url: string,
    llm: ILLMProvider,
    pdfDataPromise: Promise<ArrayBuffer | null>,
    onProgress?: (stage: string, percent: number) => void,
    onConfirmUpdate?: (summary: ImportUpdateSummary) => Promise<boolean>
  ): Promise<ImportRecord> {
    onProgress?.("부분 노트 생성 중...", 50);

    const noteGenerator = new NoteGenerator(llm);
    const { lectureMarkdown } = await noteGenerator.generate(
      altData,
      {
        processedSummary: altData.summary,
        concepts: [],
        tags: [],
        subjectSuggestion: subject,
      },
      subject
    );

    const vm = this.vaultManager!;
    const subjectFolder = `${vm.getBasePath()}/${sanitizeFilename(subject)}`;
    const noteFilename = sanitizeFilename(altData.title);
    const notePath = `${subjectFolder}/${noteFilename}.md`;
    const updateSummary = await vm.buildManagedNoteUpdateSummary(
      notePath,
      lectureMarkdown,
      []
    );
    if (updateSummary.isUpdate && onConfirmUpdate) {
      const confirmed = await onConfirmUpdate(updateSummary);
      if (!confirmed) throw new Error("업데이트가 취소되었습니다");
      onProgress?.("Vault에 저장 중...", 90);
    }

    const saveResult = await vm.saveManagedNote(lectureMarkdown, notePath);

    let pdfPath: string | undefined;
    const pdfData = await pdfDataPromise;
    if (pdfData) {
      const assetsFolder = `${subjectFolder}/assets`;
      const pdfFilename = sanitizeFilename(altData.title);
      const rawPdfPath = `${assetsFolder}/${pdfFilename}.pdf`;
      pdfPath = await vm.saveRawFile(pdfData, rawPdfPath);
    }

    onProgress?.("완료!", 100);

    const record: ImportRecord = {
      url,
      title: altData.title,
      subject,
      path: notePath,
      date: formatDate(),
      parseQuality: "partial",
      altId: altData.metadata.noteId || undefined,
      pdfPath,
      wasUpdate: saveResult.wasUpdate,
      updateSummary,
    };
    record.wasUpdate = this.upsertRecentImport(record) || saveResult.wasUpdate;
    await this.savePluginData();

    return record;
  }

  private async detectSubject(
    llm: ILLMProvider,
    title: string,
    _summary: string
  ): Promise<string> {
    // First try regex extraction from title (most reliable)
    const codeMatch = title.match(/([A-Z]{2,}[\s-]?\d{2,})/i);
    if (codeMatch) {
      return codeMatch[1].replace(/\s+/g, "").toUpperCase();
    }

    // Fallback to LLM only if no code found
    try {
      const prompt = `Lecture title: "${title}"

Extract the course code (like "CSED311", "MATH230", "CS101") from this title.
If there is no course code, return the first meaningful word or abbreviation from the title.
Rules:
- Return ONLY the course code or short name (1-10 characters)
- No explanation, no quotes, no extra text
- Examples: "CSED311 Lec7-pipeline" → "CSED311", "데이터구조 3강" → "데이터구조"`;

      const result = await llm.generateText(prompt, {
        maxOutputTokens: 20,
      });
      const cleaned = result.trim().replace(/['"*\n]/g, "").slice(0, 20);
      return cleaned || title.split(/[\s-_]/)[0];
    } catch {
      return title.split(/[\s-_]/)[0];
    }
  }

  private normalizeConcepts(
    concepts: ConceptData[],
    existingConceptNames: Set<string>
  ): ConceptData[] {
    const canonicalByKey = new Map<string, string>();
    for (const name of existingConceptNames) {
      canonicalByKey.set(this.normalizeConceptKey(name), name);
    }

    const merged = new Map<string, ConceptData>();
    for (const concept of concepts) {
      const rawName = concept.name.trim();
      if (!rawName) continue;

      const canonicalName =
        canonicalByKey.get(this.normalizeConceptKey(rawName)) || rawName;
      const current = merged.get(canonicalName);
      const next = { ...concept, name: canonicalName };

      if (current) {
        current.relatedConcepts.push(...next.relatedConcepts);
        current.definition = current.definition || next.definition;
        current.example = current.example || next.example;
        current.caution = current.caution || next.caution;
        current.lectureContext = current.lectureContext || next.lectureContext;
      } else {
        merged.set(canonicalName, next);
      }
    }

    const normalized = Array.from(merged.values());
    const allowed = new Set<string>();
    for (const concept of normalized) {
      allowed.add(concept.name.toLowerCase());
      allowed.add(sanitizeFilename(concept.name).toLowerCase());
      allowed.add(this.normalizeConceptKey(concept.name));
    }
    for (const name of existingConceptNames) {
      allowed.add(name.toLowerCase());
      allowed.add(sanitizeFilename(name).toLowerCase());
      allowed.add(this.normalizeConceptKey(name));
    }

    return normalized.map((concept) => ({
      ...concept,
      relatedConcepts: Array.from(new Set(concept.relatedConcepts))
        .map((name) => canonicalByKey.get(this.normalizeConceptKey(name)) || name)
        .filter((name) => {
          const key = this.normalizeConceptKey(name);
          return (
            key !== this.normalizeConceptKey(concept.name) &&
            (allowed.has(name.toLowerCase()) ||
              allowed.has(sanitizeFilename(name).toLowerCase()) ||
              allowed.has(key))
          );
        }),
    }));
  }

  private async downloadPdfForImport(
    preview: ImportPreview
  ): Promise<ArrayBuffer | null> {
    if (preview.pdfData) return preview.pdfData;
    if (!preview.pdfUrl || !this.pdfProcessor) return null;

    try {
      return await this.pdfProcessor.downloadPdf(preview.pdfUrl);
    } catch (e) {
      console.warn("[Alt2Obsidian] PDF download failed:", e);
      return null;
    }
  }

  private normalizeConceptKey(name: string): string {
    return sanitizeFilename(name)
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
  }

  private upsertRecentImport(record: ImportRecord): boolean {
    const existingIndex = this.data.recentImports.findIndex((item) =>
      this.isSameImportRecord(item, record)
    );
    const wasUpdate = existingIndex !== -1;
    const nextRecord = { ...record, wasUpdate };

    if (wasUpdate) {
      this.data.recentImports.splice(existingIndex, 1);
    }

    this.data.recentImports.unshift(nextRecord);

    const seen = new Set<string>();
    this.data.recentImports = this.data.recentImports.filter((item) => {
      const key = item.altId || item.url || item.path;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (this.data.recentImports.length > 50) {
      this.data.recentImports = this.data.recentImports.slice(0, 50);
    }

    return wasUpdate;
  }

  private isSameImportRecord(a: ImportRecord, b: ImportRecord): boolean {
    if (a.altId && b.altId) return a.altId === b.altId;
    if (a.url && b.url) return a.url === b.url;
    return a.path === b.path;
  }

  private async activateSidebarView(): Promise<void> {
    const existing =
      this.app.workspace.getLeavesOfType(VIEW_TYPE_SIDEBAR);

    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE_SIDEBAR,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async loadPluginData(): Promise<void> {
    const saved = await this.loadData();
    this.data = Object.assign({}, DEFAULT_PLUGIN_DATA, saved || {});
    // Merge settings with defaults
    this.data.settings = Object.assign(
      {},
      DEFAULT_PLUGIN_DATA.settings,
      this.data.settings || {}
    );
  }

  async savePluginData(): Promise<void> {
    await this.saveData(this.data);
  }
}
