export interface GitTreeNode {
    path: string;
    mode: "100644";
    type: "blob" | "tree";
    sha?: string | null;
    content?: string;
};
