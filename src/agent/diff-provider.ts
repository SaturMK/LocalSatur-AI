import * as vscode from "vscode";

import {
    ToolManager
} from "./tools";

export class LocalForgeDiffProvider
    implements vscode.TextDocumentContentProvider {

    private readonly toolManager: ToolManager;

    private readonly onDidChangeEmitter =
        new vscode.EventEmitter<vscode.Uri>();

    readonly onDidChange =
        this.onDidChangeEmitter.event;

    constructor(
        toolManager: ToolManager
    ) {
        this.toolManager =
            toolManager;
    }

    provideTextDocumentContent(
        uri: vscode.Uri
    ): string {
        const proposalId =
            uri.query;

        const proposal =
            this.toolManager.getProposal(
                proposalId
            );

        if (!proposal) {
            return "// LocalSatur AI edit proposal not found.";
        }

        return proposal.proposedContent;
    }

    dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}


