export interface FileEditProposal {
    id: string;
    path: string;
    originalContent: string;
    proposedContent: string;
    reason: string;
}