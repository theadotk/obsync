import { App, PluginSettingTab, Setting } from "obsidian";
import SyncPlugin from "./main";

export interface SyncPluginSettings {
    owner: string;
    repository: string;
    branch: string;
    accessToken: string;
    baseSha: string | null;
}

export const DEFAULT_SETTINGS: SyncPluginSettings = {
    owner: 'username',
    repository: 'repo',
    branch: 'main',
    accessToken: 'github_pat_XXXXX',
    baseSha: null
}

export class SyncSettingTab extends PluginSettingTab {
    plugin: SyncPlugin;

    constructor(app: App, plugin: SyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        let tokenInput: HTMLInputElement;

        new Setting(containerEl)
            .setName('Owner')
            .setDesc('Repository owner of GitHub')
            .addText(text => {
                text.setValue(this.plugin.settings.owner);
                text.onChange(async (value) => {
                    if (value !== this.plugin.settings.owner) {
                        console.debug("Owner Updated: Resetting baseSha");
                        this.plugin.settings.baseSha = null;
                    }
                    this.plugin.settings.owner = value.trim();
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Repository')
            .setDesc('The GitHub repository name')
            .addText(text => {
                text.setValue(this.plugin.settings.repository);
                text.onChange(async (value) => {
                    if (value !== this.plugin.settings.repository) {
                        console.debug("Repository Updated: Resetting baseSha");
                        this.plugin.settings.baseSha = null;
                    }
                    this.plugin.settings.repository = value.trim();
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('Branch')
            .addText(text => {
                text.setValue(this.plugin.settings.branch);
                text.onChange(async (value) => {
                    if (value !== this.plugin.settings.branch) {
                        console.debug("Branch Updated: Resetting baseSha");
                        this.plugin.settings.baseSha = null;
                    }
                    this.plugin.settings.branch = value.trim();
                    await this.plugin.saveSettings();
                });
            });

        new Setting(containerEl)
            .setName('GitHub Access Token')
            .setDesc('Used for connecting with your GitHub')
            .addText(text => {
                text.inputEl.type = 'password';
                text.setPlaceholder('Enter your token here');
                text.setValue(this.plugin.settings.accessToken);
                tokenInput = text.inputEl
                text.onChange(async (value) => {
                    this.plugin.settings.accessToken = value.trim();
                    await this.plugin.saveSettings();
                });
            }).addExtraButton(btn => {
                btn.setIcon('eye');
                btn.setTooltip('Show/Hide token')
                btn.onClick(() => {
                    if (!tokenInput) return;
                    tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
                })
            });

    }
}
