import { SyncPluginSettings } from "settings";
import { UpstreamCommit, UpstreamTree, UpstreamTreeNode } from "./UpstreamTypes";

export { GitHubProvider } from "./GitHubProvider";
export { GiteaProvider } from "./GiteaProvider";
export { computeGitBlobSha } from "./Compute";
export * from "./UpstreamTypes";

export interface UpstreamProvider {
    updateSettings(settings: SyncPluginSettings): void;
    repoExists(): Promise<boolean>;

    getHeadCommitSha(): Promise<string | null>;
    getCommit(sha: string): Promise<UpstreamCommit>;
    getTree(commitSha: string): Promise<UpstreamTree>;
    getBlob(fileSha: string): Promise<string>;

    createInitCommit(): Promise<void>;
    createBlob(content: string, encoding: "utf-8" | "base64"): Promise<string>;
    createTree(nodes: UpstreamTreeNode[], baseTreeSha: string | null): Promise<string>;
    createCommit(treeSha: string, parentSha: string | null, message: string): Promise<string>;

    createRef(ref: string, sha: string): Promise<void>;
    updateRef(ref: string, sha: string): Promise<void>;
}

