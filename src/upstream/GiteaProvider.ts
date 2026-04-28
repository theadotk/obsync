import { Notice, requestUrl } from "obsidian";
import { SyncPluginSettings } from "settings";
import { utf8ToBase64 } from "utils/encoding";
import { UpstreamProvider } from "upstream";
import { UpstreamTreeNode, UpstreamTree, UpstreamCommit } from "upstream";

export class GiteaProvider implements UpstreamProvider {
    private settings: SyncPluginSettings;

    constructor(settings: SyncPluginSettings) {
        this.settings = settings;
    }

    updateSettings(settings: SyncPluginSettings) {
        this.settings = settings;
    }

    private get repo() {
        return `/repos/${this.settings.owner}/${this.settings.repository}`;
    }

    private async request(endpoint: string, options: RequestInit = {}, silent = false): Promise<any> {
        const base = (this.settings.url?.trim() ?? "https://gitea.com").replace(/\/$/, "");
        const response = await requestUrl({
            url: `${base}/api/v1${endpoint}`,
            method: (options.method as string) ?? "GET",
            headers: {
                "Authorization": `token ${this.settings.accessToken}`,
                "Content-Type": "application/json",
                ...(options.headers as Record<string, string>)
            },
            body: options.body as string | undefined,
            throw: false
        });

        if (response.status >= 400) {
            if (!silent) {
                if (response.status === 401) new Notice("Gitea authentication failed. Check your access token.");
                else if (response.status === 404) new Notice(`Gitea repository <${this.settings.repository}> not found.`);
            }
            throw new Error(`Gitea API Error (${response.status}): ${response.text}`);
        }

        return response.status !== 204 ? response.json : undefined;
    }

    private async retry<T>(fn: () => Promise<T | null>, retries = 5, delay = 200): Promise<T | null> {
        for (let i = 0; i < retries; i++) {
            const result = await fn();
            if (result !== null) return result;
            await new Promise(r => setTimeout(r, delay));
            delay *= 2;
        }
        return null;
    }

    async repoExists(): Promise<boolean> {
        return this.request(this.repo, {}, true).then(() => true).catch(() => false);
    }

    private async createRepo(): Promise<void> {
        const login = await this.request("/user", {}, true).then(r => r?.login).catch(() => null);
        const endpoint = login === this.settings.owner ? "/user/repos" : `/orgs/${this.settings.owner}/repos`;
        await this.request(endpoint, {
            method: "POST",
            body: JSON.stringify({ name: this.settings.repository, private: true, auto_init: false })
        });
    }

    async getHeadCommitSha(): Promise<string | null> {
        try {
            const refs = await this.request(
                `${this.repo}/git/refs/heads/${this.settings.branch}`,
                { headers: { "If-None-Match": "" } },
                true
            );
            return Array.isArray(refs) && refs.length > 0 ? refs[0].object.sha : null;
        } catch {
            return null;
        }
    }

    async createInitCommit(): Promise<void> {
        if (!(await this.repoExists())) await this.createRepo();

        await this.request(`${this.repo}/contents`, {
            method: "POST",
            body: JSON.stringify({
                branch: this.settings.branch,
                message: "Initial commit",
                files: [{ operation: "create", path: "README.md", content: utf8ToBase64("Initialized via Obsidian Sync") }]
            })
        });

        const sha = await this.retry(() => this.getHeadCommitSha());
        if (!sha) throw new Error("Gitea: branch head not confirmed after init.");
    }

    async getCommit(sha: string): Promise<UpstreamCommit> {
        // A fake staging SHA means a previous push completed but the caller
        // stored the local cache key instead of the real Gitea SHA.
        // Resolve it to the actual HEAD before hitting the API.
        if (sha.startsWith("commit_")) {
            const realSha = await this.getHeadCommitSha();
            if (!realSha) throw new Error("Gitea: could not resolve HEAD to replace stale staging SHA.");
            sha = realSha;
        }

        const r = await this.request(`${this.repo}/git/commits/${sha}?stat=false`);
        return {
            sha: r.sha,
            message: r.commit.message,
            tree: { sha: r.commit.tree.sha },
            parents: r.parents.map((p: any) => ({ sha: p.sha })),
            author: { name: r.commit.author.name, email: r.commit.author.email, date: r.commit.author.date }
        };
    }

    private async fetchAllTreeNodes(treeSha: string): Promise<any[]> {
        const nodes: any[] = [];
        let page = 1, truncated = true;
        while (truncated) {
            const res = await this.request(`${this.repo}/git/trees/${treeSha}?recursive=true&per_page=1000&page=${page++}`);
            nodes.push(...res.tree);
            truncated = res.truncated ?? false;
        }
        return nodes;
    }

    async getTree(commitSha: string): Promise<UpstreamTree> {
        const commit = await this.getCommit(commitSha);
        const nodes = await this.fetchAllTreeNodes(commit.tree.sha);
        return {
            sha: commit.tree.sha,
            tree: nodes.map((n: any) => ({
                path: n.path as string,
                mode: n.mode as string,
                type: n.type as "blob" | "tree" | "commit",
                sha: n.sha ?? null
            }))
        };
    }

    async getBlob(fileSha: string): Promise<string> {
        return this.request(`${this.repo}/git/blobs/${fileSha}`).then(r => r.content).catch(() => "");
    }

    private pendingBlobs = new Map<string, string>();
    private pendingTrees = new Map<string, UpstreamTreeNode[]>();
    private pendingCommits = new Map<string, { treeSha: string; message: string }>();

    async createBlob(content: string, encoding: "utf-8" | "base64"): Promise<string> {
        const sha = `blob_${Date.now()}_${Math.random().toString(36).slice(7)}`;
        this.pendingBlobs.set(sha, encoding === "utf-8" ? utf8ToBase64(content) : content);
        return sha;
    }

    async createTree(nodes: UpstreamTreeNode[], _baseTreeSha: string | null): Promise<string> {
        const sha = `tree_${Date.now()}_${Math.random().toString(36).slice(7)}`;
        this.pendingTrees.set(sha, nodes);
        return sha;
    }

    async createCommit(treeSha: string, _parentSha: string | null, message: string): Promise<string> {
        const sha = `commit_${Date.now()}_${Math.random().toString(36).slice(7)}`;
        this.pendingCommits.set(sha, { treeSha, message });
        return sha;
    }

    async updateRef(_ref: string, sha: string): Promise<void> {
        const commit = this.pendingCommits.get(sha);
        const nodes = commit && this.pendingTrees.get(commit.treeSha);
        if (!commit || !nodes) throw new Error("Gitea: missing commit or tree in pending cache.");

        const files = nodes.map(node => {
            if (node.operation === "delete") return { operation: "delete", path: node.path };

            const content = node.content !== undefined
                ? utf8ToBase64(node.content)
                : this.pendingBlobs.get(node.sha!);

            if (!content) throw new Error(`Gitea: missing content for ${node.path}`);
            return { operation: node.operation ?? "update", path: node.path, content };
        });

        await this.request(`${this.repo}/contents`, {
            method: "POST",
            body: JSON.stringify({ branch: this.settings.branch, message: commit.message, files })
        });

        this.pendingBlobs.clear();
        this.pendingTrees.clear();
        this.pendingCommits.clear();
    }

    async createRef(ref: string, sha: string): Promise<void> {
        await this.updateRef(ref, sha);
    }
}

