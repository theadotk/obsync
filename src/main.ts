import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, SyncPluginSettings, SyncSettingTab } from "./settings";
import { GitHubService } from './git';
import { SyncService } from './sync';

export default class SyncPlugin extends Plugin {
    settings: SyncPluginSettings;
    githubService: GitHubService;
    syncService: SyncService;

    async onload() {
        await this.loadSettings();
        this.githubService = new GitHubService(this.settings);
        this.syncService = new SyncService(this.app.vault, this.githubService, this.settings);

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
    }

    async sync() {
        this.syncService.setBaseCommitSha(this.settings.baseSha)
        new Notice('Syncing...');
        const status = await this.syncService.syncTextChanges();
        if (status) {
            this.settings.baseSha = this.syncService.getBaseCommitSha();
            await this.saveData(this.settings)
        }
    }
}
