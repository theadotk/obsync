import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, SyncPluginSettings, SyncSettingTab } from "./settings";
import { SyncResult, SyncService } from 'sync';

export default class SyncPlugin extends Plugin {
    settings: SyncPluginSettings;
    syncService: SyncService;

    async onload() {
        await this.loadSettings();
        this.syncService = new SyncService(this.app.vault, this.settings);

        this.addRibbonIcon('github', 'Sync with GitHub',
            async (evt: MouseEvent) => {
                await this.sync();
            }
        );

        this.addCommand({
            id: 'sync',
            name: 'Sync with GitHub',
            callback: async () => {
                await this.sync();
            }
        });

        this.addSettingTab(new SyncSettingTab(this.app, this));
    }

    onunload() {
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<SyncPluginSettings>);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.syncService.updateSettings(this.settings);
    }

    async sync() {
        new Notice('Syncing...');
        const syncResult: SyncResult = await this.syncService.syncChanges(this.settings.baseSha, this.settings.branch);
        for (const message of syncResult.messages)
            new Notice(message);
        if (syncResult.status) {
            this.settings.baseSha = syncResult.baseSha;
            await this.saveData(this.settings)
        }
    }
}
