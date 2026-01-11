import { GitHubService, GitTreeNode } from "git";
import { normalizePath, Notice, TFile, TFolder, Vault } from "obsidian";
import { DiffResult, DiffService } from "./diff";
import { SyncPluginSettings } from "./settings";
import { base64ToUtf8 } from "./utils";

import { RestEndpointMethodTypes } from "@octokit/rest";
type GetTreeResponse = RestEndpointMethodTypes["git"]["getTree"]["response"]["data"]

export class SyncService {
    private vault: Vault;
    private githubService: GitHubService;
    private diffService: DiffService;
    private settings: SyncPluginSettings;
    private baseCommitSha: string | null;
    private remoteCommitSha: string | null;
    private diffResult: DiffResult;

    constructor(vault: Vault, githubService: GitHubService, settings: SyncPluginSettings) {
        this.vault = vault;
        this.githubService = githubService;
        this.settings = settings;
    }

    getBaseCommitSha(): string | null {
        return this.baseCommitSha;
    }

    setBaseCommitSha(baseSha: string | null) {
        this.baseCommitSha = baseSha;
    }

    async syncTextChanges(): Promise<Boolean> {
        this.baseCommitSha = this.settings.baseSha;
        this.remoteCommitSha = await this.githubService.getHeadCommitSha();
        console.log("BASE:" + this.baseCommitSha);
        console.log("REMOTE:" + this.remoteCommitSha);
        if (!this.remoteCommitSha) {
            await this.githubService.createInitCommit();
            this.remoteCommitSha = await this.githubService.getHeadCommitSha();
            this.diffResult.pushDelete.push("README.md");
        }

        let baseCommitTree: GetTreeResponse | null = this.baseCommitSha ? await this.githubService.getTree(this.baseCommitSha) : null;
        let remoteHeadCommitTree: GetTreeResponse | null = this.remoteCommitSha ? await this.githubService.getTree(this.remoteCommitSha) : null;

        this.diffService = new DiffService(this.vault, baseCommitTree, remoteHeadCommitTree);
        this.diffResult = await this.diffService.getDiff();
        console.log(this.diffResult);

        const totalConflicts = this.diffResult.conflicts.length
        const totalPullChanges = this.diffResult.pullNew.length + this.diffResult.pullUpdate.length + this.diffResult.pullDelete.length
        const totalPushChanges = this.diffResult.pushNew.length + this.diffResult.pushUpdate.length + this.diffResult.pushDelete.length

        if (totalConflicts + totalPullChanges + totalPushChanges === 0) {
            new Notice("No changes since last sync");
            this.setBaseCommitSha(this.remoteCommitSha);
            return true;
        }

        if (totalConflicts) {
            await this.handleConflict();
            return false;
        }

        let pullStatus: Boolean = true;
        if (totalPullChanges > 0)
            pullStatus = await this.pullChanges();

        if (!pullStatus) {
            new Notice("Sync Aborted: Pull failed");
            return false;
        }

        let pushStatus: Boolean = true;
        if (totalPushChanges > 0)
            pushStatus = await this.pushChanges();

        if (pullStatus && pushStatus) {
            new Notice("Sync: Successful");
            return true;
        }

        new Notice("Sync: Failed");
        return false;
    }

    async handleConflict() {
        new Notice("Sync Aborted: Conflicts detected");

        const fileList = this.diffResult.conflicts.map(p => `- [ ] ${p}`).join("\n");
        const content = `## Conflicts\n\nPlease resolve the following files manually before syncing again:\n\n${fileList}`;

        const conflictFile = this.vault.getAbstractFileByPath("CONFLICTS.md");

        if (conflictFile instanceof TFile)
            await this.vault.modify(conflictFile, content);
        else
            await this.vault.create("CONFLICTS.md", content);

        new Notice("See CONFLICTS.md for more details.");
    }

    async pullChanges(): Promise<Boolean> {
        try {
            const remoteFileContents = await this.fetchRemoteFileContents();
            await this.pullNewObjects(remoteFileContents);
            await this.pullUpdateObjects(remoteFileContents);
            await this.pullDeleteObjects();
            this.setBaseCommitSha(this.remoteCommitSha);
            return true;
        }
        catch (err) {
            console.log(err);
            return false;
        }
    }

    async fetchRemoteFileContents(): Promise<Record<string, string>> {
        const filePaths: string[] = [
            ...this.diffResult.pullNew,
            ...this.diffResult.pullUpdate,
        ];

        if (filePaths.length === 0) {
            return {};
        }

        const filesWithSha = filePaths
            .map(path => ({
                path,
                sha: this.diffService.getFileState(path).remoteSha,
            }))
            .filter((file): file is { path: string; sha: string } => file.sha !== undefined && file.sha !== null);

        const blobEntries = await Promise.all(
            filesWithSha.map(async ({ path, sha }) => {
                const base64Content = await this.githubService.getBlob(sha);
                const utf8Content = base64ToUtf8(base64Content);
                return [path, utf8Content] as const;
            })
        );

        return Object.fromEntries(blobEntries);
    }

    async ensureFolderExists(folderPath: string): Promise<TFolder> {
        const normalized = normalizePath(folderPath);

        const folderExists = this.vault.getAbstractFileByPath(folderPath);
        if (folderExists instanceof TFolder)
            return folderExists;

        const parts = normalized.split("/").filter(Boolean);
        let currentPath = "";
        let currentFolder: TFolder | null = null;

        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            const pathExists = this.vault.getAbstractFileByPath(currentPath);
            if (pathExists instanceof TFolder) {
                currentFolder = pathExists;
                continue;
            }

            currentFolder = await this.vault.createFolder(currentPath);
        }

        return currentFolder!;
    }

    async pullNewObjects(remoteFileContents: Record<string, string>) {
        for (const filePath of this.diffResult.pullNew) {
            const content = remoteFileContents[filePath];
            if (!content) continue;

            const normalizedPath = normalizePath(filePath);
            const parts = normalizedPath.split("/");
            const parentPath = parts.slice(0, -1).join("/");

            if (parentPath) await this.ensureFolderExists(parentPath);
            await this.vault.create(normalizedPath, content);
        }
    }

    async pullUpdateObjects(remoteFileContents: Record<string, string>) {
        for (const filePath of this.diffResult.pullUpdate) {
            const content = remoteFileContents[filePath];
            if (!content) continue;

            const normalizedPath = normalizePath(filePath);
            const file = this.vault.getFileByPath(normalizedPath);
            if (!file) continue;

            await this.vault.modify(file, content);
        }
    }

    async pullDeleteObjects() {
        const filePaths = this.diffResult.pullDelete;
        if (filePaths.length === 0)
            return;

        for (const filePath of filePaths) {
            const normalizedPath = normalizePath(filePath);

            const file = this.vault.getAbstractFileByPath(normalizedPath);
            if (!file)
                continue;

            await this.vault.delete(file);
        }
    }

    async pushChanges(): Promise<Boolean> {
        try {
            const localTreeNodes = await this.getLocalTreeNodes();
            for (const deletedPath of this.diffResult.pushDelete) {
                localTreeNodes.push({
                    path: deletedPath,
                    type: "blob",
                    mode: "100644",
                    sha: null,
                });
            }

            let baseTreeSha: string | null = null;
            if (this.remoteCommitSha) {
                const commit = await this.githubService.getCommit(this.remoteCommitSha);
                baseTreeSha = commit.tree.sha;
            }

            const treeSha = await this.githubService.createTree(localTreeNodes, baseTreeSha);
            const commitSha = await this.githubService.createCommit(
                treeSha,
                this.remoteCommitSha ? this.remoteCommitSha : null,
                this.remoteCommitSha ? "Sync" : "Initial commit"
            );

            if (this.remoteCommitSha)
                await this.githubService.updateRef("heads/" + this.settings.branch, commitSha);
            else
                await this.githubService.createRef("refs/heads/" + this.settings.branch, commitSha);

            this.setBaseCommitSha(commitSha);
            return true;
        }
        catch (err) {
            new Notice("Failed to push changes");
            console.log(err);
            return false;
        }
    }

    async getLocalTreeNodes(): Promise<GitTreeNode[]> {
        const filePathsToPush = [
            ...this.diffResult.pushNew,
            ...this.diffResult.pushUpdate
        ];

        const nodes = await Promise.all(
            filePathsToPush.map(async (filePath) => {
                const file = this.vault.getFileByPath(filePath);
                if (!file) return null;

                try {
                    const state = this.diffService.getFileState(file.path)
                    let content;
                    if (state.content)
                        content = state.content
                    else
                        content = await this.vault.read(file);
                    return {
                        path: file.path,
                        type: "blob",
                        mode: "100644",
                        content: content
                    } as GitTreeNode;
                } catch (e) {
                    console.error(`Failed to read file ${filePath}`, e);
                    return null;
                }
            })
        );

        return nodes.filter((node): node is GitTreeNode => node !== null);
    }
}
