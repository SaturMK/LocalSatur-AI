/**
 * Changed-file tracking for the session (PRD FR-011).
 *
 * Every file the agent touches through an approved proposal is
 * recorded with its operation and time. The list is shown in the
 * webview so the user can see exactly what the agent changed and
 * jump back to those files.
 */

export type ChangedFileOperation =
    | "create"
    | "edit"
    | "delete"
    | "rename";

export interface ChangedFileEntry {
    /** Workspace-relative path of the file before the change. */
    path: string;

    /** For renames: the workspace-relative path after the change. */
    targetPath?: string;

    operation: ChangedFileOperation;

    /** Epoch milliseconds of the change. */
    timestamp: number;
}

export function isChangedFileEntry(
    value: unknown
): value is ChangedFileEntry {
    if (value === null || typeof value !== "object") {
        return false;
    }

    const record = value as Record<string, unknown>;

    if (typeof record.path !== "string" || record.path.trim() === "") {
        return false;
    }

    if (
        record.operation !== "create" &&
        record.operation !== "edit" &&
        record.operation !== "delete" &&
        record.operation !== "rename"
    ) {
        return false;
    }

    if (typeof record.timestamp !== "number" || !Number.isFinite(record.timestamp)) {
        return false;
    }

    return record.targetPath === undefined ||
        typeof record.targetPath === "string";
}

/**
 * Record a change in the session list. A new entry supersedes any
 * existing entry for the same path or the same current key, so
 * repeated edits of one file collapse into the most recent entry
 * and a rename replaces the history of its source path.
 */
export function recordChangedFile(
    list: ChangedFileEntry[],
    entry: ChangedFileEntry,
    maxEntries = 100
): ChangedFileEntry[] {
    const key =
        entry.operation === "rename"
            ? entry.targetPath ?? entry.path
            : entry.path;

    const next = list.filter(candidate => {
        const candidateKey =
            candidate.operation === "rename"
                ? candidate.targetPath ?? candidate.path
                : candidate.path;

        return (
            candidateKey !== key &&
            candidate.path !== key &&
            candidateKey !== entry.path
        );
    });

    next.push(entry);

    if (next.length > maxEntries) {
        next.splice(0, next.length - maxEntries);
    }

    return next;
}
