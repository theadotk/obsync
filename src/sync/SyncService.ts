import { Vault } from "obsidian";
import { SyncPluginSettings } from "settings";
import { GitHubService } from "github";
import { DiffResult, DiffService, FileStates } from "diff";
import { StateBuilder } from "./StateBuilder";
import { SyncResult } from "./SyncTypes";
import { ConflictService } from "./ConflictService";
import { PullService } from "./PullService";
import { PushService } from "./PushService";

export class SyncService {
    private vault: Vault;
    private githubService: GitHubService;

    constructor(vault: Vault, settings: SyncPluginSettings) {
        this.vault = vault;
        this.githubService = new GitHubService(settings);
    }

    async syncChanges(baseCommitSha: string | null, branchName: string): Promise<SyncResult> {
        let remoteCommitSha = await this.githubService.getHeadCommitSha();

        let diffResult: DiffResult = {
            pullNew: [],
            pullUpdate: [],
            pullDelete: [],
            pushNew: [],
            pushUpdate: [],
            pushDelete: [],
            conflicts: [],
        };

        const syncResult: SyncResult = {
            status: false,
            messages: [],
            baseSha: baseCommitSha ?? "",
        }

        let initialCommit = false;
        if (!remoteCommitSha) {
            await this.githubService.createInitCommit();
            remoteCommitSha = await this.githubService.getHeadCommitSha();
            initialCommit = true;
        }

        const stateBuilder = new StateBuilder(this.vault, this.githubService);
        const fileStates: FileStates = await stateBuilder.build(baseCommitSha, remoteCommitSha);

        const diffService = new DiffService();
        diffResult = await diffService.getDiff(fileStates);
        if (initialCommit)
            diffResult.pushDelete.push("README.md");
        console.log("Diff Result:", diffResult);

        const totalConflicts = diffResult.conflicts.length
        const totalPullChanges = diffResult.pullNew.length + diffResult.pullUpdate.length + diffResult.pullDelete.length
        const totalPushChanges = diffResult.pushNew.length + diffResult.pushUpdate.length + diffResult.pushDelete.length

        if (totalConflicts + totalPullChanges + totalPushChanges === 0) {
            syncResult.status = true;
            if (!baseCommitSha)
                syncResult.baseSha = remoteCommitSha
            syncResult.messages.push("No changes since last sync");
            return syncResult;
        }

        if (totalConflicts) {
            const conflictService = new ConflictService();
            conflictService.handleConflict(diffResult, this.vault);
            syncResult.status = false;
            syncResult.messages.push("Sync Aborted: Conflicts detected");
            syncResult.messages.push("Please check CONFLICTS.md for more info");
            return syncResult;
        }

        let pullStatus = true;
        if (totalPullChanges > 0) {
            const pullService = new PullService(this.vault, this.githubService);
            pullStatus = await pullService.pullChanges(diffResult, fileStates);
        }

        if (!pullStatus) {
            syncResult.status = false;
            syncResult.messages.push("Sync Aborted: Pull failed");
            return syncResult;
        }

        let latestCommitSha: string | null = remoteCommitSha;
        let pushStatus = true;

        if (totalPushChanges > 0) {
            const pushService = new PushService(this.vault, this.githubService);
            const newCommitSha = await pushService.pushChanges(diffResult, fileStates, remoteCommitSha, branchName);

            if (newCommitSha)
                latestCommitSha = newCommitSha;
            else
                pushStatus = false;
        }

        if (!pushStatus) {
            syncResult.status = false;
            syncResult.messages.push("Sync Aborted: Push failed");
            return syncResult;
        }

        syncResult.status = true;
        syncResult.messages.push("Sync: Successful");
        syncResult.baseSha = latestCommitSha;

        return syncResult;
    }

    updateSettings(settings: SyncPluginSettings) {
        this.githubService.updateSettings(settings);
    }
}
