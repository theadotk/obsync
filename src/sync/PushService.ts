import { Notice, Vault, TFile, arrayBufferToBase64 } from "obsidian";
import { UpstreamTreeNode, UpstreamProvider } from "upstream";
import { DiffResult, FileStates } from "diff";
import { isTextFile } from "utils/io";

export class PushService {
    private vault: Vault;
    private upstreamProvider: UpstreamProvider;

    constructor(vault: Vault, upstreamProvider: UpstreamProvider) {
        this.vault = vault;
        this.upstreamProvider = upstreamProvider;
    }

    async pushChanges(diffResult: DiffResult, fileStates: FileStates, remoteCommitSha: string | null, branchName: string): Promise<string | null> {
        try {
            new Notice("Pushing Changes...");

            const localTreeNodes = await this.createTreeNodes(diffResult, fileStates);

            for (const deletedPath of diffResult.pushDelete) {
                localTreeNodes.push({
                    path: deletedPath,
                    type: "blob",
                    mode: "100644",
                    sha: null,
                    operation: "delete"
                });
            }

            let remoteTreeSha: string | null = null;
            if (remoteCommitSha) {
                const commit = await this.upstreamProvider.getCommit(remoteCommitSha);
                remoteTreeSha = commit.tree.sha;
            }

            const newTreeSha = await this.upstreamProvider.createTree(localTreeNodes, remoteTreeSha);
            const commitSha = await this.upstreamProvider.createCommit(newTreeSha, remoteCommitSha, "Sync");

            if (remoteCommitSha)
                await this.upstreamProvider.updateRef("heads/" + branchName, commitSha);
            else
                await this.upstreamProvider.createRef("refs/heads/" + branchName, commitSha);

            return await this.upstreamProvider.getHeadCommitSha();
        }
        catch (err) {
            console.error("Failed to push changes", err);
            return null;
        }
    }

    private async createTreeNodes(diffResult: DiffResult, fileStates: FileStates): Promise<UpstreamTreeNode[]> {
        const promises: Promise<UpstreamTreeNode | null>[] = [];

        for (const filePath of diffResult.pushNew) {
            promises.push(this.createTreeNode(filePath, fileStates, "create"));
        }

        for (const filePath of diffResult.pushUpdate) {
            promises.push(this.createTreeNode(filePath, fileStates, "update"));
        }

        const nodes = await Promise.all(promises);
        return nodes.filter((node): node is UpstreamTreeNode => node !== null);
    }

    private async createTreeNode(filePath: string, fileStates: FileStates, operation: "create" | "update"): Promise<UpstreamTreeNode | null> {
        const content = await this.getFileContent(filePath, fileStates);
        if (content === undefined) return null;

        if (isTextFile(filePath)) {
            return {
                path: filePath,
                type: "blob",
                mode: "100644",
                content,
                operation
            };
        }

        const sha = await this.upstreamProvider.createBlob(content, "base64");
        return {
            path: filePath,
            type: "blob",
            mode: "100644",
            sha,
            operation
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

