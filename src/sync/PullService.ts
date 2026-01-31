import { Vault, normalizePath, TFolder, base64ToArrayBuffer, Notice } from "obsidian";
import { GitHubService } from "github";
import { DiffResult, FileStates, Path } from "diff";
import { base64ToUtf8 } from "utils/encoding";
import { isTextFile } from "./utils";

export class PullService {
    private vault: Vault;
    private githubService: GitHubService;

    constructor(vault: Vault, githubService: GitHubService) {
        this.vault = vault;
        this.githubService = githubService;
    }

    async pullChanges(diffResult: DiffResult, fileStates: FileStates): Promise<boolean> {
        try {
            new Notice("Pulling Changes...")
            const remoteFiles = await this.fetchRemoteFiles(diffResult, fileStates);

            await this.pullNewObjects(diffResult.pullNew, remoteFiles);
            await this.pullUpdateObjects(diffResult.pullUpdate, remoteFiles);
            await this.pullDeleteObjects(diffResult.pullDelete);

            return true;
        }
        catch (err) {
            return false;
        }
    }

    private async getRemoteFileBlob(path: Path, sha: string) {
        const base64Content = await this.githubService.getBlob(sha);

        if (isTextFile(path)) {
            const utf8Content = base64ToUtf8(base64Content);
            return [path, utf8Content] as const;
        }

        return [path, base64Content] as const;
    }

    private async fetchRemoteFiles(diffResult: DiffResult, fileStates: FileStates): Promise<Record<string, string>> {
        const filePaths = [...diffResult.pullNew, ...diffResult.pullUpdate];

        if (filePaths.length === 0) return {};

        const filesToFetch = filePaths
            .map(path => ({
                path,
                sha: fileStates?.get(path)?.remoteSha ?? null
            }))
            .filter((f): f is { path: string; sha: string } => !!f.sha);

        const blobEntries = await Promise.all(
            filesToFetch.map(async ({ path, sha }) => this.getRemoteFileBlob(path, sha))
        );

        return Object.fromEntries(blobEntries);
    }

    private async pullNewObjects(paths: string[], remoteFiles: Record<string, string>) {
        for (const filePath of paths) {
            const content = remoteFiles[filePath];
            if (content === undefined) continue;

            const normalizedPath = normalizePath(filePath);
            const parentPath = normalizedPath.split("/").slice(0, -1).join("/");

            if (parentPath) await this.ensureFolderExists(parentPath);

            if (isTextFile(filePath)) {
                await this.vault.create(normalizedPath, content);
            } else {
                const binaryData = base64ToArrayBuffer(content);
                await this.vault.createBinary(normalizedPath, binaryData);
            }
        }
    }

    private async pullUpdateObjects(paths: string[], remoteFiles: Record<string, string>) {
        for (const filePath of paths) {
            const content = remoteFiles[filePath];
            if (content === undefined) continue;

            const normalizedPath = normalizePath(filePath);
            const file = this.vault.getFileByPath(normalizedPath);
            if (!file) continue;

            if (isTextFile(filePath)) {
                await this.vault.modify(file, content);
            } else {
                const binaryData = base64ToArrayBuffer(content);
                await this.vault.modifyBinary(file, binaryData);
            }
        }
    }

    private async pullDeleteObjects(paths: string[]) {
        for (const filePath of paths) {
            const file = this.vault.getAbstractFileByPath(normalizePath(filePath));
            if (file) await this.vault.delete(file);
        }
    }

    private async ensureFolderExists(folderPath: string): Promise<TFolder> {
        const normalized = normalizePath(folderPath);
        const existing = this.vault.getAbstractFileByPath(normalized);
        if (existing instanceof TFolder) return existing;

        return await this.vault.createFolder(normalized);
    }
}
