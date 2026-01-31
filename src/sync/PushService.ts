import { Notice, Vault, TFile, arrayBufferToBase64 } from "obsidian";
import { GitTreeNode, GitHubService } from "github";
import { DiffResult, FileStates } from "diff";
import { isTextFile } from "./utils";

export class PushService {
    private vault: Vault;
    private githubService: GitHubService;

    constructor(vault: Vault, githubService: GitHubService) {
        this.vault = vault;
        this.githubService = githubService;
    }

    async pushChanges(diffResult: DiffResult, fileStates: FileStates, remoteCommitSha: string | null, branchName: string): Promise<string | null> {
        try {
            new Notice("Pushing Changes...")
            const localTreeNodes = await this.createTreeNodes(diffResult, fileStates);

            for (const deletedPath of diffResult.pushDelete) {
                localTreeNodes.push({
                    path: deletedPath,
                    type: "blob",
                    mode: "100644",
                    sha: null,
                });
            }

            let remoteTreeSha: string | null = null;
            if (remoteCommitSha) {
                const commit = await this.githubService.getCommit(remoteCommitSha);
                remoteTreeSha = commit.tree.sha;
            }

            const newTreeSha = await this.githubService.createTree(localTreeNodes, remoteTreeSha);
            const commitSha = await this.githubService.createCommit(
                newTreeSha,
                remoteCommitSha,
                "Sync"
            );

            if (remoteCommitSha)
                await this.githubService.updateRef("heads/" + branchName, commitSha);
            else
                await this.githubService.createRef("refs/heads/" + branchName, commitSha);

            return commitSha;
        }
        catch (err) {
            return null;
        }
    }

    private async createTreeNodes(diffResult: DiffResult, fileStates: FileStates): Promise<GitTreeNode[]> {
        const filePaths = [...diffResult.pushNew, ...diffResult.pushUpdate];

        const nodes = await Promise.all(
            filePaths.map(filePath => this.createTreeNode(filePath, fileStates))
        );

        return nodes.filter((node): node is GitTreeNode => node !== null);
    }

    private async createTreeNode(filePath: string, fileStates: FileStates): Promise<GitTreeNode | null> {
        const content = await this.getFileContent(filePath, fileStates);
        if (content === undefined) return null;

        if (isTextFile(filePath)) {
            return {
                path: filePath,
                type: "blob",
                mode: "100644",
                content
            };
        }

        const sha = await this.githubService.createBlob(content, "base64");
        return {
            path: filePath,
            type: "blob",
            mode: "100644",
            sha
        };
    }

    private async getFileContent(filePath: string, fileStates: FileStates): Promise<string | undefined> {
        const cachedContent = fileStates.get(filePath)?.content;
        if (cachedContent !== undefined) return cachedContent;

        const file = this.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return undefined;

        if (isTextFile(filePath)) {
            return this.vault.read(file);
        }

        return arrayBufferToBase64(await this.vault.readBinary(file));
    }
}
