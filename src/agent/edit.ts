export type FileEditOperation =
    | "write"
    | "delete"
    | "rename";

export interface FileEditProposal {
    id: string;
    path: string;
    originalContent: string;
    proposedContent: string;
    reason: string;
    operation?: FileEditOperation;
    targetPath?: string;
}
