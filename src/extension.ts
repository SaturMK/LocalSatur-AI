import * as path from "path";
import * as vscode from "vscode";

import { randomUUID } from "crypto";

import { OllamaClient } from "./ollama/client";
import { WorkspaceTools } from "./tools/workspace";
import { VSCodeContextTools } from "./tools/vscode-context";
import { ToolManager } from "./agent/tools";
import { AgentEngine } from "./agent/engine";
import { LocalForgeDiffProvider } from "./agent/diff-provider";
import { AIProviderManager } from "./providers/manager";
import { ApiKeyStore } from "./providers/secrets";
import { McpManager } from "./mcp/manager";
import { getChatHtml } from "./webview/chat";
import {
    isChangedFileEntry,
    recordChangedFile
} from "./agent/changed-files";
import {
    ChatSessionSnapshot,
    MAX_SESSION_MESSAGES,
    MAX_SESSIONS,
    isValidChatMessage,
    sanitizeSessions,
    sessionTitleFromMessage,
    summarizeSessions
} from "./agent/sessions";

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

const CHANGED_FILES_STATE_KEY =
    "localforge.changedFiles";

/** Legacy single-conversation keys, read only for migration (PRD FR-012). */
const CONVERSATION_STATE_KEY =
    "localforge.conversationHistory";

const SESSIONS_STATE_KEY =
    "localforge.sessions";

const ACTIVE_SESSION_STATE_KEY =
    "localforge.activeSessionId";

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

    ApiKeyStore.init(context.secrets);

    const providerManager =
        new AIProviderManager();

    // =========================================================
    // TOOL MANAGER
    // =========================================================

    const mcpManager = new McpManager();

    /*
     * Pre-edit backups live in the extension's global storage,
     * outside the workspace (audit S5). The directory is created
     * on demand by ToolManager before each backup write.
     */
    const backupDirectory =
        vscode.Uri.joinPath(
            context.globalStorageUri,
            "backups"
        ).fsPath;

    const toolManager =
        new ToolManager(
            workspaceTools,
            vscodeContext,
            backupDirectory,
            mcpManager
        );

    // Discover MCP tools in the background; the agent never blocks
    // on this and servers that fail stay offline (PRD FR-020).
    void mcpManager.refreshShared().catch(() => undefined);

    context.subscriptions.push(
        new vscode.Disposable(() => mcpManager.dispose())
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
    // SET PROVIDER API KEY
    // =========================================================

    const setProviderApiKey =
        vscode.commands.registerCommand(
            "localforge.setProviderApiKey",
            async () => {
                const configuredProviders =
                    providerManager
                        .getProviders()
                        .filter((candidate) => candidate.id !== "ollama");

                if (configuredProviders.length === 0) {
                    vscode.window.showWarningMessage(
                        "LocalSatur AI: no API-key providers are available."
                    );
                    return;
                }

                const selectedProvider = await vscode.window.showQuickPick(
                    configuredProviders.map((candidate) => ({
                        label: candidate.name,
                        description: candidate.id,
                        target: candidate
                    })),
                    {
                        placeHolder: "Choose a provider to configure"
                    }
                );

                if (!selectedProvider) {
                    return;
                }

                const providerId = selectedProvider.target.id;
                const settingKey = `providers.${providerId}.apiKey`;
                const configuration = vscode.workspace.getConfiguration("localforge");

                /*
                 * Legacy fallback only: show the old plaintext value so an
                 * existing configuration can be migrated by re-saving it.
                 * Values held in SecretStorage are never displayed back.
                 */
                const currentValue = configuration.get<string>(settingKey, "");

                const apiKey = await vscode.window.showInputBox({
                    prompt: `Enter the API key for ${selectedProvider.target.name}`,
                    password: true,
                    placeHolder: currentValue
                        ? "A legacy key exists in settings. Paste the key to migrate it to secure storage."
                        : "Paste your API key here",
                    value: currentValue
                });

                if (apiKey === undefined) {
                    return;
                }

                const target =
                    vscode.workspace.workspaceFolders?.length
                        ? vscode.ConfigurationTarget.Workspace
                        : vscode.ConfigurationTarget.Global;

                try {
                    const trimmedKey = apiKey.trim();

                    if (trimmedKey) {
                        /*
                         * Store in SecretStorage and remove the legacy
                         * plaintext setting so the key never persists in
                         * settings.json (audit S1).
                         */
                        await ApiKeyStore.set(providerId, trimmedKey);
                        await configuration.update(settingKey, undefined, target);
                    } else {
                        // An empty submission clears the stored key.
                        await ApiKeyStore.delete(providerId);
                        await configuration.update(settingKey, "", target);
                    }
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : String(error);

                    vscode.window.showErrorMessage(
                        `LocalSatur AI could not store the API key securely: ${message}`
                    );
                    return;
                }

                providerManager.setActiveProvider(
                    providerId
                );

                await configuration.update(
                    "provider",
                    providerId,
                    target
                );

                try {
                    const activeProvider =
                        providerManager.getProvider(
                            providerId
                        );

                    if (activeProvider) {
                        const models =
                            await activeProvider.getModels();

                        vscode.window.showInformationMessage(
                            `LocalSatur AI saved the API key for ${selectedProvider.target.name} in secure storage and activated it. ${models.length} model${models.length === 1 ? "" : "s"} loaded.`
                        );
                        return;
                    }
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : String(error);

                    vscode.window.showWarningMessage(
                        `LocalSatur AI saved the API key for ${selectedProvider.target.name}, but the provider rejected it: ${message}`
                    );
                    return;
                }

                vscode.window.showInformationMessage(
                    `LocalSatur AI saved the API key for ${selectedProvider.target.name} in secure storage and activated the provider.`
                );
            }
        );

    context.subscriptions.push(
        setProviderApiKey
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
                        await workspaceTools.getAbsolutePath(
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

    private readonly providerManager: AIProviderManager;

    /** All persisted sessions, oldest update first (PRD FR-012). */
    private sessions: ChatSessionSnapshot[];

    private activeSessionId: string;

    private activeRequest?: vscode.CancellationTokenSource;

    constructor(
        context: vscode.ExtensionContext,
        agent: AgentEngine,
        toolManager: ToolManager,
        workspaceTools: WorkspaceTools,
        providerManager: AIProviderManager
    ) {
        this.context = context;
        this.agent = agent;
        this.toolManager = toolManager;
        this.workspaceTools = workspaceTools;
        this.providerManager = providerManager;

        /*
         * Load sessions (PRD FR-012). A workspace last used with an
         * older single-conversation layout is migrated into one
         * session so no history is lost.
         */
        const savedSessions = sanitizeSessions(
            context.workspaceState.get<unknown>(
                SESSIONS_STATE_KEY,
                []
            )
        );

        if (savedSessions.length > 0) {
            this.sessions = savedSessions;
        } else {
            const legacyMessages =
                context.workspaceState.get<unknown>(
                    CONVERSATION_STATE_KEY,
                    []
                );

            const legacyChangedFiles =
                context.workspaceState.get<unknown>(
                    CHANGED_FILES_STATE_KEY,
                    []
                );

            const messages = Array.isArray(legacyMessages)
                ? legacyMessages.filter(isValidChatMessage)
                : [];

            const changedFiles = Array.isArray(legacyChangedFiles)
                ? legacyChangedFiles.filter(isChangedFileEntry)
                : [];

            const firstUserMessage = messages.find(
                message => message.role === "user"
            );

            const migrated: ChatSessionSnapshot = {
                id: randomUUID(),
                title: firstUserMessage
                    ? sessionTitleFromMessage(firstUserMessage.content)
                    : "New session",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messages: messages.slice(-MAX_SESSION_MESSAGES),
                changedFiles
            };

            this.sessions = [migrated];

            void this.context.workspaceState.update(
                SESSIONS_STATE_KEY,
                this.sessions
            );
        }

        const savedActiveSessionId =
            context.workspaceState.get<string>(
                ACTIVE_SESSION_STATE_KEY,
                ""
            );

        this.activeSessionId =
            savedActiveSessionId &&
            this.sessions.some(session => session.id === savedActiveSessionId)
                ? savedActiveSessionId
                : this.sessions[this.sessions.length - 1].id;
    }

    // =========================================================
    // SESSIONS (PRD FR-012)
    // =========================================================

    private createSession(): ChatSessionSnapshot {
        const session: ChatSessionSnapshot = {
            id: randomUUID(),
            title: "New session",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
            changedFiles: []
        };

        this.sessions.push(session);

        /*
         * Drop the oldest sessions beyond the cap, never the active one.
         */
        if (this.sessions.length > MAX_SESSIONS) {
            const byOldest = [...this.sessions].sort(
                (a, b) => a.updatedAt - b.updatedAt
            );

            for (
                const candidate of byOldest
            ) {
                if (this.sessions.length <= MAX_SESSIONS) {
                    break;
                }

                if (candidate.id !== this.activeSessionId) {
                    this.sessions = this.sessions.filter(
                        session => session.id !== candidate.id
                    );
                }
            }
        }

        this.switchToSession(session.id);

        return session;
    }

    private switchToSession(sessionId: string): void {
        this.activeSessionId = sessionId;
        void this.persistSessions();
    }

    private ensureActiveSession(): ChatSessionSnapshot {
        let active = this.sessions.find(
            session => session.id === this.activeSessionId
        );

        if (!active) {
            active = this.createSession();
        }

        return active;
    }

    private async persistSessions(): Promise<void> {
        await this.context.workspaceState.update(
            SESSIONS_STATE_KEY,
            this.sessions
        );

        await this.context.workspaceState.update(
            ACTIVE_SESSION_STATE_KEY,
            this.activeSessionId
        );
    }

    private postSessionState(
        panel: vscode.WebviewPanel | vscode.WebviewView
    ): void {
        panel.webview.postMessage({
            type: "sessions",
            sessions: summarizeSessions(
                this.sessions,
                this.activeSessionId
            ),
            activeSessionId: this.activeSessionId
        });
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

        const nonce = randomUUID().replace(/-/g, "");

        const markdownScriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "dist",
                "webview-markdown.js"
            )
        ).toString();

        panel.webview.html =
            getChatHtml(nonce, markdownScriptUri);

    // =========================================================
    // WEBVIEW MESSAGES
    // =========================================================

    const messageDisposable =
        panel.webview.onDidReceiveMessage(
            async message => {
                try {

                    if (message?.type === "getConversation") {
                        const active =
                            this.ensureActiveSession();

                        panel.webview.postMessage({
                            type: "conversation",
                            reset: true,
                            messages: active.messages,
                            changedFiles: active.changedFiles
                        });
                        this.postSessionState(panel);
                        return;
                    }

                    if (message?.type === "newChat") {
                        this.createSession();

                        panel.webview.postMessage({
                            type: "conversationCleared",
                            changedFiles: []
                        });
                        this.postSessionState(panel);
                        return;
                    }

                    if (message?.type === "switchSession") {
                        const target = this.sessions.find(
                            session => session.id === message.id
                        );

                        if (target) {
                            this.switchToSession(target.id);

                            panel.webview.postMessage({
                                type: "conversation",
                                reset: true,
                                messages: target.messages,
                                changedFiles: target.changedFiles
                            });
                            this.postSessionState(panel);
                        }

                        return;
                    }

                    if (message?.type === "deleteSession") {
                        const target = this.sessions.find(
                            session => session.id === message.id
                        );

                        if (target) {
                            this.sessions = this.sessions.filter(
                                session => session.id !== target.id
                            );

                            if (this.activeSessionId === target.id) {
                                const mostRecent =
                                    this.sessions.length > 0
                                        ? this.sessions.reduce(
                                            (latest, session) =>
                                                session.updatedAt > latest.updatedAt
                                                    ? session
                                                    : latest
                                        )
                                        : this.createSession();

                                this.switchToSession(mostRecent.id);

                                panel.webview.postMessage({
                                    type: "conversation",
                                    reset: true,
                                    messages: mostRecent.messages,
                                    changedFiles: mostRecent.changedFiles
                                });
                            }

                            await this.persistSessions();
                            this.postSessionState(panel);
                        }

                        return;
                    }

                    if (message?.type === "revealFile") {
                        const relativePath =
                            typeof message.path === "string"
                                ? message.path
                                : "";

                        if (relativePath) {
                            try {
                                const absolutePath =
                                    await this.workspaceTools.getAbsolutePath(
                                        relativePath
                                    );

                                const document =
                                    await vscode.workspace.openTextDocument(
                                        vscode.Uri.file(absolutePath)
                                    );

                                await vscode.window.showTextDocument(
                                    document,
                                    { preview: true }
                                );
                            } catch (error) {
                                const messageText =
                                    error instanceof Error
                                        ? error.message
                                        : String(error);

                                panel.webview.postMessage({
                                    type: "error",
                                    message: `Could not open ${relativePath}: ${messageText}`
                                });
                            }
                        }

                        return;
                    }

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

                    if (
                        message?.type ===
                        "setProviderApiKey"
                    ) {
                        await vscode.commands.executeCommand(
                            "localforge.setProviderApiKey"
                        );

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
                                        model.capabilities?.includes("tools")
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
                            if (!workspaceFolder) {
                                throw new Error("Open a workspace folder before managing workspace files.");
                            }
                            const files = await vscode.workspace.findFiles("**/*", "**/{node_modules,.git,.venv,dist,out}/**", 2000);
                            const items = [];
                            for (const uri of files) {
                                try {
                                    const stat = await vscode.workspace.fs.stat(uri);
                                    if (stat.type & vscode.FileType.File) {
                                        items.push({ path: vscode.workspace.asRelativePath(uri, false), size: stat.size });
                                    }
                                } catch {
                                    // Ignore unreadable files while building the dashboard list.
                                }
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
                            if (!vscode.workspace.workspaceFolders?.[0]) {
                                throw new Error("Open a workspace folder before adding workspace files.");
                            }
                            const paths = Array.isArray(message.paths) ? message.paths.filter((value: unknown): value is string => typeof value === "string") : [];
                            let totalSize = 0;
                            for (const relativePath of paths) {
                                const uri = vscode.Uri.file(await this.workspaceTools.getAbsolutePath(relativePath));
                                const stat = await vscode.workspace.fs.stat(uri);
                                if (!(stat.type & vscode.FileType.File)) {
                                    continue;
                                }
                                if (stat.size > MAX_ATTACHMENT_SIZE) {
                                    throw new Error(`${relativePath} is too large. The maximum size is 1 MB.`);
                                }
                                totalSize += stat.size;
                                if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE) {
                                    throw new Error("The selected workspace files exceed the 5 MB total attachment limit.");
                                }
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
                            if (!vscode.workspace.workspaceFolders?.[0]) {
                                throw new Error("Open a workspace folder before deleting workspace files.");
                            }
                            const paths = Array.isArray(message.paths) ? message.paths.filter((value: unknown): value is string => typeof value === "string") : [];
                            if (paths.length === 0) {
                                return;
                            }
                            const confirmation = await vscode.window.showWarningMessage(
                                paths.length === 1 ? `Move "${paths[0]}" to the Recycle Bin?` : `Move ${paths.length} selected files to the Recycle Bin?`,
                                { modal: true, detail: "The selected files will be moved to the Recycle Bin and can normally be restored from there." },
                                "Move to Recycle Bin"
                            );
                            if (confirmation !== "Move to Recycle Bin") {
                                return;
                            }
                            const deletedPaths: string[] = [];
                            for (const relativePath of paths) {
                                const uri = vscode.Uri.file(await this.workspaceTools.getAbsolutePath(relativePath));
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

                    if (message?.type === "cancelChat") {
                        if (!this.activeRequest) {
                            return;
                        }

                        this.activeRequest.cancel();
                        panel.webview.postMessage({
                            type: "status",
                            status: "Canceling..."
                        });
                        return;
                    }

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

                        const mode = message.mode;

                        if (
                            mode !== "ask" &&
                            mode !== "plan" &&
                            mode !== "agent"
                        ) {
                            panel.webview.postMessage({
                                type: "error",
                                message: "Choose Ask, Plan, or Agent mode before sending."
                            });
                            return;
                        }

                        const hasAttachments =
                            Array.isArray(message.attachments) &&
                            message.attachments.length > 0;

                        if (!content && !hasAttachments) {
                            return;
                        }

                        if (this.activeRequest) {
                            panel.webview.postMessage({
                                type: "error",
                                message: "A request is already running. Stop it before starting another request."
                            });
                            return;
                        }

                        const requestCancellation =
                            new vscode.CancellationTokenSource();
                        this.activeRequest = requestCancellation;

                        panel.webview.postMessage({
                            type:
                                "status",
                            status:
                                "Thinking"
                        });

                        try {
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
                                    },
                                    mode,
                                    this.ensureActiveSession().messages,
                                    {
                                        cancellationToken:
                                            requestCancellation.token,
                                        onActivity: async activity => {
                                            panel.webview.postMessage({
                                                type: "activity",
                                                activity
                                            });
                                        }
                                    }
                                );

                            const attachedNames =
                                Array.isArray(message.attachments)
                                    ? message.attachments
                                        .map((attachment: ChatAttachment) => attachment.name)
                                        .filter((name: unknown): name is string => typeof name === "string")
                                    : [];

                            const historyContent = [
                                content.slice(0, 12000),
                                attachedNames.length > 0
                                    ? `[Attached files from prior turn: ${attachedNames.join(", ")}; file contents are not retained in history.]`
                                    : ""
                            ]
                                .filter(Boolean)
                                .join("\n\n");

                            const activeSession =
                                this.ensureActiveSession();

                            activeSession.messages.push(
                                {
                                    role: "user",
                                    content: historyContent || "Attached files"
                                },
                                {
                                    role: "assistant",
                                    content: result.content.slice(0, 12000)
                                }
                            );

                            if (activeSession.messages.length > MAX_SESSION_MESSAGES) {
                                activeSession.messages.splice(
                                    0,
                                    activeSession.messages.length - MAX_SESSION_MESSAGES
                                );
                            }

                            if (
                                activeSession.title === "New session" &&
                                historyContent
                            ) {
                                activeSession.title =
                                    sessionTitleFromMessage(historyContent);
                            }

                            activeSession.updatedAt = Date.now();

                            await this.persistSessions();
                            this.postSessionState(panel);

                            panel.webview.postMessage({
                                type: "response",
                                content:
                                    result.content,

                                steps:
                                    result.steps
                            });

                            if (result.plan) {
                                panel.webview.postMessage({
                                    type: "plan",
                                    plan: result.plan
                                });
                            }

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
                                            proposal.reason,

                                        operation:
                                            proposal.operation ?? "write",

                                        targetPath:
                                            proposal.targetPath
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

                            if (requestCancellation.token.isCancellationRequested) {
                                panel.webview.postMessage({
                                    type: "response",
                                    content: "Request canceled. No unapproved changes were applied."
                                });
                                panel.webview.postMessage({
                                    type: "status",
                                    status: "Canceled"
                                });
                            } else {
                                panel.webview.postMessage({
                                    type: "error",
                                    message: errorMessage
                                });
                                panel.webview.postMessage({
                                    type: "status",
                                    status: "Error"
                                });
                            }
                        } finally {
                            if (this.activeRequest === requestCancellation) {
                                this.activeRequest = undefined;
                            }
                            requestCancellation.dispose();
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

                            // Track the change for the session (PRD FR-011).
                            if (
                                proposal.operation === "write" ||
                                proposal.operation === "delete" ||
                                proposal.operation === "rename"
                            ) {
                                const recordedOperation =
                                    proposal.operation === "write"
                                        ? "edit"
                                        : proposal.operation;

                                const activeSession =
                                    this.ensureActiveSession();

                                activeSession.changedFiles = recordChangedFile(
                                    activeSession.changedFiles,
                                    {
                                        path: proposal.path,
                                        targetPath:
                                            proposal.operation === "rename"
                                                ? proposal.targetPath as string
                                                : undefined,
                                        operation: recordedOperation,
                                        timestamp: Date.now()
                                    }
                                );

                                activeSession.updatedAt = Date.now();

                                await this.persistSessions();

                                panel.webview.postMessage({
                                    type: "changedFiles",
                                    changedFiles: activeSession.changedFiles
                                });
                                this.postSessionState(panel);
                            }

                            panel.webview.postMessage({
                                type:
                                    "editApplied",

                                proposalId
                            });

                            panel.webview.postMessage({
                                type:
                                    "response",

                                content:
                                    proposal.operation === "delete"
                                        ? `Deleted ${proposal.path}. A timestamped backup was saved to the LocalSatur AI storage folder.`
                                        : proposal.operation === "rename"
                                            ? `Renamed ${proposal.path} to ${proposal.targetPath}.`
                                            : `Edit applied successfully to ${proposal.path}.`
                            });

                            if (proposal.operation === "delete") {
                                return;
                            }

                            const absolutePath =
                                await this.workspaceTools.getAbsolutePath(
                                    proposal.operation === "rename"
                                        ? proposal.targetPath as string
                                        : proposal.path
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
        await workspaceTools.getAbsolutePath(
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
