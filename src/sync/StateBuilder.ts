import { arrayBufferToBase64, TFile, Vault } from "obsidian";
import { computeGitBlobSha, GitHubService } from "github";
import { Path, FileSource, FileState, FileStates } from "diff";
import { TEXT_EXTENSIONS } from "utils/constants";

import { RestEndpointMethodTypes } from "@octokit/rest";
type GetTreeResponse = RestEndpointMethodTypes["git"]["getTree"]["response"]["data"];

export class StateBuilder {
    private vault: Vault;
    private githubService: GitHubService;

    constructor(vault: Vault, githubService: GitHubService) {
        this.vault = vault;
        this.githubService = githubService;
    }

    async build(baseCommitSha: string | null, remoteCommitSha: string | null): Promise<FileStates> {
        const fileStates: FileStates = new Map();

        const [baseCommitTree, remoteCommitTree] = await Promise.all([
            baseCommitSha ? this.githubService.getTree(baseCommitSha) : null,
            remoteCommitSha ? this.githubService.getTree(remoteCommitSha) : null
        ]);

        await this.buildLocalStateMap(fileStates);
        this.buildTreeStateMap(fileStates, baseCommitTree, "BASE");
        this.buildTreeStateMap(fileStates, remoteCommitTree, "REMOTE");

        return fileStates;
    }

    private getOrCreateFileState(fileStates: FileStates, path: Path): FileState {
        let state = fileStates.get(path);
        if (!state) {
            state = { baseSha: null, localSha: null, remoteSha: null };
            fileStates.set(path, state);
        }
        return state;
    }

    private setFileState(fileStates: FileStates, path: Path, source: FileSource, sha: string, content?: string) {
        const state = this.getOrCreateFileState(fileStates, path);

        if (source === "BASE") {
            state.baseSha = sha;
        } else if (source === "REMOTE") {
            state.remoteSha = sha;
        } else if (source === "LOCAL") {
            state.localSha = sha;
            if (content) state.content = content;
        }
    }

    private async buildLocalStateMap(fileStates: FileStates) {
        const localFiles = this.vault.getFiles();
        await Promise.all(
            localFiles.map((file) => this.processLocalFile(fileStates, file))
        );
    }

    private async processLocalFile(fileStates: FileStates, file: TFile) {
        const lastDot = file.path.lastIndexOf('.');
        const ext = lastDot !== -1 ? file.path.slice(lastDot + 1).toLowerCase() : "";
        const isText = TEXT_EXTENSIONS.has(ext);

        let sha: string;
        let content: string;

        if (isText) {
            content = await this.vault.read(file);
            sha = await computeGitBlobSha(content);
        } else {
            const arrayBuffer = await this.vault.readBinary(file);
            sha = await computeGitBlobSha(arrayBuffer);
            content = arrayBufferToBase64(arrayBuffer);
        }

        this.setFileState(fileStates, file.path, "LOCAL", sha, content);
    }

    private buildTreeStateMap(fileStates: FileStates, treeResponse: GetTreeResponse | null, source: "BASE" | "REMOTE") {
        if (!treeResponse) return;
        for (const node of treeResponse.tree)
            if (node.type === "blob" && node.path && node.sha)
                this.setFileState(fileStates, node.path, source, node.sha);
    }
}
