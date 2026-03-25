import { AltNoteData, AltNoteMetadata } from "../types";

const RSC_PUSH_REGEX = /self\.__next_f\.push\(\s*(\[[\s\S]*?\])\s*\)/g;
const SUPABASE_URL_REGEX =
  /https?:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/sign\/[^\s"']+/g;
const OG_TITLE_REGEX =
  /<meta\s+property="og:title"\s+content="([^"]*?)"\s*\/?>/i;
const OG_DESC_REGEX =
  /<meta\s+property="og:description"\s+content="([^"]*?)"\s*\/?>/i;

interface ParseResult {
  summary: string | null;
  pdfUrl: string | null;
  transcript: string | null;
  title: string | null;
  createdAt: string | null;
  noteId: string | null;
}

export class RscParser {
  parseRscPayload(html: string): ParseResult {
    const chunks: string[] = [];
    let match: RegExpExecArray | null;

    const regex = new RegExp(RSC_PUSH_REGEX.source, "g");
    while ((match = regex.exec(html)) !== null) {
      chunks.push(match[1]);
    }

    if (chunks.length === 0) {
      return {
        summary: null,
        pdfUrl: null,
        transcript: null,
        title: null,
        createdAt: null,
        noteId: null,
      };
    }

    // Log instrumentation data
    console.log(
      `[Alt2Obsidian] RSC chunks found: ${chunks.length}, sizes: [${chunks.map((c) => c.length).join(", ")}]`
    );

    let summary: string | null = null;
    let pdfUrl: string | null = null;
    let transcript: string | null = null;
    let title: string | null = null;
    let createdAt: string | null = null;
    let noteId: string | null = null;

    const fullPayload = chunks.join("\n");

    // Extract Supabase PDF URL
    const supabaseMatches = fullPayload.match(SUPABASE_URL_REGEX);
    if (supabaseMatches) {
      for (const url of supabaseMatches) {
        if (url.includes("slides") || url.includes(".pdf")) {
          pdfUrl = this.cleanUrl(url);
          break;
        }
      }
      if (!pdfUrl && supabaseMatches.length > 0) {
        pdfUrl = this.cleanUrl(supabaseMatches[0]);
      }
    }

    // Extract summary: look for long markdown-like strings with ## headers
    const markdownCandidates = this.extractLongStrings(fullPayload);
    for (const candidate of markdownCandidates) {
      if (
        candidate.length > 200 &&
        (candidate.includes("##") || candidate.includes("**"))
      ) {
        if (!summary || candidate.length > summary.length) {
          summary = candidate;
        }
      }
    }

    // Extract title — try multiple patterns (RSC Flight format varies)
    const titlePatterns = [
      /"noteTitle"\s*:\s*"([^"]+)"/,
      /noteTitle[",:\s]+([^"\\]{3,80})/,
      /"title"\s*:\s*"([^"]{3,80})"/,
    ];
    for (const pattern of titlePatterns) {
      const m = fullPayload.match(pattern);
      if (m && m[1] && !m[1].includes("{") && !m[1].includes("<")) {
        title = m[1].trim();
        break;
      }
    }

    // Fallback: extract title from summary's first heading
    if (!title && summary) {
      const headingMatch = summary.match(/^#\s+(.+)$/m);
      if (headingMatch) {
        title = headingMatch[1].trim();
      }
    }

    // Extract createdAt
    const createdMatch = fullPayload.match(/"createdAt"\s*:\s*"([^"]+)"/);
    if (createdMatch) {
      createdAt = createdMatch[1];
    }

    // Extract note ID from token/id field
    const idMatch = fullPayload.match(
      /"token"\s*:\s*"([0-9a-f-]{36})"/
    );
    if (idMatch) {
      noteId = idMatch[1];
    }

    // Extract transcript segments
    const transcriptSegments: string[] = [];
    const textMatches = fullPayload.matchAll(
      /"text"\s*:\s*"([^"]{10,})"/g
    );
    for (const m of textMatches) {
      const text = m[1];
      if (
        !text.includes("http") &&
        !text.includes("{") &&
        text.length < 5000
      ) {
        transcriptSegments.push(text);
      }
    }
    if (transcriptSegments.length > 0) {
      transcript = transcriptSegments.join("\n");
    }

    console.log(
      `[Alt2Obsidian] RSC parse result — title: ${!!title}, summary: ${summary?.length ?? 0} chars, pdfUrl: ${!!pdfUrl}, transcript: ${transcriptSegments.length} segments`
    );

    return { summary, pdfUrl, transcript, title, createdAt, noteId };
  }

  parseMetaTags(html: string): Partial<ParseResult> {
    const titleMatch = html.match(OG_TITLE_REGEX);
    const descMatch = html.match(OG_DESC_REGEX);

    return {
      title: titleMatch ? this.decodeHtmlEntities(titleMatch[1]) : null,
      summary: descMatch ? this.decodeHtmlEntities(descMatch[1]) : null,
      pdfUrl: null,
      transcript: null,
      createdAt: null,
      noteId: null,
    };
  }

  detectFormatVersion(html: string): {
    hasRscPush: boolean;
    nextVersion: string | null;
  } {
    const hasRscPush = html.includes("self.__next_f.push");
    const versionMatch = html.match(/\/_next\/static\/([^/]+)\//);
    return {
      hasRscPush,
      nextVersion: versionMatch ? versionMatch[1] : null,
    };
  }

  private extractLongStrings(payload: string): string[] {
    const results: string[] = [];
    // Match JSON string values that are long
    const stringRegex = /"((?:[^"\\]|\\.){100,})"/g;
    let match: RegExpExecArray | null;
    while ((match = stringRegex.exec(payload)) !== null) {
      try {
        const decoded = JSON.parse(`"${match[1]}"`);
        results.push(decoded);
      } catch {
        results.push(match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'));
      }
    }
    return results.sort((a, b) => b.length - a.length);
  }

  private cleanUrl(url: string): string {
    return url.replace(/\\u0026/g, "&").replace(/\\"/g, "").replace(/"+$/, "");
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
}
