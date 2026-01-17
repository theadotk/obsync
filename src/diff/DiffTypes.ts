export type Path = string;

export type FileSource = "BASE" | "LOCAL" | "REMOTE";

export interface FileState {
    baseSha: string | null;
    localSha: string | null;
    remoteSha: string | null;
    content?: string;
}

export type FileStates = Map<Path, FileState>

export interface DiffResult {
    pullNew: Path[];
    pullUpdate: Path[];
    pullDelete: Path[];

    pushNew: Path[];
    pushUpdate: Path[];
    pushDelete: Path[];

    conflicts: Path[];
}
