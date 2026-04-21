import { requestUrl } from "obsidian";

export class PdfProcessor {
  constructor(_pluginDir: string, _vaultBasePath: string) {}

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
}
