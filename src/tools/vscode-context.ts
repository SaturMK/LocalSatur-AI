import * as vscode from "vscode";
import * as path from "path";

export interface ActiveEditorContext {
    hasEditor: boolean;
    path?: string;
    absolutePath?: string;
    languageId?: string;
    lineCount?: number;
    isDirty?: boolean;
    isUntitled?: boolean;
    selection?: {
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
        text: string;
    };
}

export interface SelectionContext {
    hasSelection: boolean;
    path?: string;
    text?: string;
    startLine?: number;
    startCharacter?: number;
    endLine?: number;
    endCharacter?: number;
}

export interface OpenFileContext {
    path: string;
    absolutePath: string;
    languageId: string;
    isDirty: boolean;
    isUntitled: boolean;
}

export class VSCodeContextTools implements vscode.Disposable {
    private readonly workspaceRoot: string;

    private lastEditor?: vscode.TextEditor;
    private lastSelection?: vscode.Selection;

    private readonly disposables: vscode.Disposable[] = [];

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;

        // Capture whatever editor exists when LocalSatur AI starts.
        this.captureActiveEditor();

        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    this.lastEditor = editor;
                    this.lastSelection = editor.selection;
                }
            })
        );

        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection(event => {
                this.lastEditor = event.textEditor;
                this.lastSelection = event.selections[0];
            })
        );

        this.disposables.push(
            vscode.window.onDidChangeVisibleTextEditors(editors => {
                const editor = this.findBestVisibleEditor(editors);

                if (editor) {
                    this.lastEditor = editor;
                    this.lastSelection = editor.selection;
                }
            })
        );

        this.disposables.push(
            vscode.workspace.onDidCloseTextDocument(document => {
                if (
                    this.lastEditor &&
                    this.lastEditor.document === document
                ) {
                    this.lastEditor = undefined;
                    this.lastSelection = undefined;
                }
            })
        );
    }

    /**
     * Capture the current active editor if one exists.
     */
    private captureActiveEditor(): void {
        const editor = vscode.window.activeTextEditor;

        if (editor) {
            this.lastEditor = editor;
            this.lastSelection = editor.selection;
            return;
        }

        const visible = this.findBestVisibleEditor(
            vscode.window.visibleTextEditors
        );

        if (visible) {
            this.lastEditor = visible;
            this.lastSelection = visible.selection;
        }
    }

    /**
     * Find the best editor from a collection of visible editors.
     */
    private findBestVisibleEditor(
        editors: readonly vscode.TextEditor[]
    ): vscode.TextEditor | undefined {
        if (editors.length === 0) {
            return undefined;
        }

        // Prefer a document belonging to the workspace.
        const workspaceEditor = editors.find(editor =>
            !editor.document.isUntitled &&
            editor.document.uri.scheme === "file" &&
            this.isInsideWorkspace(editor.document.uri.fsPath)
        );

        if (workspaceEditor) {
            return workspaceEditor;
        }

        // Otherwise return the first visible text editor.
        return editors[0];
    }

    /**
     * Determine whether a path belongs to the LocalSatur AI workspace.
     */
    private isInsideWorkspace(filePath: string): boolean {
        const root = path.resolve(this.workspaceRoot);
        const target = path.resolve(filePath);

        return (
            target === root ||
            target.startsWith(root + path.sep)
        );
    }

    /**
     * Find an editor even when the LocalSatur AI Webview currently has focus.
     */
    private getBestEditor(): vscode.TextEditor | undefined {
        // 1. Normal active editor.
        const activeEditor = vscode.window.activeTextEditor;

        if (activeEditor) {
            this.lastEditor = activeEditor;
            this.lastSelection = activeEditor.selection;
            return activeEditor;
        }

        // 2. Visible source editors.
        const visibleEditor = this.findBestVisibleEditor(
            vscode.window.visibleTextEditors
        );

        if (visibleEditor) {
            this.lastEditor = visibleEditor;
            this.lastSelection = visibleEditor.selection;
            return visibleEditor;
        }

        // 3. Cached editor.
        if (this.lastEditor) {
            const document = this.lastEditor.document;

            if (
                document.isUntitled ||
                document.uri.scheme !== "file" ||
                this.isInsideWorkspace(document.uri.fsPath)
            ) {
                return this.lastEditor;
            }
        }

        // 4. Look through open text documents.
        const openDocument = vscode.workspace.textDocuments.find(
            document =>
                !document.isClosed &&
                document.uri.scheme === "file" &&
                this.isInsideWorkspace(document.uri.fsPath)
        );

        if (openDocument) {
            try {
                return vscode.window.visibleTextEditors.find(
                    editor => editor.document === openDocument
                );
            } catch {
                // Ignore and continue.
            }
        }

        // 5. Inspect tabs in the active tab group.
        const activeGroup = vscode.window.tabGroups.activeTabGroup;

        for (const tab of activeGroup.tabs) {
            if (tab.input instanceof vscode.TabInputText) {
                const uri = tab.input.uri;

                if (
                    uri.scheme === "file" &&
                    this.isInsideWorkspace(uri.fsPath)
                ) {
                    const editor = vscode.window.visibleTextEditors.find(
                        candidate =>
                            candidate.document.uri.toString() ===
                            uri.toString()
                    );

                    if (editor) {
                        this.lastEditor = editor;
                        this.lastSelection = editor.selection;
                        return editor;
                    }

                    const document =
                        vscode.workspace.textDocuments.find(
                            candidate =>
                                candidate.uri.toString() ===
                                uri.toString()
                        );

                    if (document) {
                        return vscode.window.visibleTextEditors.find(
                            candidate =>
                                candidate.document === document
                        );
                    }
                }
            }
        }

        return undefined;
    }

    /**
     * Get the current/best available editor.
     */
    getActiveEditor(): ActiveEditorContext {
        const editor = this.getBestEditor();

        if (!editor) {
            return {
                hasEditor: false
            };
        }

        const document = editor.document;
        const selection = editor.selection;

        const relativePath = document.isUntitled
            ? document.uri.toString()
            : path.relative(
                this.workspaceRoot,
                document.uri.fsPath
            );

        return {
            hasEditor: true,
            path: relativePath || document.uri.fsPath,
            absolutePath: document.isUntitled
                ? undefined
                : document.uri.fsPath,
            languageId: document.languageId,
            lineCount: document.lineCount,
            isDirty: document.isDirty,
            isUntitled: document.isUntitled,
            selection: {
                startLine: selection.start.line + 1,
                startCharacter: selection.start.character,
                endLine: selection.end.line + 1,
                endCharacter: selection.end.character,
                text: document.getText(selection)
            }
        };
    }

    /**
     * Get selected text from the best available editor.
     */
    getSelection(): SelectionContext {
        const editor = this.getBestEditor();

        if (!editor) {
            return {
                hasSelection: false
            };
        }

        const selection =
            this.lastSelection ?? editor.selection;

        const text =
            editor.document.getText(selection);

        return {
            hasSelection: !selection.isEmpty,
            path: editor.document.isUntitled
                ? editor.document.uri.toString()
                : path.relative(
                    this.workspaceRoot,
                    editor.document.uri.fsPath
                ),
            text,
            startLine: selection.start.line + 1,
            startCharacter: selection.start.character,
            endLine: selection.end.line + 1,
            endCharacter: selection.end.character
        };
    }

    /**
     * Get files currently visible/open in VS Code.
     */
    getOpenFiles(): OpenFileContext[] {
        const files = new Map<string, OpenFileContext>();

        // Visible editors.
        for (const editor of vscode.window.visibleTextEditors) {
            const document = editor.document;

            if (document.uri.scheme !== "file") {
                continue;
            }

            files.set(document.uri.fsPath, {
                path: path.relative(
                    this.workspaceRoot,
                    document.uri.fsPath
                ),
                absolutePath: document.uri.fsPath,
                languageId: document.languageId,
                isDirty: document.isDirty,
                isUntitled: document.isUntitled
            });
        }

        // Open documents.
        for (const document of vscode.workspace.textDocuments) {
            if (document.uri.scheme !== "file") {
                continue;
            }

            if (!this.isInsideWorkspace(document.uri.fsPath)) {
                continue;
            }

            if (!files.has(document.uri.fsPath)) {
                files.set(document.uri.fsPath, {
                    path: path.relative(
                        this.workspaceRoot,
                        document.uri.fsPath
                    ),
                    absolutePath: document.uri.fsPath,
                    languageId: document.languageId,
                    isDirty: document.isDirty,
                    isUntitled: document.isUntitled
                });
            }
        }

        return Array.from(files.values());
    }

    /**
     * Open a file in VS Code.
     */
    async openFile(filePath: string): Promise<ActiveEditorContext> {
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(this.workspaceRoot, filePath);

        const document =
            await vscode.workspace.openTextDocument(
                vscode.Uri.file(absolutePath)
            );

        const editor =
            await vscode.window.showTextDocument(
                document,
                {
                    preview: false
                }
            );

        this.lastEditor = editor;
        this.lastSelection = editor.selection;

        return this.getActiveEditor();
    }

    /**
     * Reveal a specific line in the current editor.
     */
    async revealLine(line: number): Promise<boolean> {
        const editor = this.getBestEditor();

        if (!editor) {
            return false;
        }

        const zeroBasedLine =
            Math.max(0, line - 1);

        const position =
            new vscode.Position(
                zeroBasedLine,
                0
            );

        editor.selection =
            new vscode.Selection(
                position,
                position
            );

        editor.revealRange(
            new vscode.Range(
                position,
                position
            ),
            vscode.TextEditorRevealType.InCenter
            );

        return true;
    }

    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }

        this.disposables.length = 0;
    }
}

