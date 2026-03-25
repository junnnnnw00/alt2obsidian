import { requestUrl } from "obsidian";
import { SlideImage } from "../types";
import { dataUrlToArrayBuffer } from "../utils/helpers";

// pdf.js types
declare const pdfjsLib: {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: { data: ArrayBuffer }): {
    promise: Promise<PDFDocument>;
  };
};

interface PDFDocument {
  numPages: number;
  getPage(pageNum: number): Promise<PDFPage>;
}

interface PDFPage {
  getViewport(params: { scale: number }): {
    width: number;
    height: number;
  };
  render(params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
}

export class PdfProcessor {
  private workerSrc: string;

  constructor(pluginDir: string, vaultBasePath: string) {
    this.workerSrc = `${vaultBasePath}/${pluginDir}/pdf.worker.min.mjs`;
  }

  initWorker(): void {
    if (typeof pdfjsLib !== "undefined") {
      pdfjsLib.GlobalWorkerOptions.workerSrc = this.workerSrc;
    }
  }

  async downloadPdf(pdfUrl: string): Promise<ArrayBuffer> {
    try {
      const response = await requestUrl({
        url: pdfUrl,
        method: "GET",
      });
      return response.arrayBuffer;
    } catch (e) {
      throw new Error(
        "PDF 다운로드에 실패했습니다. 서명된 URL이 만료되었을 수 있습니다."
      );
    }
  }

  /**
   * Render small thumbnails of all pages (for slide selection UI).
   * Returns data URLs (base64 PNG) at low resolution.
   */
  async renderThumbnails(
    pdfData: ArrayBuffer,
    onProgress?: (page: number, total: number) => void
  ): Promise<string[]> {
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const thumbnails: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const scale = 0.4; // Small thumbnails
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      await page.render({ canvasContext: ctx, viewport }).promise;
      thumbnails.push(canvas.toDataURL("image/png"));

      onProgress?.(i, pdf.numPages);

      if (i % 10 === 0 && i < pdf.numPages) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }

    return thumbnails;
  }

  /**
   * Render only selected pages at full resolution.
   */
  async renderSelectedPages(
    pdfData: ArrayBuffer,
    selectedIndices: number[], // 0-based
    titleSlug: string,
    onProgress?: (page: number, total: number) => void
  ): Promise<SlideImage[]> {
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const images: SlideImage[] = [];
    const total = selectedIndices.length;

    for (let idx = 0; idx < total; idx++) {
      const pageNum = selectedIndices[idx] + 1; // 1-based
      if (pageNum < 1 || pageNum > pdf.numPages) continue;

      const page = await pdf.getPage(pageNum);
      const scale = 2.0;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const dataUrl = canvas.toDataURL("image/png");
      const arrayBuffer = dataUrlToArrayBuffer(dataUrl);

      const pageStr = String(pageNum).padStart(2, "0");
      images.push({
        pageNum,
        data: arrayBuffer,
        filename: `${titleSlug}_slide_${pageStr}.png`,
      });

      onProgress?.(idx + 1, total);

      if ((idx + 1) % 10 === 0 && idx + 1 < total) {
        await new Promise<void>((r) => setTimeout(r, 0));
      }
    }

    return images;
  }

  async renderPages(
    pdfData: ArrayBuffer,
    titleSlug: string,
    onProgress?: (page: number, total: number) => void
  ): Promise<SlideImage[]> {
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const images: SlideImage[] = [];
    const batchSize = 10;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const scale = 2.0; // 2x for readability
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error(`Canvas context 생성 실패 (page ${i})`);
      }

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise;

      // Convert canvas to ArrayBuffer via dataURL (synchronous, reliable in Electron)
      const dataUrl = canvas.toDataURL("image/png");
      const arrayBuffer = dataUrlToArrayBuffer(dataUrl);

      const pageStr = String(i).padStart(2, "0");
      images.push({
        pageNum: i,
        data: arrayBuffer,
        filename: `${titleSlug}_slide_${pageStr}.png`,
      });

      onProgress?.(i, pdf.numPages);

      // Yield to UI thread every batch
      if (i % batchSize === 0 && i < pdf.numPages) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    return images;
  }
}
