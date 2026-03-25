import { App, PluginSettingTab, Setting } from "obsidian";
import type Alt2ObsidianPlugin from "../main";

export class Alt2ObsidianSettingsTab extends PluginSettingTab {
  plugin: Alt2ObsidianPlugin;

  constructor(app: App, plugin: Alt2ObsidianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Alt2Obsidian 설정" });

    new Setting(containerEl)
      .setName("LLM 제공자")
      .setDesc("사용할 LLM 서비스를 선택하세요")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("gemini", "Google Gemini")
          .addOption("openai", "OpenAI (준비 중)")
          .addOption("claude", "Claude (준비 중)")
          .setValue(this.plugin.data.settings.provider)
          .onChange(async (value) => {
            this.plugin.data.settings.provider = value as
              | "gemini"
              | "openai"
              | "claude";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("API 키")
      .setDesc("개인 API 키를 입력하세요. Google AI Studio에서 무료로 발급 가능하며, 무료 등급으로도 충분히 사용할 수 있습니다.")
      .addText((text) =>
        text
          .setPlaceholder("API 키 입력...")
          .setValue(this.plugin.data.settings.apiKey)
          .then((t) => {
            t.inputEl.type = "password";
          })
          .onChange(async (value) => {
            this.plugin.data.settings.apiKey = value;
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("Gemini 모델")
      .setDesc("사용할 Gemini 모델 이름")
      .addText((text) =>
        text
          .setPlaceholder("gemini-2.0-flash")
          .setValue(this.plugin.data.settings.geminiModel)
          .onChange(async (value) => {
            this.plugin.data.settings.geminiModel = value || "gemini-2.0-flash";
            await this.plugin.savePluginData();
          })
      );

    new Setting(containerEl)
      .setName("저장 폴더")
      .setDesc("Vault 내에서 노트가 저장될 기본 폴더")
      .addText((text) =>
        text
          .setPlaceholder("Alt2Obsidian")
          .setValue(this.plugin.data.settings.baseFolderPath)
          .onChange(async (value) => {
            this.plugin.data.settings.baseFolderPath =
              value || "Alt2Obsidian";
            await this.plugin.savePluginData();
            this.plugin.updateBasePath();
          })
      );

    new Setting(containerEl)
      .setName("API 요청 간격 (ms)")
      .setDesc("LLM API 호출 간 대기 시간 (rate limit 방지)")
      .addText((text) =>
        text
          .setPlaceholder("4000")
          .setValue(String(this.plugin.data.settings.rateDelayMs))
          .onChange(async (value) => {
            const num = parseInt(value) || 4000;
            this.plugin.data.settings.rateDelayMs = Math.max(1000, num);
            await this.plugin.savePluginData();
          })
      );
  }
}
