export interface UpstreamCommit {
    sha: string;
    message: string;
    tree: {
        sha: string;
    };
    parents: Array<{
        sha: string;
    }>;
    author: {
        name: string;
        email: string;
        date: string; // ISO 8601 timestamp
    };
}

export interface UpstreamTreeNode {
    path: string;
    mode: "100644" | "100755" | "040000" | "160000" | "120000" | string;
    type: "blob" | "tree" | "commit";
    sha?: string | null;
    content?: string;
    operation?: "create" | "update" | "delete";
}

export interface UpstreamTree {
    sha: string;
    tree: UpstreamTreeNode[];
}

