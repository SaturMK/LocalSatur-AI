import * as path from "path";
import * as vscode from "vscode";

import { ChatMessage, OllamaClient } from "./ollama/client";
import { WorkspaceTools } from "./tools/workspace";
import { VSCodeContextTools } from "./tools/vscode-context";
import { ToolManager } from "./agent/tools";
import { AgentEngine } from "./agent/engine";
import { LocalForgeDiffProvider } from "./agent/diff-provider";
import { AIProviderManager } from "./providers/manager";

interface ChatAttachment {
    name: string;
    type: string;
    size: number;
    content: string;
}

const MAX_ATTACHMENT_SIZE =
    1024 * 1024;

const MAX_TOTAL_ATTACHMENT_SIZE =
    5 * 1024 * 1024;

function buildAttachmentContext(
    content: string,
    rawAttachments: unknown
): string {
    if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) {
        return content;
    }

    const attachments =
        rawAttachments as ChatAttachment[];

    let totalSize = 0;

    const blocks = attachments.map(
        attachment => {
            if (!attachment || typeof attachment !== "object") {
                throw new Error(
                    "Invalid attachment data."
                );
            }

            if (
                typeof attachment.name !== "string" ||
                typeof attachment.content !== "string" ||
                typeof attachment.size !== "number"
            ) {
                throw new Error(
                    "Invalid attachment data."
                );
            }

            if (attachment.size > MAX_ATTACHMENT_SIZE) {
                throw new Error(
                    `Attachment "${attachment.name}" is too large. ` +
                    `The maximum size is 1 MB per file.`
                );
            }

            totalSize += attachment.size;

            if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE) {
                throw new Error(
                    "The total attachment size is too large. " +
                    "The maximum is 5 MB per message."
                );
            }

            return [
                `--- ${attachment.name} ---`,
                attachment.type
                    ? `Type: ${attachment.type}`
                    : "",
                attachment.content,
                `--- End ${attachment.name} ---`
            ]
                .filter(Boolean)
                .join("\n");
        }
    );

    return [
        content,
        "",
        "Attached files:",
        ...blocks
    ]
        .filter((value, index) =>
            index === 0 || value !== ""
        )
        .join("\n\n");
}

export function activate(
    context: vscode.ExtensionContext
): void {
    console.log("LocalSatur AI activating...");

    // =========================================================
    // WORKSPACE
    // =========================================================

    const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
        context.extensionPath;

    const workspaceTools =
        new WorkspaceTools(
            workspaceRoot
        );

    // =========================================================
    // VS CODE EDITOR CONTEXT
    // =========================================================

    const vscodeContext =
        new VSCodeContextTools(
            workspaceRoot
        );

    // =========================================================
    // OLLAMA
    // =========================================================

    const ollama =
        new OllamaClient();

    // =========================================================
    // AI PROVIDERS
    // =========================================================

    const providerManager =
        new AIProviderManager();

    // =========================================================
    // TOOL MANAGER
    // =========================================================

    const toolManager =
        new ToolManager(
            workspaceTools,
            vscodeContext
        );

    // =========================================================
    // AGENT ENGINE
    // =========================================================

    const agent =
        new AgentEngine(
            ollama,
            toolManager
        );

    // =========================================================
    // LOCALSATUR AI SECONDARY SIDEBAR VIEW
    // =========================================================

    const chatViewProvider =
        new LocalForgeChatViewProvider(
            context,
            agent,
            toolManager,
            workspaceTools,
            ollama,
            providerManager
        );

    const chatViewRegistration =
        vscode.window.registerWebviewViewProvider(
            "localforge.chatView",
            chatViewProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden:
                        true
                }
            }
        );

    context.subscriptions.push(
        chatViewRegistration
    );

    // =========================================================
    // DIFF PROVIDER
    // =========================================================

    const diffProvider =
        new LocalForgeDiffProvider(
            toolManager
        );

    const diffProviderRegistration =
        vscode.workspace.registerTextDocumentContentProvider(
            "localforge-preview",
            diffProvider
        );

    context.subscriptions.push(
        diffProviderRegistration
    );

    // =========================================================
    // EMPTY DIFF PROVIDER
    // =========================================================
    //
    // Used when LocalSatur AI proposes creating a new file.
    //

    const emptyDiffProvider =
        vscode.workspace.registerTextDocumentContentProvider(
            "localforge-preview-empty",
            {
                provideTextDocumentContent(): string {
                    return "";
                }
            }
        );

    context.subscriptions.push(
        emptyDiffProvider
    );

    // =========================================================
    // HELLO WORLD
    // =========================================================

    const helloWorld =
        vscode.commands.registerCommand(
            "localforge.helloWorld",
            () => {
                vscode.window.showInformationMessage(
                    "LocalSatur AI is running."
                );
            }
        );

    context.subscriptions.push(
        helloWorld
    );

    // =========================================================
    // TEST OLLAMA
    // =========================================================

    const testOllama =
        vscode.commands.registerCommand(
            "localforge.testOllama",
            async () => {
                try {
                    const available =
                        await ollama.isAvailable();

                    if (!available) {
                        vscode.window.showErrorMessage(
                            "LocalSatur AI: Ollama is not available at http://localhost:11434."
                        );

                        return;
                    }

                    const models =
                        await ollama.getModels();

                    if (
                        models.length ===
                        0
                    ) {
                        vscode.window.showWarningMessage(
                            "LocalSatur AI: Ollama is running, but no models are installed."
                        );

                        return;
                    }

                    const modelNames =
                        models
                            .map(
                                model =>
                                    model.name
                            )
                            .join(", ");

                    vscode.window.showInformationMessage(
                        `LocalSatur AI: Ollama is available. Models: ${modelNames}`
                    );
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : String(error);

                    vscode.window.showErrorMessage(
                        `LocalSatur AI Ollama test failed: ${message}`
                    );
                }
            }
        );

    context.subscriptions.push(
        testOllama
    );

    // =========================================================
    // INSPECT WORKSPACE
    // =========================================================

    const inspectWorkspace =
        vscode.commands.registerCommand(
            "localforge.inspectWorkspace",
            async () => {
                try {
                    const result =
                        await toolManager.execute(
                            "analyze_project",
                            {}
                        );

                    const document =
                        await vscode.workspace
                            .openTextDocument({
                                content:
                                    result,
                                language:
                                    "json"
                            });

                    await vscode.window
                        .showTextDocument(
                            document,
                            {
                                preview:
                                    false
                            }
                        );
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : String(error);

                    vscode.window.showErrorMessage(
                        `LocalSatur AI workspace inspection failed: ${message}`
                    );
                }
            }
        );

    context.subscriptions.push(
        inspectWorkspace
    );

    // =========================================================
    // DEBUG EDITOR
    // =========================================================

    const debugEditor =
        vscode.commands.registerCommand(
            "localforge.debugEditor",
            () => {
                // IMPORTANT:
                // Do not rely only on vscode.window.activeTextEditor.
                // The LocalSatur AI Webview can have focus while a source
                // editor remains visible. VSCodeContextTools contains
                // the fallback logic for that situation.
                const editorContext =
                    vscodeContext.getActiveEditor();

                console.log(
                    "LocalSatur AI DEBUG: editor context",
                    editorContext
                );

                if (!editorContext.hasEditor) {
                    const activeEditor =
                        vscode.window.activeTextEditor;

                    const visibleEditors =
                        vscode.window.visibleTextEditors;

                    const openDocuments =
                        vscode.workspace.textDocuments;

                    const activeGroup =
                        vscode.window.tabGroups.activeTabGroup;

                    const allGroups =
                        vscode.window.tabGroups.all;

                    const diagnostic = [
                        "LocalSatur AI editor diagnostic:",
                        "",
                        "No editor was resolved.",
                        "",
                        `activeTextEditor: ${
                            activeEditor
                                ? "available"
                                : "undefined"
                        }`,
                        `visibleTextEditors: ${
                            visibleEditors.length
                        }`,
                        `workspace.textDocuments: ${
                            openDocuments.length
                        }`,
                        `activeGroup.tabs: ${
                            activeGroup.tabs.length
                        }`,
                        `tabGroups: ${
                            allGroups.length
                        }`,
                        `workspaceRoot: ${
                            workspaceRoot
                        }`,
                        "",
                        "Visible editors:",
                        ...visibleEditors.map(
                            (editor, index) => {
                                const document =
                                    editor.document;

                                return [
                                    `  [${index}]`,
                                    `uri: ${document.uri.toString()}`,
                                    `scheme: ${document.uri.scheme}`,
                                    `language: ${document.languageId}`,
                                    `untitled: ${document.isUntitled}`
                                ].join(" | ");
                            }
                        ),
                        "",
                        "Open workspace documents:",
                        ...openDocuments
                            .filter(document =>
                                document.uri.scheme ===
                                    "file" &&
                                document.uri.fsPath.startsWith(
                                    workspaceRoot
                                )
                            )
                            .map(document =>
                                `  ${document.uri.fsPath}`
                            )
                    ].join("\n");

                    console.log(diagnostic);

                    vscode.window.showWarningMessage(
                        diagnostic,
                        {
                            modal: true
                        }
                    );

                    return;
                }

                const selection =
                    editorContext.selection;

                const diagnostic = [
                    "LocalSatur AI editor diagnostic:",
                    "",
                    `File: ${
                        editorContext.path ?? "N/A"
                    }`,
                    `Absolute path: ${
                        editorContext.absolutePath ?? "N/A"
                    }`,
                    `Language: ${
                        editorContext.languageId ?? "N/A"
                    }`,
                    `Lines: ${
                        editorContext.lineCount ?? "N/A"
                    }`,
                    `Dirty: ${
                        editorContext.isDirty ?? false
                    }`,
                    `Untitled: ${
                        editorContext.isUntitled ?? false
                    }`,
                    selection
                        ? `Selection: ${
                              selection.startLine
                          }:${selection.startCharacter} -> ${
                              selection.endLine
                          }:${selection.endCharacter}`
                        : "Selection: N/A",
                    selection
                        ? `Selected text length: ${
                              selection.text.length
                          }`
                        : "Selected text length: 0"
                ].join("\n");

                console.log(diagnostic);

                vscode.window.showInformationMessage(
                    diagnostic,
                    {
                        modal: true
                    }
                );
            }
        );

    context.subscriptions.push(
        debugEditor
    );

    // =========================================================
    // OPEN CHAT
    // =========================================================

    const openChat =
        vscode.commands.registerCommand(
            "localforge.openChat",
            async () => {
                try {
                    /*
                     * LocalSatur AI is now hosted in the Secondary Side Bar.
                     *
                     * The previous implementation used:
                     *
                     *   workbench.action.focusView
                     *
                     * with the Webview View id. That command is not
                     * available for this purpose in the current VS Code
                     * workbench, which caused the runtime error:
                     *
                     *   command 'workbench.action.focusView' not found
                     *
                     * Focus the Secondary Side Bar instead. VS Code will
                     * keep the currently active view there, which is the
                     * LocalSatur AI view when the LocalSatur AI container is open.
                     */
                    await vscode.commands.executeCommand(
                        "workbench.action.focusAuxiliaryBar"
                    );
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : String(error);

                    vscode.window.showErrorMessage(
                        `LocalSatur AI could not open the chat view: ${message}`
                    );
                }
            }
        );

    context.subscriptions.push(
        openChat
    );

    // =========================================================
    // APPLY EDIT COMMAND
    // =========================================================

    const applyEdit =
        vscode.commands.registerCommand(
            "localforge.applyEdit",
            async (
                proposalId?: string
            ) => {
                if (
                    typeof proposalId !==
                    "string"
                ) {
                    vscode.window.showErrorMessage(
                        "LocalSatur AI: No edit proposal was supplied."
                    );

                    return;
                }

                const proposal =
                    toolManager.getProposal(
                        proposalId
                    );

                if (!proposal) {
                    vscode.window.showErrorMessage(
                        "LocalSatur AI: Edit proposal not found or expired."
                    );

                    return;
                }

                try {
                    const confirmation =
                        await vscode.window.showWarningMessage(
                            `Apply LocalSatur AI edit to ${proposal.path}?`,
                            {
                                modal: true
                            },
                            "Apply Edit"
                        );

                    if (
                        confirmation !==
                        "Apply Edit"
                    ) {
                        return;
                    }

                    await toolManager.applyProposal(
                        proposalId
                    );

                    const absolutePath =
                        workspaceTools.getAbsolutePath(
                            proposal.path
                        );

                    const document =
                        await vscode.workspace.openTextDocument(
                            vscode.Uri.file(
                                absolutePath
                            )
                        );

                    await vscode.window.showTextDocument(
                        document,
                        {
                            preview:
                                false
                        }
                    );

                    vscode.window.showInformationMessage(
                        `LocalSatur AI applied the edit to ${proposal.path}.`
                    );
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : String(error);

                    vscode.window.showErrorMessage(
                        `LocalSatur AI could not apply the edit: ${message}`
                    );
                }
            }
        );

    context.subscriptions.push(
        applyEdit
    );

    // =========================================================
    // REJECT EDIT COMMAND
    // =========================================================

    const rejectEdit =
        vscode.commands.registerCommand(
            "localforge.rejectEdit",
            (
                proposalId?: string
            ) => {
                if (
                    typeof proposalId !==
                    "string"
                ) {
                    vscode.window.showErrorMessage(
                        "LocalSatur AI: No edit proposal was supplied."
                    );

                    return;
                }

                const proposal =
                    toolManager.getProposal(
                        proposalId
                    );

                if (!proposal) {
                    vscode.window.showWarningMessage(
                        "LocalSatur AI: Edit proposal not found or already removed."
                    );

                    return;
                }

                toolManager.removeProposal(
                    proposalId
                );

                vscode.window.showInformationMessage(
                    `LocalSatur AI rejected the edit proposal for ${proposal.path}.`
                );
            }
        );

    context.subscriptions.push(
        rejectEdit
    );

    // =========================================================
    // DISPOSE
    // =========================================================

    context.subscriptions.push({
        dispose: () => {
            toolManager.dispose();
        }
    });

    // =========================================================
    // ACTIVATION LOG
    // =========================================================

    console.log(
        `LocalSatur AI activated. Workspace root: ${workspaceRoot}`
    );
}

// =============================================================
// DEACTIVATE
// =============================================================

export function deactivate(): void {
    console.log(
        "LocalSatur AI deactivated."
    );
}

// =============================================================
// CHAT VIEW
// =============================================================

class LocalForgeChatViewProvider
    implements vscode.WebviewViewProvider {

    private readonly context: vscode.ExtensionContext;

    private readonly agent: AgentEngine;

    private readonly toolManager: ToolManager;

    private readonly workspaceTools: WorkspaceTools;

    private readonly ollama: OllamaClient;

    private readonly providerManager: AIProviderManager;

    constructor(
        context: vscode.ExtensionContext,
        agent: AgentEngine,
        toolManager: ToolManager,
        workspaceTools: WorkspaceTools,
        ollama: OllamaClient,
        providerManager: AIProviderManager
    ) {
        this.context = context;
        this.agent = agent;
        this.toolManager = toolManager;
        this.workspaceTools = workspaceTools;
        this.ollama = ollama;
        this.providerManager = providerManager;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView
    ): void {
        const panel = webviewView;

        panel.webview.options = {
            enableScripts:
                true,

            localResourceRoots: [
                vscode.Uri.joinPath(
                    this.context.extensionUri,
                    "dist"
                )
            ]
        };

        panel.webview.html =
            getChatHtml();

    // =========================================================
    // CHAT MODE HISTORY
    // =========================================================

    /*
     * Chat history belongs to this Webview panel.
     * The system message makes multi-turn behavior explicit to local models.
     */
    const chatHistory: ChatMessage[] = [
        {
            role: "system",
            content:
                "You are LocalSatur AI Chat. This is a multi-turn conversation. " +
                "Use the supplied conversation history as context for every reply. " +
                "When the user asks about something stated earlier in this conversation, " +
                "use that earlier message rather than claiming that you cannot remember it."
        }
    ];

    // =========================================================
    // WEBVIEW MESSAGES
    // =========================================================

    const messageDisposable =
        panel.webview.onDidReceiveMessage(
            async message => {
                try {

                    // =============================================
                    // PROVIDER
                    // =============================================

                    if (
                        message?.type ===
                        "getProviders"
                    ) {
                        const providers =
                            this.providerManager
                                .getProviders()
                                .map(provider => ({
                                    id: provider.id,
                                    name: provider.name
                                }));

                        const currentProvider =
                            vscode.workspace
                                .getConfiguration(
                                    "localforge"
                                )
                                .get<string>(
                                    "provider",
                                    this.providerManager
                                        .getActiveProviderId() ||
                                        "ollama"
                                );

                        panel.webview.postMessage({
                            type: "providers",
                            providers,
                            selectedProvider:
                                currentProvider
                        });

                        return;
                    }

                    if (
                        message?.type ===
                        "setProvider"
                    ) {
                        const selectedProvider =
                            typeof message.provider === "string"
                                ? message.provider.trim()
                                : "";

                        if (!selectedProvider) {
                            return;
                        }

                        if (
                            !this.providerManager.hasProvider(
                                selectedProvider
                            )
                        ) {
                            panel.webview.postMessage({
                                type: "providerError",
                                message:
                                    `Unknown provider: ${selectedProvider}`
                            });

                            return;
                        }

                        try {
                            this.providerManager.setActiveProvider(
                                selectedProvider
                            );

                            const configuration =
                                vscode.workspace
                                    .getConfiguration(
                                        "localforge"
                                    );

                            const target =
                                vscode.workspace.workspaceFolders?.length
                                    ? vscode.ConfigurationTarget.Workspace
                                    : vscode.ConfigurationTarget.Global;

                            await configuration.update(
                                "provider",
                                selectedProvider,
                                target
                            );

                            const provider =
                                this.providerManager.getProvider(
                                    selectedProvider
                                );

                            panel.webview.postMessage({
                                type: "providerSelected",
                                provider: selectedProvider,
                                name:
                                    provider?.name ??
                                    selectedProvider
                            });

                            panel.webview.postMessage({
                                type: "status",
                                status:
                                    `Provider: ${
                                        provider?.name ??
                                        selectedProvider
                                    }`
                            });
                        } catch (error) {
                            const errorMessage =
                                error instanceof Error
                                    ? error.message
                                    : String(error);

                            panel.webview.postMessage({
                                type: "providerError",
                                message: errorMessage
                            });
                        }

                        return;
                    }

                    // =============================================
                    // PROVIDER MODELS
                    // =============================================

                    if (
                        message?.type ===
                        "getModels"
                    ) {
                        try {
                            const provider =
                                this.providerManager.getActiveProvider();

                            if (!provider) {
                                throw new Error(
                                    "No active AI provider is available"
                                );
                            }

                            const models =
                                await provider.getModels();

                            const modelDetails =
                                models.map(model => ({
                                    name: model.id,
                                    model: model.id,
                                    capabilities:
                                        model.capabilities ?? [],
                                    supportsTools:
                                        model.capabilities?.includes("tools") ??
                                        false
                                }));

                            const providerConfiguration =
                                vscode.workspace.getConfiguration(
                                    `localforge.providers.${provider.id}`
                                );

                            const currentModel =
                                provider.id === "ollama"
                                    ? vscode.workspace
                                        .getConfiguration(
                                            "localforge.ollama"
                                        )
                                        .get<string>(
                                            "model",
                                            "qwen3:8b-16k"
                                        )
                                    : providerConfiguration.get<string>(
                                        "model",
                                        modelDetails[0]?.name ??
                                            ""
                                    );

                            panel.webview.postMessage({
                                type: "models",
                                provider: provider.id,
                                models: modelDetails,
                                selectedModel: currentModel
                            });
                        } catch (error) {
                            const errorMessage =
                                error instanceof Error
                                    ? error.message
                                    : String(error);

                            panel.webview.postMessage({
                                type: "modelsError",
                                message: errorMessage
                            });
                        }

                        return;
                    }

                    // =============================================
                    // SELECT PROVIDER MODEL
                    // =============================================

                    if (
                        message?.type ===
                        "setModel"
                    ) {
                        const selectedModel =
                            typeof message.model === "string"
                                ? message.model.trim()
                                : "";

                        if (!selectedModel) {
                            return;
                        }

                        try {
                            const provider =
                                this.providerManager.getActiveProvider();

                            if (!provider) {
                                throw new Error(
                                    "No active AI provider is available"
                                );
                            }

                            const models =
                                await provider.getModels();

                            const modelExists =
                                models.some(
                                    model =>
                                        model.id === selectedModel
                                );

                            if (!modelExists) {
                                throw new Error(
                                    `${provider.name} model not found: ${selectedModel}`
                                );
                            }

                            const target =
                                vscode.workspace.workspaceFolders?.length
                                    ? vscode.ConfigurationTarget.Workspace
                                    : vscode.ConfigurationTarget.Global;

                            if (provider.id === "ollama") {
                                const configuration =
                                    vscode.workspace.getConfiguration(
                                        "localforge.ollama"
                                    );

                                await configuration.update(
                                    "model",
                                    selectedModel,
                                    target
                                );
                            } else {
                                const configuration =
                                    vscode.workspace.getConfiguration(
                                        `localforge.providers.${provider.id}`
                                    );

                                await configuration.update(
                                    "model",
                                    selectedModel,
                                    target
                                );
                            }

                            panel.webview.postMessage({
                                type: "modelSelected",
                                model: selectedModel
                            });
                        } catch (error) {
                            const errorMessage =
                                error instanceof Error
                                    ? error.message
                                    : String(error);

                            panel.webview.postMessage({
                                type: "modelsError",
                                message: errorMessage
                            });
                        }

                        return;
                    }

                    // =============================================
                    // WORKSPACE ATTACHMENTS
                    // =============================================

                    if (message?.type === "openWorkspaceDashboard") {
                        try {
                            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                            if (!workspaceFolder) throw new Error("Open a workspace folder before managing workspace files.");
                            const files = await vscode.workspace.findFiles("**/*", "**/{node_modules,.git,.venv,dist,out}/**", 2000);
                            const items = [];
                            for (const uri of files) {
                                try {
                                    const stat = await vscode.workspace.fs.stat(uri);
                                    if (stat.type & vscode.FileType.File) items.push({ path: vscode.workspace.asRelativePath(uri, false), size: stat.size });
                                } catch { }
                            }
                            items.sort((a, b) => a.path.localeCompare(b.path));
                            panel.webview.postMessage({ type: "workspaceFiles", files: items });
                        } catch (error) {
                            panel.webview.postMessage({ type: "attachmentError", message: error instanceof Error ? error.message : String(error) });
                        }
                        return;
                    }

                    if (message?.type === "addWorkspaceFiles") {
                        try {
                            if (!vscode.workspace.workspaceFolders?.[0]) throw new Error("Open a workspace folder before adding workspace files.");
                            const paths = Array.isArray(message.paths) ? message.paths.filter((value: unknown): value is string => typeof value === "string") : [];
                            let totalSize = 0;
                            for (const relativePath of paths) {
                                const uri = vscode.Uri.file(this.workspaceTools.getAbsolutePath(relativePath));
                                const stat = await vscode.workspace.fs.stat(uri);
                                if (!(stat.type & vscode.FileType.File)) continue;
                                if (stat.size > MAX_ATTACHMENT_SIZE) throw new Error(`${relativePath} is too large. The maximum size is 1 MB.`);
                                totalSize += stat.size;
                                if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE) throw new Error("The selected workspace files exceed the 5 MB total attachment limit.");
                                const content = await this.workspaceTools.readFile(relativePath);
                                panel.webview.postMessage({ type: "workspaceAttachment", attachment: { name: path.basename(relativePath), path: relativePath, type: "text/plain", size: stat.size, content } });
                            }
                        } catch (error) {
                            panel.webview.postMessage({ type: "attachmentError", message: error instanceof Error ? error.message : String(error) });
                        }
                        return;
                    }

                    if (message?.type === "deleteWorkspaceFiles") {
                        try {
                            if (!vscode.workspace.workspaceFolders?.[0]) throw new Error("Open a workspace folder before deleting workspace files.");
                            const paths = Array.isArray(message.paths) ? message.paths.filter((value: unknown): value is string => typeof value === "string") : [];
                            if (paths.length === 0) return;
                            const confirmation = await vscode.window.showWarningMessage(
                                paths.length === 1 ? `Move "${paths[0]}" to the Recycle Bin?` : `Move ${paths.length} selected files to the Recycle Bin?`,
                                { modal: true, detail: "The selected files will be moved to the Recycle Bin and can normally be restored from there." },
                                "Move to Recycle Bin"
                            );
                            if (confirmation !== "Move to Recycle Bin") return;
                            const deletedPaths: string[] = [];
                            for (const relativePath of paths) {
                                const uri = vscode.Uri.file(this.workspaceTools.getAbsolutePath(relativePath));
                                await vscode.workspace.fs.delete(uri, { useTrash: true, recursive: false });
                                deletedPaths.push(relativePath);
                            }
                            panel.webview.postMessage({ type: "workspaceFilesDeleted", paths: deletedPaths });
                        } catch (error) {
                            panel.webview.postMessage({ type: "attachmentError", message: error instanceof Error ? error.message : String(error) });
                        }
                        return;
                    }

                    // CHAT / AGENT
                    // =============================================

                    if (
                        message?.type ===
                        "chat"
                    ) {
                        const content =
                            typeof message.content ===
                            "string"
                                ? message.content.trim()
                                : "";

                        const requestContent =
                            buildAttachmentContext(
                                content,
                                message.attachments
                            );

                        const mode =
                            message.mode === "chat"
                                ? "chat"
                                : "agent";

                        const hasAttachments =
                            Array.isArray(message.attachments) &&
                            message.attachments.length > 0;

                        if (!content && !hasAttachments) {
                            return;
                        }

                        panel.webview.postMessage({
                            type:
                                "status",
                            status:
                                "Thinking"
                        });

                        try {
                            // =====================================
                            // CHAT MODE
                            // =====================================

                            if (mode === "chat") {
                                const configuration =
                                    vscode.workspace.getConfiguration(
                                        "localforge.ollama"
                                    );

                                const model =
                                    configuration.get<string>(
                                        "model",
                                        "qwen3:8b-16k"
                                    );

                                /*
                                 * Build a fresh request array for every turn.
                                 * Previous completed turns remain in chatHistory.
                                 */
                                const messages: ChatMessage[] = [
                                    ...chatHistory,
                                    {
                                        role: "user",
                                        content: requestContent
                                    }
                                ];

                                console.log(
                                    `LocalSatur AI Chat: sending ${messages.length} messages ` +
                                    `(history: ${chatHistory.length}) to ${model}`
                                );

                                const result =
                                    await this.ollama.streamChat(
                                        model,
                                        messages,
                                        undefined,
                                        async (chunk) => {
                                            if (!chunk) {
                                                return;
                                            }

                                            panel.webview.postMessage({
                                                type:
                                                    "stream",

                                                content:
                                                    chunk
                                            });
                                        }
                                    );

                                const assistantContent =
                                    result.message.content ?? "";

                                /*
                                 * Commit the completed turn only after Ollama
                                 * returns successfully.
                                 */
                                chatHistory.push(
                                    {
                                        role: "user",
                                        content: requestContent
                                    },
                                    {
                                        role: "assistant",
                                        content:
                                            assistantContent
                                    }
                                );

                                console.log(
                                    `LocalSatur AI Chat: history now contains ` +
                                    `${chatHistory.length} messages`
                                );

                                panel.webview.postMessage({
                                    type:
                                        "response",

                                    content:
                                        assistantContent,

                                    steps:
                                        []
                                });

                                panel.webview.postMessage({
                                    type:
                                        "status",

                                    status:
                                        "Completed"
                                });

                                return;
                            }

                            // =====================================
                            // AGENT MODE
                            // =====================================

                            const selectedModelDetails =
                                await this.ollama.getModelDetails(
                                    vscode.workspace
                                        .getConfiguration(
                                            "localforge.ollama"
                                        )
                                        .get<string>(
                                            "model",
                                            "qwen3:8b-16k"
                                        )
                                );

                            if (
                                !selectedModelDetails.supportsTools
                            ) {
                                throw new Error(
                                    `The selected model does not support Agent tools. Switch to Chat mode or select a tool-capable model.`
                                );
                            }

                            const result =
                                await this.agent.run(
                                    requestContent,
                                    async (chunk) => {
                                        if (!chunk) {
                                            return;
                                        }

                                        panel.webview.postMessage({
                                            type:
                                                "stream",

                                            content:
                                                chunk
                                        });
                                    }
                                );

                            panel.webview.postMessage({
                                type:
                                    "response",

                                content:
                                    result.content,

                                steps:
                                    result.steps
                            });

                            // =====================================
                            // EDIT PROPOSALS
                            // =====================================

                            for (
                                const proposalId
                                of result.proposals
                            ) {
                                const proposal =
                                    this.toolManager.getProposal(
                                        proposalId
                                    );

                                if (!proposal) {
                                    continue;
                                }

                                panel.webview.postMessage({
                                    type:
                                        "editProposal",

                                    proposal: {
                                        id:
                                            proposal.id,

                                        path:
                                            proposal.path,

                                        reason:
                                            proposal.reason
                                    }
                                });
                            }

                            panel.webview.postMessage({
                                type:
                                    "status",

                                status:
                                    "Completed"
                            });
                        } catch (error) {
                            const errorMessage =
                                error instanceof Error
                                    ? error.message
                                    : String(error);

                            panel.webview.postMessage({
                                type:
                                    "error",

                                message:
                                    errorMessage
                            });

                            panel.webview.postMessage({
                                type:
                                    "status",

                                status:
                                    "Error"
                            });
                        }

                        return;
                    }

                    // =============================================
                    // APPROVE EDIT
                    // =============================================

                    if (
                        message?.type ===
                        "approveEdit"
                    ) {
                        const proposalId =
                            message.proposalId;

                        if (
                            typeof proposalId !==
                            "string"
                        ) {
                            return;
                        }

                        const proposal =
                            this.toolManager.getProposal(
                                proposalId
                            );

                        if (!proposal) {
                            panel.webview.postMessage({
                                type:
                                    "error",

                                message:
                                    "Edit proposal not found or expired."
                            });

                            return;
                        }

                        const confirmation =
                            await vscode.window.showWarningMessage(
                                `Apply edit to ${proposal.path}?`,
                                {
                                    modal:
                                        true
                                },
                                "Apply Edit"
                            );

                        if (
                            confirmation !==
                            "Apply Edit"
                        ) {
                            return;
                        }

                        try {
                            await this.toolManager.applyProposal(
                                proposalId
                            );

                            panel.webview.postMessage({
                                type:
                                    "editApplied",

                                proposalId
                            });

                            panel.webview.postMessage({
                                type:
                                    "response",

                                content:
                                    `Edit applied successfully to ${proposal.path}.`
                            });

                            const absolutePath =
                                this.workspaceTools.getAbsolutePath(
                                    proposal.path
                                );

                            const document =
                                await vscode.workspace.openTextDocument(
                                    vscode.Uri.file(
                                        absolutePath
                                    )
                                );

                            await vscode.window.showTextDocument(
                                document,
                                {
                                    preview:
                                        false
                                }
                            );
                        } catch (error) {
                            const message =
                                error instanceof Error
                                    ? error.message
                                    : String(error);

                            panel.webview.postMessage({
                                type:
                                    "error",

                                message:
                                    `Could not apply edit: ${message}`
                            });
                        }

                        return;
                    }

                    // =============================================
                    // REJECT EDIT
                    // =============================================

                    if (
                        message?.type ===
                        "rejectEdit"
                    ) {
                        const proposalId =
                            message.proposalId;

                        if (
                            typeof proposalId !==
                            "string"
                        ) {
                            return;
                        }

                        const proposal =
                            this.toolManager.getProposal(
                                proposalId
                            );

                        if (!proposal) {
                            return;
                        }

                        this.toolManager.removeProposal(
                            proposalId
                        );

                        panel.webview.postMessage({
                            type:
                                "editRejected",

                            proposalId
                        });

                        panel.webview.postMessage({
                            type:
                                "response",

                            content:
                                `Edit proposal rejected for ${proposal.path}.`
                        });

                        return;
                    }

                    // =============================================
                    // REVIEW DIFF
                    // =============================================

                    if (
                        message?.type ===
                        "reviewEdit"
                    ) {
                        const proposalId =
                            message.proposalId;

                        if (
                            typeof proposalId !==
                            "string"
                        ) {
                            return;
                        }

                        await showProposalDiff(
                            this.toolManager,
                            this.workspaceTools,
                            proposalId
                        );

                        return;
                    }

                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : String(error);

                    panel.webview.postMessage({
                        type:
                            "error",

                        message
                    });
                }
            },
            undefined,
            this.context.subscriptions
        );

    this.context.subscriptions.push(
        messageDisposable
    );
}


}

// =============================================================
// SHOW PROPOSAL DIFF
// =============================================================

async function showProposalDiff(
    toolManager: ToolManager,
    workspaceTools: WorkspaceTools,
    proposalId: string
): Promise<void> {
    const proposal =
        toolManager.getProposal(
            proposalId
        );

    if (!proposal) {
        vscode.window.showErrorMessage(
            "LocalSatur AI: Edit proposal not found or expired."
        );

        return;
    }

    const absolutePath =
        workspaceTools.getAbsolutePath(
            proposal.path
        );

    const fileUri =
        vscode.Uri.file(
            absolutePath
        );

    const exists =
        await workspaceTools.fileExists(
            proposal.path
        );

    let originalUri:
        vscode.Uri;

    if (exists) {
        originalUri =
            fileUri;
    } else {
        originalUri =
            vscode.Uri.from({
                scheme:
                    "localforge-preview-empty",

                path:
                    absolutePath,

                query:
                    proposal.id
            });
    }

    const proposedUri =
        vscode.Uri.from({
            scheme:
                "localforge-preview",

            path:
                absolutePath,

            query:
                proposal.id
        });

    await vscode.commands.executeCommand(
        "vscode.diff",
        originalUri,
        proposedUri,
        `LocalSatur AI: ${proposal.path}`,
        {
            preview:
                false
        }
    );
}

// =============================================================
// RELATIVE PATH
// =============================================================

function toRelativePath(
    root: string,
    absolutePath: string
): string {
    const relative =
        path.relative(
            root,
            absolutePath
        );

    if (
        !relative ||
        relative.startsWith("..")
    ) {
        return absolutePath.replace(
            /\\/g,
            "/"
        );
    }

    return relative.replace(
        /\\/g,
        "/"
    );
}

// =============================================================
// CHAT HTML
// =============================================================

function getChatHtml(): string {
    return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <style>
        :root {
            color-scheme: light dark;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 0;

            background:
                var(--vscode-editor-background);

            color:
                var(--vscode-editor-foreground);

            font-family:
                var(
                    --vscode-font-family,
                    Arial,
                    sans-serif
                );

            font-size:
                var(--vscode-font-size);
        }

        .app {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }

        .header {
            padding: 14px 16px;

            border-bottom:
                1px solid
                var(--vscode-panel-border);

            background:
                var(--vscode-sideBar-background);
        }

        .brand {
            font-size: 16px;
            font-weight: 700;
        }

        .subtitle {
            margin-top: 3px;
            font-size: 11px;
            opacity: 0.65;
        }

        .model-row {
            display: flex;
            align-items: center;
            gap: 7px;
            margin-top: 10px;
        }

        .model-row label {
            font-size: 11px;
            opacity: 0.75;
            white-space: nowrap;
        }

        .model-row select {
            flex: 1;
            min-width: 0;
            padding: 5px 7px;
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 4px;
            color: var(--vscode-dropdown-foreground);
            background: var(--vscode-dropdown-background);
        }

        .model-refresh {
            flex: 0 0 auto;
            padding: 5px 8px;
        }

        .status {
            margin-top: 8px;
            font-size: 11px;
            opacity: 0.7;
        }

        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }

        .message {
            margin-bottom: 14px;
            padding: 10px 12px;

            border-radius: 7px;

            white-space: pre-wrap;

            overflow-wrap:
                anywhere;
        }

        .message.user {
            background:
                var(
                    --vscode-textBlockQuote-background
                );

            border-left:
                3px solid
                var(
                    --vscode-textLink-foreground
                );
        }

        .message.assistant {
            background:
                var(
                    --vscode-editorWidget-background
                );

            border:
                1px solid
                var(
                    --vscode-widget-border
                );
        }

        .message.error {
            background:
                var(
                    --vscode-inputValidation-errorBackground
                );

            border:
                1px solid
                var(
                    --vscode-inputValidation-errorBorder
                );
        }

        .proposal {
            margin:
                14px 0;

            padding:
                14px;

            border:
                1px solid
                var(
                    --vscode-focusBorder
                );

            border-radius:
                8px;

            background:
                var(
                    --vscode-editorWidget-background
                );
        }

        .proposal-title {
            font-weight: 700;
            margin-bottom: 8px;
        }

        .proposal-path {
            font-family:
                var(
                    --vscode-editor-font-family,
                    monospace
                );

            font-size: 12px;

            margin-bottom: 8px;

            overflow-wrap:
                anywhere;
        }

        .proposal-reason {
            margin-bottom: 12px;
            opacity: 0.85;
            white-space: pre-wrap;
        }

        .buttons {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        button {
            border: 0;
            border-radius: 4px;

            padding:
                7px 11px;

            cursor: pointer;

            color:
                var(
                    --vscode-button-foreground
                );

            background:
                var(
                    --vscode-button-background
                );
        }

        button:hover {
            background:
                var(
                    --vscode-button-hoverBackground
                );
        }

        button.secondary {
            color:
                var(
                    --vscode-button-secondaryForeground
                );

            background:
                var(
                    --vscode-button-secondaryBackground
                );
        }

        button.danger {
            background:
                var(
                    --vscode-testing-iconFailed
                );

            color: white;
        }


        .attachment-zone {
            position: relative;
            margin-bottom: 8px;
        }

        .attachment-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 8px;
        }

        .attachment-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            max-width: 100%;
            padding: 5px 8px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            background: var(--vscode-editorWidget-background);
            font-size: 11px;
        }

        .attachment-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 220px;
        }

        .attachment-remove {
            padding: 0;
            min-width: 18px;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            font-size: 13px;
            line-height: 18px;
            background: transparent;
            color: var(--vscode-descriptionForeground);
        }

        .attachment-remove:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }

        .attachment-menu {
            position: absolute;
            left: 0;
            bottom: 38px;
            z-index: 20;
            min-width: 190px;
            padding: 6px;
            border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
            border-radius: 6px;
            background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
            box-shadow: 0 4px 12px var(--vscode-widget-shadow);
        }

        .attachment-menu.hidden {
            display: none;
        }

        .attachment-menu-item {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            border-radius: 4px;
            text-align: left;
            color: var(--vscode-menu-foreground, var(--vscode-foreground));
            background: transparent;
        }

        .attachment-menu-item:hover {
            background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
            color: var(--vscode-menu-selectionForeground, var(--vscode-foreground));
        }

        .danger-menu-item {
            color: var(--vscode-errorForeground, var(--vscode-testing-iconFailed));
        }

        .attachment-menu-icon {
            width: 18px;
            text-align: center;
            opacity: 0.9;
        }

        .workspace-dashboard { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--vscode-editor-background); }
        .workspace-dashboard.hidden { display: none; }
        .workspace-dashboard-panel { width: min(680px, 100%); max-height: min(720px, 90vh); display: flex; flex-direction: column; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-editorWidget-background); box-shadow: 0 12px 32px var(--vscode-widget-shadow); overflow: hidden; }
        .workspace-dashboard-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--vscode-panel-border); }
        .workspace-dashboard-title { font-size: 14px; font-weight: 600; }
        .workspace-dashboard-subtitle { margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 11px; }
        .workspace-dashboard-search { margin: 12px; width: calc(100% - 24px); box-sizing: border-box; }
        .workspace-file-list { flex: 1; min-height: 180px; overflow: auto; padding: 0 12px 12px; }
        .workspace-file-row { display: flex; align-items: center; gap: 9px; padding: 8px 9px; border-radius: 5px; cursor: pointer; }
        .workspace-file-row:hover { background: var(--vscode-list-hoverBackground); }
        .workspace-file-row input { flex: 0 0 auto; }
        .workspace-file-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
        .workspace-file-size { margin-left: auto; flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 10px; }
        .workspace-empty { padding: 28px 12px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
        .workspace-dashboard-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-top: 1px solid var(--vscode-panel-border); }
        .workspace-dashboard-actions { display: flex; gap: 8px; }

        .composer-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-top: 8px;
        }

        .attachment-plus {
            width: 30px;
            height: 30px;
            min-width: 30px;
            padding: 0;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            line-height: 1;
            color: var(--vscode-button-secondaryForeground);
            background: var(--vscode-button-secondaryBackground);
        }

        .attachment-plus:hover,
        .attachment-plus.open {
            background: var(--vscode-toolbar-hoverBackground);
        }

        .attachment-hint {
            margin-left: 6px;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }

        .composer {
            padding: 12px;

            border-top:
                1px solid
                var(
                    --vscode-panel-border
                );
        }

        textarea {
            width: 100%;

            min-height:
                80px;

            max-height:
                240px;

            resize:
                vertical;

            padding:
                10px;

            border:
                1px solid
                var(
                    --vscode-input-border
                );

            border-radius:
                5px;

            outline: none;

            color:
                var(
                    --vscode-input-foreground
                );

            background:
                var(
                    --vscode-input-background
                );

            font-family:
                inherit;

            font-size:
                inherit;
        }

        textarea:focus {
            border-color:
                var(
                    --vscode-focusBorder
                );
        }

        .composer-footer {
            display: flex;

            justify-content:
                flex-end;

            margin-top:
                8px;
        }
    </style>
</head>

<body>

<div class="app">

    <div class="header">

        <div class="brand">
            LocalSatur AI
        </div>

        <div class="subtitle">
            Local AI - Ollama
        </div>

        <div class="model-row">
            <label for="mode">Mode</label>

            <select id="mode">
                <option value="agent" selected>Agent</option>
                <option value="chat">Chat</option>
            </select>
        </div>

        <div class="model-row">
            <label for="provider">Provider</label>

            <select id="provider">
                <option value="">Loading providers...</option>
            </select>
        </div>

        <div class="model-row">
            <label for="model">Model</label>

            <select id="model">
                <option>Loading models...</option>
            </select>

            <button
                id="refresh-models"
                class="secondary model-refresh"
                type="button"
                title="Refresh Ollama models"
            >
                Refresh
            </button>
        </div>

        <div
            id="status"
            class="status"
        >
            Ready
        </div>

    </div>

    <div
        id="messages"
        class="messages"
    >

        <div class="message assistant">
            LocalSatur AI is ready. Ask me to inspect,
            understand, modify, or verify your project.
        </div>

    </div>

    <div class="composer">


        <div id="attachment-zone" class="attachment-zone">
            <div id="attachment-list" class="attachment-list"></div>

        </div>

        <textarea
            id="input"
            placeholder="Ask LocalSatur AI to inspect or work on your project..."
        ></textarea>

        <div class="composer-toolbar">

            <div style="position: relative;">
                <div
                    id="attachment-menu"
                    class="attachment-menu hidden"
                    role="menu"
                >
                    <button
                        id="upload-from-computer"
                        class="attachment-menu-item"
                        type="button"
                        role="menuitem"
                    >
                        <span class="attachment-menu-icon">↑</span>
                        <span>Upload from computer</span>
                    </button>

                    <button
                        id="add-from-workspace"
                        class="attachment-menu-item"
                        type="button"
                        role="menuitem"
                    >
                        <span class="attachment-menu-icon">⌂</span>
                        <span>Add from workspace</span>
                    </button>

                </div>

                <button
                    id="attach"
                    class="secondary attachment-plus"
                    type="button"
                    title="Add attachment"
                    aria-label="Add attachment"
                    aria-expanded="false"
                    aria-haspopup="menu"
                >
                    +
                </button>

                <span class="attachment-hint">
                    Add files
                </span>

                <input
                    id="file-input"
                    type="file"
                    multiple
                    hidden
                >
            </div>

            <button id="send">
                Send
            </button>

        </div>

    </div>

</div>

    <div id="workspace-dashboard" class="workspace-dashboard hidden" role="dialog" aria-modal="true" aria-labelledby="workspace-dashboard-title">
        <div class="workspace-dashboard-panel">
            <div class="workspace-dashboard-header">
                <div>
                    <div id="workspace-dashboard-title" class="workspace-dashboard-title">Workspace Files</div>
                    <div class="workspace-dashboard-subtitle">Add files as attachments or move workspace files to the Recycle Bin.</div>
                </div>
                <button id="workspace-dashboard-close" class="secondary" type="button" aria-label="Close workspace files">×</button>
            </div>
            <input id="workspace-dashboard-search" class="workspace-dashboard-search" type="search" placeholder="Search workspace files...">
            <div id="workspace-file-list" class="workspace-file-list"><div class="workspace-empty">Loading workspace files...</div></div>
            <div class="workspace-dashboard-footer">
                <span id="workspace-selection-count" class="workspace-dashboard-subtitle">0 selected</span>
                <div class="workspace-dashboard-actions">
                    <button id="workspace-add-selected" type="button">Add Selected</button>
                    <button id="workspace-delete-selected" class="danger" type="button">Delete Selected</button>
                </div>
            </div>
        </div>
    </div>

<script>

    const vscode =
        acquireVsCodeApi();

    const messages =
        document.getElementById(
            "messages"
        );

    const input =
        document.getElementById(
            "input"
        );

    const attachButton =
        document.getElementById(
            "attach"
        );

    const fileInput =
        document.getElementById(
            "file-input"
        );

    const uploadFromComputer =
        document.getElementById(
            "upload-from-computer"
        );

    const addFromWorkspace =
        document.getElementById(
            "add-from-workspace"
        );

    const attachmentMenu =
        document.getElementById(
            "attachment-menu"
        );

    const attachmentList =
        document.getElementById(
            "attachment-list"
        );

    const workspaceDashboard = document.getElementById("workspace-dashboard");
    const workspaceDashboardClose = document.getElementById("workspace-dashboard-close");
    const workspaceDashboardSearch = document.getElementById("workspace-dashboard-search");
    const workspaceFileList = document.getElementById("workspace-file-list");
    const workspaceSelectionCount = document.getElementById("workspace-selection-count");
    const workspaceAddSelected = document.getElementById("workspace-add-selected");
    const workspaceDeleteSelected = document.getElementById("workspace-delete-selected");

    const sendButton =
        document.getElementById(
            "send"
        );

    const status =
        document.getElementById(
            "status"
        );

    const modeSelect =
        document.getElementById(
            "mode"
        );

    const providerSelect =
        document.getElementById(
            "provider"
        );

    const modelSelect =
        document.getElementById(
            "model"
        );

    const refreshModelsButton =
        document.getElementById(
            "refresh-models"
        );


    // =========================================================
    // ATTACHMENTS
    // =========================================================

    let selectedAttachments = [];

    function addWorkspaceAttachment(attachment) {
        if (!attachment || typeof attachment.content !== "string") {
            setStatus("Could not add workspace file.");
            return;
        }

        const alreadySelected =
            selectedAttachments.some(
                selected =>
                    selected.name === attachment.name &&
                    selected.size === attachment.size &&
                    selected.path === attachment.path
            );

        if (!alreadySelected) {
            selectedAttachments.push(attachment);
        }

        renderAttachments();
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) {
            return bytes + " B";
        }

        if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(1) + " KB";
        }

        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function renderAttachments() {
        attachmentList.innerHTML = "";

        selectedAttachments.forEach(
            (file, index) => {
                const chip =
                    document.createElement("div");

                chip.className =
                    "attachment-chip";

                const name =
                    document.createElement("span");

                name.className =
                    "attachment-name";

                name.title = file.name;
                name.textContent =
                    file.name + " (" +
                    formatFileSize(file.size) +
                    ")";

                const remove =
                    document.createElement("button");

                remove.type = "button";
                remove.className =
                    "attachment-remove";
                remove.title =
                    "Remove " + file.name;
                remove.setAttribute(
                    "aria-label",
                    "Remove " + file.name
                );
                remove.textContent = "×";

                remove.addEventListener(
                    "click",
                    () => {
                        selectedAttachments.splice(
                            index,
                            1
                        );

                        renderAttachments();
                    }
                );

                chip.appendChild(name);
                chip.appendChild(remove);
                attachmentList.appendChild(chip);
            }
        );
    }

    const textFileExtensions =
        new Set([
            "txt", "md", "markdown", "json", "jsonc",
            "js", "jsx", "ts", "tsx", "mjs", "cjs",
            "css", "scss", "less", "html", "htm",
            "xml", "svg", "csv", "tsv", "yaml", "yml",
            "sql", "php", "py", "java", "c", "h",
            "cpp", "hpp", "cs", "go", "rs", "rb",
            "sh", "ps1", "bat", "cmd", "ini", "env",
            "toml", "conf", "config", "log"
        ]);

    function isTextFile(file) {
        if (
            file.type &&
            file.type.startsWith("text/")
        ) {
            return true;
        }

        const parts =
            file.name.toLowerCase().split(".");

        const extension =
            parts.length > 1
                ? parts[parts.length - 1]
                : "";

        return textFileExtensions.has(
            extension
        );
    }

    function addFiles(files) {
        Array.from(files).forEach(
            file => {
                if (file.size > 1024 * 1024) {
                    setStatus(
                        file.name +
                        " is too large. Maximum size is 1 MB."
                    );
                    return;
                }

                if (!isTextFile(file)) {
                    setStatus(
                        file.name +
                        " is not a text or code file."
                    );
                    return;
                }

                const alreadySelected =
                    selectedAttachments.some(
                        selected =>
                            selected.name === file.name &&
                            selected.size === file.size &&
                            selected.lastModified === file.lastModified
                    );

                if (!alreadySelected) {
                    selectedAttachments.push(file);
                }
            }
        );

        renderAttachments();
    }

    function setAttachmentMenuOpen(
        open
    ) {
        attachmentMenu.classList.toggle(
            "hidden",
            !open
        );

        attachButton.classList.toggle(
            "open",
            open
        );

        attachButton.setAttribute(
            "aria-expanded",
            String(open)
        );
    }

    let workspaceFiles = [];
    const workspaceSelectedPaths = new Set();

    function formatWorkspaceSize(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }

    function updateWorkspaceSelectionCount() {
        const count = workspaceSelectedPaths.size;
        workspaceSelectionCount.textContent = count + (count === 1 ? " file selected" : " files selected");
    }

    function renderWorkspaceFiles() {
        workspaceFileList.innerHTML = "";
        const query = workspaceDashboardSearch.value.trim().toLowerCase();
        const filtered = workspaceFiles.filter(file => !query || file.path.toLowerCase().includes(query));
        if (filtered.length === 0) {
            const empty = document.createElement("div");
            empty.className = "workspace-empty";
            empty.textContent = workspaceFiles.length === 0 ? "No files found in the workspace." : "No files match your search.";
            workspaceFileList.appendChild(empty);
        } else {
            filtered.forEach(file => {
                const row = document.createElement("label");
                row.className = "workspace-file-row";
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = workspaceSelectedPaths.has(file.path);
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked) workspaceSelectedPaths.add(file.path);
                    else workspaceSelectedPaths.delete(file.path);
                    updateWorkspaceSelectionCount();
                });
                const pathLabel = document.createElement("span");
                pathLabel.className = "workspace-file-path";
                pathLabel.title = file.path;
                pathLabel.textContent = file.path;
                const size = document.createElement("span");
                size.className = "workspace-file-size";
                size.textContent = formatWorkspaceSize(file.size);
                row.appendChild(checkbox); row.appendChild(pathLabel); row.appendChild(size);
                workspaceFileList.appendChild(row);
            });
        }
        updateWorkspaceSelectionCount();
    }

    function openWorkspaceDashboard() {
        workspaceSelectedPaths.clear();
        workspaceDashboardSearch.value = "";
        workspaceDashboard.classList.remove("hidden");
        workspaceFileList.innerHTML = '<div class="workspace-empty">Loading workspace files...</div>';
        updateWorkspaceSelectionCount();
        vscode.postMessage({ type: "openWorkspaceDashboard" });
    }

    function closeWorkspaceDashboard() {
        workspaceDashboard.classList.add("hidden");
        workspaceSelectedPaths.clear();
    }

    workspaceDashboardClose.addEventListener("click", closeWorkspaceDashboard);
    workspaceDashboard.addEventListener("click", event => {
        if (event.target === workspaceDashboard) closeWorkspaceDashboard();
    });
    workspaceDashboardSearch.addEventListener("input", renderWorkspaceFiles);

    workspaceAddSelected.addEventListener("click", () => {
        const paths = Array.from(workspaceSelectedPaths);
        if (paths.length === 0) { setStatus("Select at least one workspace file."); return; }
        vscode.postMessage({ type: "addWorkspaceFiles", paths });
        closeWorkspaceDashboard();
    });

    workspaceDeleteSelected.addEventListener("click", () => {
        const paths = Array.from(workspaceSelectedPaths);
        if (paths.length === 0) { setStatus("Select at least one workspace file."); return; }
        vscode.postMessage({ type: "deleteWorkspaceFiles", paths });
    });

    attachButton.addEventListener(
        "click",
        event => {
            event.stopPropagation();

            const isOpen =
                !attachmentMenu.classList.contains(
                    "hidden"
                );

            setAttachmentMenuOpen(
                !isOpen
            );
        }
    );

    uploadFromComputer.addEventListener(
        "click",
        event => {
            event.stopPropagation();

            setAttachmentMenuOpen(false);

            fileInput.click();
        }
    );

    addFromWorkspace.addEventListener(
        "click",
        event => {
            event.stopPropagation();
            setAttachmentMenuOpen(false);
            openWorkspaceDashboard();
        }
    );

    fileInput.addEventListener(
        "change",
        () => {
            if (fileInput.files) {
                addFiles(fileInput.files);
            }

            fileInput.value = "";
        }
    );

    document.addEventListener(
        "click",
        event => {
            const target =
                event.target;

            if (
                target instanceof Node &&
                !attachmentMenu.contains(target) &&
                !attachButton.contains(target)
            ) {
                setAttachmentMenuOpen(false);
            }
        }
    );

    // =========================================================
    // ADD MESSAGE
    // =========================================================

    function addMessage(
        role,
        content
    ) {
        const element =
            document.createElement(
                "div"
            );

        element.className =
            "message " + role;

        element.textContent =
            content;

        messages.appendChild(
            element
        );

        messages.scrollTop =
            messages.scrollHeight;

        return element;
    }

    // =========================================================
    // STATUS
    // =========================================================

    function setStatus(
        value
    ) {
        status.textContent =
            value;
    }

    // =========================================================
    // EDIT PROPOSAL
    // =========================================================

    function addProposal(
        proposal
    ) {
        const wrapper =
            document.createElement(
                "div"
            );

        wrapper.className =
            "proposal";

        const title =
            document.createElement(
                "div"
            );

        title.className =
            "proposal-title";

        title.textContent =
            "Edit Edit Proposal";

        const file =
            document.createElement(
                "div"
            );

        file.className =
            "proposal-path";

        file.textContent =
            proposal.path;

        const reason =
            document.createElement(
                "div"
            );

        reason.className =
            "proposal-reason";

        reason.textContent =
            proposal.reason;

        const buttons =
            document.createElement(
                "div"
            );

        buttons.className =
            "buttons";

        // =============================================
        // REVIEW
        // =============================================

        const review =
            document.createElement(
                "button"
            );

        review.textContent =
            "Review Diff";

        review.className =
            "secondary";

        review.addEventListener(
            "click",
            () => {
                vscode.postMessage({
                    type:
                        "reviewEdit",

                    proposalId:
                        proposal.id
                });
            }
        );

        // =============================================
        // APPROVE
        // =============================================

        const approve =
            document.createElement(
                "button"
            );

        approve.textContent =
            "Approve";

        approve.addEventListener(
            "click",
            () => {
                vscode.postMessage({
                    type:
                        "approveEdit",

                    proposalId:
                        proposal.id
                });
            }
        );

        // =============================================
        // REJECT
        // =============================================

        const reject =
            document.createElement(
                "button"
            );

        reject.textContent =
            "Reject";

        reject.className =
            "danger";

        reject.addEventListener(
            "click",
            () => {
                vscode.postMessage({
                    type:
                        "rejectEdit",

                    proposalId:
                        proposal.id
                });
            }
        );

        buttons.appendChild(
            review
        );

        buttons.appendChild(
            approve
        );

        buttons.appendChild(
            reject
        );

        wrapper.appendChild(
            title
        );

        wrapper.appendChild(
            file
        );

        wrapper.appendChild(
            reason
        );

        wrapper.appendChild(
            buttons
        );

        messages.appendChild(
            wrapper
        );

        messages.scrollTop =
            messages.scrollHeight;
    }

    // =========================================================
    // PROVIDER SELECTION
    // =========================================================

    providerSelect.addEventListener(
        "change",
        () => {
            const selectedProvider =
                providerSelect.value;

            if (!selectedProvider) {
                return;
            }

            providerSelect.disabled = true;

            setStatus(
                "Switching provider..."
            );

            vscode.postMessage({
                type: "setProvider",
                provider: selectedProvider
            });
        }
    );

    // =========================================================
    // MODE SELECTION
    // =========================================================

    modeSelect.addEventListener(
        "change",
        () => {
            updateModelAvailability();

            if (
                modeSelect.value === "agent" &&
                !selectedModelSupportsTools
            ) {
                setStatus(
                    "Agent requires a tool-capable model"
                );

                return;
            }

            setStatus(
                modeSelect.value === "chat"
                    ? "Chat mode"
                    : "Agent mode"
            );
        }
    );

    // =========================================================
    // MODEL SELECTION
    // =========================================================

    function loadModels() {
        modelSelect.disabled = true;
        modelSelect.innerHTML = "";

        const loadingOption =
            document.createElement(
                "option"
            );

        loadingOption.textContent =
            "Loading models...";

        modelSelect.appendChild(
            loadingOption
        );

        setStatus(
            "Loading provider models..."
        );

        vscode.postMessage({
            type: "getModels"
        });
    }

    let availableModels = [];

    let selectedModelSupportsTools = false;

    function populateModels(
        models,
        selectedModel
    ) {
        modelSelect.innerHTML = "";

        if (!Array.isArray(models) || models.length === 0) {
            const emptyOption =
                document.createElement(
                    "option"
                );

            emptyOption.textContent =
                "No models found";

            modelSelect.appendChild(
                emptyOption
            );

            modelSelect.disabled = true;
            selectedModelSupportsTools = false;

            setStatus(
                "No models found for this provider"
            );

            return;
        }

        availableModels = models;

        models.forEach(
            model => {
                const option =
                    document.createElement(
                        "option"
                    );

                const supportsTools =
                    model &&
                    model.supportsTools === true;

                option.value =
                    model.name;

                option.textContent =
                    supportsTools
                        ? model.name + " - Agent + Chat"
                        : model.name + " - Chat only";

                option.disabled =
                    modeSelect.value === "agent" &&
                    !supportsTools;

                option.selected =
                    model.name === selectedModel;

                modelSelect.appendChild(
                    option
                );
            }
        );

        let effectiveModel =
            selectedModel;

        const selectedDetails =
            models.find(
                model =>
                    model.name === selectedModel
            );

        if (
            !selectedDetails ||
            (
                modeSelect.value === "agent" &&
                selectedDetails.supportsTools !== true
            )
        ) {
            const firstCompatibleModel =
                models.find(
                    model =>
                        modeSelect.value !== "agent" ||
                        model.supportsTools === true
                );

            if (firstCompatibleModel) {
                effectiveModel =
                    firstCompatibleModel.name;
                modelSelect.value =
                    effectiveModel;
            }
        }

        const effectiveDetails =
            models.find(
                model =>
                    model.name === effectiveModel
            );

        selectedModelSupportsTools =
            effectiveDetails?.supportsTools === true;

        modelSelect.disabled = false;

        setStatus(
            modeSelect.value === "agent"
                ? selectedModelSupportsTools
                    ? "Agent ready"
                    : "Select a tool-capable model"
                : "Chat ready"
        );
    }

    function updateModelAvailability() {
        if (
            !Array.isArray(availableModels) ||
            availableModels.length === 0
        ) {
            return;
        }

        const selectedName =
            modelSelect.value;

        availableModels.forEach(
            model => {
                const option =
                    Array.from(
                        modelSelect.options
                    ).find(
                        item =>
                            item.value ===
                            model.name
                    );

                if (!option) {
                    return;
                }

                option.disabled =
                    modeSelect.value === "agent" &&
                    model.supportsTools !== true;
            }
        );

        const selectedDetails =
            availableModels.find(
                model =>
                    model.name === selectedName
            );

        if (
            modeSelect.value === "agent" &&
            selectedDetails?.supportsTools !== true
        ) {
            const compatible =
                availableModels.find(
                    model =>
                        model.supportsTools === true
                );

            if (compatible) {
                modelSelect.value =
                    compatible.name;

                selectedModelSupportsTools =
                    true;

                modelSelect.disabled = true;

                setStatus(
                    "Switching to tool-capable model..."
                );

                vscode.postMessage({
                    type: "setModel",
                    model: compatible.name
                });
            } else {
                selectedModelSupportsTools =
                    false;

                setStatus(
                    "No tool-capable model available"
                );
            }
        } else {
            selectedModelSupportsTools =
                selectedDetails?.supportsTools === true;
        }
    }

    modelSelect.addEventListener(
        "change",
        () => {
            const selectedModel =
                modelSelect.value;

            if (!selectedModel) {
                return;
            }

            const selectedDetails =
                availableModels.find(
                    model =>
                        model.name === selectedModel
                );

            selectedModelSupportsTools =
                selectedDetails?.supportsTools === true;

            if (
                modeSelect.value === "agent" &&
                !selectedModelSupportsTools
            ) {
                setStatus(
                    "This model supports Chat only"
                );

                updateModelAvailability();
                return;
            }

            modelSelect.disabled = true;

            setStatus(
                "Switching model..."
            );

            vscode.postMessage({
                type: "setModel",
                model: selectedModel
            });
        }
    );

    refreshModelsButton.addEventListener(
        "click",
        loadModels
    );

    // =========================================================
    // SEND
    // =========================================================

    let streamingAssistantElement = null;

    let streamingAssistantContent = "";

    async function send() {
        const content =
            input.value.trim();

        if (!content && selectedAttachments.length === 0) {
            return;
        }

        setStatus(
            "Preparing attachments..."
        );

        let attachments = [];

        try {
            attachments = await Promise.all(
                selectedAttachments.map(
                    async file => {
                        if (
                            typeof file.content ===
                            "string"
                        ) {
                            return {
                                name: file.name,
                                type: file.type,
                                size: file.size,
                                content: file.content
                            };
                        }

                        return {
                            name: file.name,
                            type: file.type,
                            size: file.size,
                            content: await file.text()
                        };
                    }
                )
            );
        } catch (error) {
            setStatus(
                "Could not read attachment"
            );
            return;
        }

        const displayContent =
            content ||
            (attachments.length === 1
                ? "Attached file: " + attachments[0].name
                : "Attached " + attachments.length + " files");

        addMessage(
            "user",
            displayContent
        );

        streamingAssistantElement =
            null;

        streamingAssistantContent =
            "";

        input.value =
            "";

        selectedAttachments = [];
        renderAttachments();

        setStatus(
            "Thinking..."
        );

        vscode.postMessage({
            type:
                "chat",

            mode:
                modeSelect.value === "chat"
                    ? "chat"
                    : "agent",

            content:
                content,

            attachments
        });
    }

    sendButton.addEventListener(
        "click",
        send
    );

    // =========================================================
    // ENTER TO SEND
    // =========================================================

    input.addEventListener(
        "keydown",
        event => {
            if (
                event.key ===
                    "Enter" &&
                !event.shiftKey
            ) {
                event.preventDefault();

                send();
            }
        }
    );

    // =========================================================
    // EXTENSION MESSAGES
    // =========================================================

    window.addEventListener(
        "message",
        event => {
            const message =
                event.data;

            if (message.type === "workspaceFiles") {
                workspaceFiles = Array.isArray(message.files) ? message.files : [];
                renderWorkspaceFiles();
                return;
            }

            if (message.type === "workspaceFilesDeleted") {
                const deleted = Array.isArray(message.paths) ? message.paths : [];
                workspaceFiles = workspaceFiles.filter(file => !deleted.includes(file.path));
                deleted.forEach(path => workspaceSelectedPaths.delete(path));
                renderWorkspaceFiles();
                setStatus(deleted.length === 1 ? "Moved " + deleted[0] + " to the Recycle Bin." : "Moved " + deleted.length + " files to the Recycle Bin.");
                return;
            }

            if (message.type === "workspaceAttachment") {
                addWorkspaceAttachment(
                    message.attachment
                );
                setStatus(
                    "Added " +
                    (message.attachment?.name ?? "workspace file")
                );
                return;
            }

            if (message.type === "attachmentError") {
                setStatus(
                    message.message ||
                    "Attachment operation failed."
                );
                return;
            }

            // =============================================
            // PROVIDER
            // =============================================

            if (
                message.type ===
                "providers"
            ) {
                providerSelect.innerHTML = "";

                if (
                    !Array.isArray(message.providers) ||
                    message.providers.length === 0
                ) {
                    const option =
                        document.createElement("option");

                    option.value = "";
                    option.textContent =
                        "No providers available";

                    providerSelect.appendChild(option);
                    providerSelect.disabled = true;

                    setStatus(
                        "No AI providers available"
                    );

                    return;
                }

                message.providers.forEach(
                    provider => {
                        const option =
                            document.createElement("option");

                        option.value =
                            provider.id;

                        option.textContent =
                            provider.name;

                        option.selected =
                            provider.id ===
                            message.selectedProvider;

                        providerSelect.appendChild(
                            option
                        );
                    }
                );

                providerSelect.disabled = false;

                setStatus(
                    "Provider: " +
                    (
                        message.providers.find(
                            provider =>
                                provider.id ===
                                message.selectedProvider
                        )?.name ??
                        message.selectedProvider
                    )
                );

                return;
            }

            if (
                message.type ===
                "providerSelected"
            ) {
                providerSelect.value =
                    message.provider;

                providerSelect.disabled =
                    false;

                setStatus(
                    "Provider: " +
                    (message.name ??
                        message.provider)
                );

                loadModels();

                return;
            }

            if (
                message.type ===
                "providerError"
            ) {
                providerSelect.disabled =
                    false;

                setStatus(
                    "Provider error"
                );

                addMessage(
                    "error",
                    message.message
                );

                return;
            }

            // =============================================
            // MODELS
            // =============================================

            if (
                message.type ===
                "models"
            ) {
                populateModels(
                    message.models,
                    message.selectedModel
                );

                return;
            }

            if (
                message.type ===
                "modelSelected"
            ) {
                modelSelect.value =
                    message.model;

                const selectedDetails =
                    availableModels.find(
                        model =>
                            model.name ===
                            message.model
                    );

                selectedModelSupportsTools =
                    selectedDetails?.supportsTools === true;

                modelSelect.disabled =
                    false;

                setStatus(
                    modeSelect.value === "chat"
                        ? "Chat - " +
                            message.model
                        : selectedModelSupportsTools
                            ? "Agent - " +
                                message.model
                            : "Chat only - " +
                                message.model
                );

                return;
            }

            if (
                message.type ===
                "modelsError"
            ) {
                modelSelect.disabled =
                    false;

                setStatus(
                    "Model error"
                );

                addMessage(
                    "error",
                    message.message
                );

                return;
            }

            // =============================================
            // STREAM
            // =============================================

            if (
                message.type ===
                "stream"
            ) {
                if (!streamingAssistantElement) {
                    streamingAssistantElement =
                        addMessage(
                            "assistant",
                            ""
                        );
                }

                const chunk =
                    typeof message.content ===
                    "string"
                        ? message.content
                        : "";

                streamingAssistantContent +=
                    chunk;

                streamingAssistantElement.textContent =
                    streamingAssistantContent;

                messages.scrollTop =
                    messages.scrollHeight;

                setStatus(
                    "Generating..."
                );

                return;
            }

            // =============================================
            // RESPONSE
            // =============================================

            if (
                message.type ===
                "response"
            ) {
                /*
                 * Streaming already rendered the assistant
                 * response. Only create a message here when
                 * no stream chunks were received.
                 */
                if (
                    message.content &&
                    !streamingAssistantElement
                ) {
                    addMessage(
                        "assistant",
                        message.content
                    );
                }

                streamingAssistantElement =
                    null;

                streamingAssistantContent =
                    "";

                setStatus(
                    "Completed"
                );

                return;
            }

            // =============================================
            // ERROR
            // =============================================

            if (
                message.type ===
                "error"
            ) {
                addMessage(
                    "error",
                    message.message
                );

                setStatus(
                    "Error"
                );

                return;
            }

            // =============================================
            // STATUS
            // =============================================

            if (
                message.type ===
                "status"
            ) {
                setStatus(
                    message.status
                );

                return;
            }

            // =============================================
            // PROPOSAL
            // =============================================

            if (
                message.type ===
                "editProposal"
            ) {
                addProposal(
                    message.proposal
                );

                setStatus(
                    "Edit proposal ready"
                );

                return;
            }

            // =============================================
            // EDIT APPLIED
            // =============================================

            if (
                message.type ===
                "editApplied"
            ) {
                setStatus(
                    "Edit applied"
                );

                return;
            }

            // =============================================
            // EDIT REJECTED
            // =============================================

            if (
                message.type ===
                "editRejected"
            ) {
                setStatus(
                    "Edit rejected"
                );
            }
        }
    );

    // Load registered providers and the saved provider when the chat opens.
    vscode.postMessage({
        type: "getProviders"
    });

    // Load models for the selected provider when the chat opens.
    loadModels();

</script>

</body>
</html>
`;
} 



