import { DiffResult, FileStates } from "./DiffTypes";

export class DiffService {
    async getDiff(fileStates: FileStates): Promise<DiffResult> {
        const result: DiffResult = {
            pullNew: [],
            pullUpdate: [],
            pullDelete: [],
            pushNew: [],
            pushUpdate: [],
            pushDelete: [],
            conflicts: [],
        };

        for (let [filePath, fileState] of fileStates) {
            const baseSha = fileState.baseSha ?? null;
            const localSha = fileState.localSha ?? null;
            const remoteSha = fileState.remoteSha ?? null;

            if (baseSha === null) {
                if (localSha !== null && remoteSha !== null && localSha === remoteSha) // Already synced
                    continue;

                if (localSha !== null && remoteSha !== null && localSha !== remoteSha) {
                    result.conflicts.push(filePath);
                    continue;
                }

                if (localSha === null && remoteSha !== null) {
                    result.pullNew.push(filePath);
                    continue;
                }

                if (localSha !== null && remoteSha == null) {
                    result.pushNew.push(filePath);
                    continue;
                }
            }

            if (localSha === baseSha && remoteSha === baseSha) // Already Synced
                continue;

            if (remoteSha !== localSha && localSha !== baseSha && remoteSha !== baseSha) {
                result.conflicts.push(filePath);
                continue;
            }

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
        }

        return result;
    }
}
