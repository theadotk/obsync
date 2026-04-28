import { Notice } from "obsidian";
import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { SyncPluginSettings } from "settings";
import { utf8ToBase64 } from "utils/encoding";
import { UpstreamProvider } from "upstream";
import { UpstreamTreeNode, UpstreamTree, UpstreamCommit } from "upstream";

export class GitHubProvider implements UpstreamProvider {
    private octokit: Octokit;
    private settings: SyncPluginSettings;

    constructor(settings: SyncPluginSettings) {
        this.octokit = new Octokit({
            auth: settings.accessToken,
        });
        this.settings = settings;
    }

    updateSettings(settings: SyncPluginSettings) {
        if (settings.accessToken !== this.settings.accessToken) {
            this.octokit = new Octokit({
                auth: settings.accessToken,
            });
        }
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
            content: utf8ToBase64("Initialized"),
            branch: this.settings.branch
        });
    }

    async getCommit(sha: string): Promise<UpstreamCommit> {
        const { data } = await this.octokit.git.getCommit({
            owner: this.settings.owner,
            repo: this.settings.repository,
            commit_sha: sha,
        });

        return data;
    }

    async getTree(commitSha: string): Promise<UpstreamTree> {
        const commit = await this.getCommit(commitSha);

        const { data } = await this.octokit.git.getTree({
            owner: this.settings.owner,
            repo: this.settings.repository,
            tree_sha: commit.tree.sha,
            recursive: "true",
        });

        return {
            sha: data.sha,

            tree: data.tree.map(node => ({
                path: node.path as string,
                mode: node.mode as string,
                type: node.type as "blob" | "tree" | "commit",
                sha: node.sha || null,
            }))
        };
    }

    async getBlob(fileSha: string): Promise<string> {
        const { data } = await this.octokit.git.getBlob({
            owner: this.settings.owner,
            repo: this.settings.repository,
            file_sha: fileSha
        });

        return data.content;
    }

    async createBlob(content: string, encoding: "utf-8" | "base64"): Promise<string> {
        const { data } = await this.octokit.git.createBlob({
            owner: this.settings.owner,
            repo: this.settings.repository,
            content: content,
            encoding: encoding
        });

        return data.sha;
    }

    async createTree(nodes: UpstreamTreeNode[], baseTreeSha: string | null): Promise<string> {
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

        new Notice("Please wait...")

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

