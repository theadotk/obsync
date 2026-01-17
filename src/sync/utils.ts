import { TEXT_EXTENSIONS } from "utils/constants";

export function isTextFile(normalizedPath: string): boolean {
    const lastDot = normalizedPath.lastIndexOf('.');
    const ext = lastDot !== -1 ? normalizedPath.slice(lastDot + 1).toLowerCase() : "";

    return TEXT_EXTENSIONS.has(ext);
}

