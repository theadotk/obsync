import { Vault, TFile } from "obsidian";
import { DiffResult } from "diff";

export class ConflictService {
    async handleConflict(diffResult: DiffResult, vault: Vault) {
        const fileList = diffResult.conflicts.map(p => `- [ ] ${p}`).join("\n");
        const content = `## Conflicts\n\nPlease resolve the following files manually before syncing again:\n\n${fileList}`;

        const conflictFile = vault.getAbstractFileByPath("CONFLICTS.md");

        if (conflictFile instanceof TFile)
            await vault.modify(conflictFile, content);
        else
            await vault.create("CONFLICTS.md", content);
    }
}
