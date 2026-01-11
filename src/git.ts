import { Notice } from "obsidian";

import { SyncPluginSettings } from "./settings";

import { Octokit, RestEndpointMethodTypes } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

type GetCommitResponse = RestEndpointMethodTypes["git"]["getCommit"]["response"]["data"]
type GetTreeResponse = RestEndpointMethodTypes["git"]["getTree"]["response"]["data"]

export type GitTreeNode = {
    path: string;
    mode?: "100644";
    type?: "blob" | "tree";
    sha?: string | null;
    content?: string;
};

export async function computeGitBlobSha(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const header = encoder.encode(`blob ${data.length}\0`);

    const combined = new Uint8Array(header.length + data.length);
    combined.set(header);
    combined.set(data, header.length);

    const hashBuffer = await crypto.subtle.digest('SHA-1', combined);

    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export class GitHubService {
    private octokit: Octokit;
    private settings: SyncPluginSettings;

    constructor(settings: SyncPluginSettings) {
        this.octokit = new Octokit({
            auth: settings.accessToken,
        });
        this.settings = settings;
    }

    async repoExists(): Promise<boolean> {
        try {
            await this.octokit.repos.get({
                owner: this.settings.owner,
                repo: this.settings.repository
            });
            return true;
        }
        catch (err) {
            if (err instanceof RequestError && err.status === 401) {
                new Notice("Requires Authentication. Please check the access token");
                return false;
            }
            else if (err instanceof RequestError && err.status === 404) {
                new Notice("Repository: <" + this.settings.repository + "> does not exist");
                return false;
            }
            throw err;
        }
    }

    async branchExists(): Promise<boolean> {
        try {
            await this.octokit.repos.getBranch({
                owner: this.settings.owner,
                repo: this.settings.repository,
                branch: this.settings.branch
            });
            return true;
        }
        catch (err) {
            if (err instanceof RequestError && err.status === 401) {
                new Notice("Requires Authentication. Please check the access token");
                return false;
            }
            else if (err instanceof RequestError && err.status === 404) {
                new Notice("Branch: <" + this.settings.branch + "> does not exist");
                return false;
            }
            throw err;
        }
    }

    async getHeadCommitSha(): Promise<string | null> {
        try {
            const { data } = await this.octokit.git.getRef({
                headers: {
                    "If-None-Match": ""
                },
                owner: this.settings.owner,
                repo: this.settings.repository,
                ref: "heads/" + this.settings.branch
            });

            return data.object.sha;
        }
        catch (err) {
            return null;
        }
    }

    async createInitCommit(): Promise<void> {
        await this.octokit.repos.createOrUpdateFileContents({
            owner: this.settings.owner,
            repo: this.settings.repository,
            path: "README.md",
            message: "Initial commit",
            content: Buffer.from("Initialized").toString("base64"),
            branch: this.settings.branch
        });
    }


    async getCommit(sha: string): Promise<GetCommitResponse> {
        const { data } = await this.octokit.git.getCommit({
            owner: this.settings.owner,
            repo: this.settings.repository,
            commit_sha: sha,
        });

        return data;
    }

    async getTree(commitSha: string): Promise<GetTreeResponse> {
        const commit = await this.getCommit(commitSha);

        const { data } = await this.octokit.git.getTree({
            owner: this.settings.owner,
            repo: this.settings.repository,
            tree_sha: commit.tree.sha,
            recursive: "true",
        });

        return data;
    }

    async getBlob(fileSha: string): Promise<string> {
        const { data } = await this.octokit.git.getBlob({
            owner: this.settings.owner,
            repo: this.settings.repository,
            file_sha: fileSha
        });

        return data.content;
    }

    async createTree(nodes: GitTreeNode[], baseTreeSha: string | null): Promise<string> {
        const treePayload: any = {
            owner: this.settings.owner,
            repo: this.settings.repository,
            tree: nodes,
        };

        if (baseTreeSha) {
            treePayload.base_tree = baseTreeSha;
        }

        const { data } = await this.octokit.git.createTree(treePayload);
        return data.sha;
    }

    async createCommit(treeSha: string, parentSha: string | null, message: string): Promise<string> {
        const commitPayload: any = {
            owner: this.settings.owner,
            repo: this.settings.repository,
            tree: treeSha,
            message: message,
        };

        if (parentSha) {
            commitPayload.parents = [parentSha];
        }

        const { data } = await this.octokit.git.createCommit(commitPayload);
        return data.sha;
    }

    async createRef(ref: string, sha: string) {
        await this.octokit.git.createRef({
            owner: this.settings.owner,
            repo: this.settings.repository,
            ref: ref,
            sha: sha
        });
    }

    async updateRef(ref: string, sha: string) {
        await this.octokit.git.updateRef({
            owner: this.settings.owner,
            repo: this.settings.repository,
            ref: ref,
            sha: sha,
            force: false
        });

        new Notice("Please wait. Updating GitHub....")

        const startTime = Date.now();
        let delay = 500;
        const maxDelay = 5000;
        const timeout = 60000;

        while (true) {
            if (Date.now() - startTime > timeout) {
                new Notice("Update Failed: Timed out");
                return;
            }

            const currentSha = await this.getHeadCommitSha();
            if (currentSha === sha)
                return;

            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 1.5, maxDelay);
        }
    }
}

