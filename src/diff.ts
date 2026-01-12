import { computeGitBlobSha } from "git";
import { Vault, arrayBufferToBase64 } from "obsidian";

import { RestEndpointMethodTypes } from "@octokit/rest";
import { TEXT_EXTENSIONS } from "./constants";
type GetTreeResponse = RestEndpointMethodTypes["git"]["getTree"]["response"]["data"];

type Path = string;

type FileSource = "BASE" | "LOCAL" | "REMOTE";
type FileState = {
    baseSha: string | null;
    localSha: string | null;
    remoteSha: string | null;
    content?: string;
}

type FileStates = Map<Path, FileState>

export interface DiffResult {
    pullNew: Path[];
    pullUpdate: Path[];
    pullDelete: Path[];

    pushNew: Path[];
    pushUpdate: Path[];
    pushDelete: Path[];

    conflicts: Path[];
}

export class DiffService {
    private vault: Vault;

    private baseCommitTree: GetTreeResponse | null;
    private remoteHeadCommitTree: GetTreeResponse | null;

    private fileStates: FileStates;

    constructor(vault: Vault, baseCommitTree: GetTreeResponse | null, headCommitTree: GetTreeResponse | null) {
        this.vault = vault;
        this.baseCommitTree = baseCommitTree;
        this.remoteHeadCommitTree = headCommitTree;
        this.fileStates = new Map();
    }

    getFileState(path: Path): FileState {
        let state = this.fileStates.get(path);
        if (!state) {
            state = { baseSha: null, localSha: null, remoteSha: null };
            this.fileStates.set(path, state);
        }
        return state;
    }

    setFileState(path: Path, source: FileSource, sha: string, content?: string) {
        const state: FileState = this.getFileState(path);

        switch (source) {
            case "BASE":
                state.baseSha = sha;
                break;
            case "LOCAL":
                state.localSha = sha;
                if (content) state.content = content;
                break;
            case "REMOTE":
                state.remoteSha = sha;
                break;
        }

        this.fileStates.set(path, state)
    }

    async buildStateMaps() {
        await this.buildLocalStateMap();
        this.buildBaseStateMap();
        this.buildRemoteStateMap();
    }

    async buildLocalStateMap() {
        const localFiles = this.vault.getFiles();

        await Promise.all(
            localFiles.map(async (file) => {
                const lastDot = file.path.lastIndexOf('.');
                const ext = lastDot !== -1 ? file.path.slice(lastDot + 1).toLowerCase() : "";
                const isText = TEXT_EXTENSIONS.has(ext);

                if (isText) {
                    const content = await this.vault.read(file);
                    const sha = await computeGitBlobSha(content);
                    this.setFileState(file.path, "LOCAL", sha, content);
                }
                else {
                    const arrayBuffer = await this.vault.readBinary(file);
                    const sha = await computeGitBlobSha(arrayBuffer);
                    const base64content = arrayBufferToBase64(arrayBuffer);
                    this.setFileState(file.path, "LOCAL", sha, base64content);
                }
            })
        );
    }

    buildBaseStateMap() {
        if (!this.baseCommitTree)
            return;
        for (const node of this.baseCommitTree.tree)
            if (node.type === "blob")
                this.setFileState(node.path, "BASE", node.sha);
    }

    buildRemoteStateMap() {
        if (!this.remoteHeadCommitTree)
            return;
        for (const node of this.remoteHeadCommitTree.tree)
            if (node.type === "blob")
                this.setFileState(node.path, "REMOTE", node.sha);
    }

    async getDiff(): Promise<DiffResult> {
        await this.buildStateMaps();

        const result: DiffResult = {
            pullNew: [],
            pullUpdate: [],
            pullDelete: [],
            pushNew: [],
            pushUpdate: [],
            pushDelete: [],
            conflicts: [],
        };

        for (let [filePath, fileState] of this.fileStates) {
            const baseSha = fileState.baseSha ?? null;
            const localSha = fileState.localSha ?? null;
            const remoteSha = fileState.remoteSha ?? null;

            if (baseSha === null) {
                if (localSha === null && remoteSha !== null) {
                    result.pullNew.push(filePath);
                    continue;
                }

                if (localSha !== null && remoteSha == null) {
                    result.pushNew.push(filePath);
                    continue;
                }

                if (localSha !== null && remoteSha !== null && localSha !== remoteSha) {
                    result.conflicts.push(filePath);
                    continue;
                }
            }

            if (localSha === baseSha && remoteSha === baseSha) // Already Synced
                continue;

            if (localSha === baseSha && remoteSha !== localSha && remoteSha !== null) {
                result.pullUpdate.push(filePath);
                continue;
            }

            if (remoteSha === baseSha && remoteSha !== localSha && localSha !== null) {
                result.pushUpdate.push(filePath);
                continue;
            }

            if (localSha === baseSha && remoteSha === null) {
                result.pullDelete.push(filePath);
                continue;
            }

            if (remoteSha === baseSha && localSha === null) {
                result.pushDelete.push(filePath);
                continue;
            }

            if (remoteSha !== localSha && localSha !== baseSha && remoteSha !== baseSha) {
                result.conflicts.push(filePath);
                continue;
            }
        }

        return result;
    }
}
