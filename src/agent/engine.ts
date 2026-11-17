import * as vscode from "vscode";

import {
    ChatMessage,
    OllamaClient,
    OllamaToolCall
} from "../ollama/client";

import {
    AIProviderManager
} from "../providers/manager";

import {
    OllamaProvider
} from "../providers/ollama-provider";

import {
    AIProvider
} from "../providers/types";

import {
    ToolManager
} from "./tools";

import {
    AgentMode
} from "./tools";

import {
    FileEditProposal
} from "./edit";

import {
    extractPlan,
    PlanEntity,
    PLAN_FENCE_LANGUAGE
} from "./plan";

export interface AgentResult {
    content: string;
    steps: string[];
    proposals: string[];
    plan?: PlanEntity;
}

export type AgentChunkHandler = (
    chunk: string
) => void | Promise<void>;

export interface AgentActivity {
    type: "iteration" | "tool" | "status";
    label: string;
    detail?: string;
}

export interface AgentRunOptions {
    cancellationToken?: vscode.CancellationToken;
    onActivity?: (
        activity: AgentActivity
    ) => void | Promise<void>;
}

export class AgentEngine {
    private readonly providerManager:
        AIProviderManager;

    private readonly toolManager:
        ToolManager;

    constructor(
        ollama: OllamaClient,
        toolManager: ToolManager,
        providerManager?: AIProviderManager
    ) {
        this.providerManager =
            providerManager ??
            new AIProviderManager();

        if (!providerManager) {
            this.providerManager.register(
                new OllamaProvider(ollama)
            );
        }

        this.toolManager =
            toolManager;
    }

    async run(
        userMessage: string,
        onChunk?: AgentChunkHandler,
        mode: AgentMode = "agent",
        history: ChatMessage[] = [],
        runOptions: AgentRunOptions = {}
    ): Promise<AgentResult> {
        const abortController = new AbortController();
        const cancellationSubscription =
            runOptions.cancellationToken?.onCancellationRequested(
                () => abortController.abort()
            );

        try {
            return await this.runInternal(
                userMessage,
                onChunk,
                mode,
                history,
                runOptions,
                abortController.signal
            );
        } finally {
            cancellationSubscription?.dispose();
        }
    }

    private async runInternal(
        userMessage: string,
        onChunk: AgentChunkHandler | undefined,
        mode: AgentMode,
        history: ChatMessage[],
        runOptions: AgentRunOptions,
        signal: AbortSignal
    ): Promise<AgentResult> {
        const provider =
            this.getActiveProvider();

        const model =
            this.getActiveModel(provider.id);

        const selectedModel =
            (await provider.getModels().catch(() => []))
                .find(candidate => candidate.id === model);

        const modelSupportsTools =
            selectedModel?.capabilities?.includes("tools");

        const tools =
            modelSupportsTools === false
                ? []
                : await this.toolManager.getDefinitions(mode);

        const recentHistory =
            history
                .filter(message =>
                    message.role === "user" ||
                    message.role === "assistant"
                )
                .slice(-20)
                .map(message => ({
                    ...message,
                    content: message.content.slice(-12000)
                }));

        const messages: ChatMessage[] = [
            {
                role: "system",
                content:
                    this.getSystemPrompt(
                        mode,
                        modelSupportsTools !== false
                    )
            },
            ...recentHistory,
            {
                role: "user",
                content: userMessage
            }
        ];

        const steps: string[] = [];
        const proposals: string[] = [];
        const repeatedToolCalls = new Map<string, number>();

        const maxIterations =
            vscode.workspace
                .getConfiguration(
                    "localforge.agent"
                )
                .get<number>(
                    "maxIterations",
                    16
                );

        const maxOutputTokens =
            vscode.workspace
                .getConfiguration(
                    "localforge.agent"
                )
                .get<number>(
                    "maxOutputTokens",
                    8192
                );

        for (
            let iteration = 0;
            iteration < maxIterations;
            iteration++
        ) {
            this.throwIfCanceled(signal);

            steps.push(
                `Iteration ${iteration + 1}`
            );

            await runOptions.onActivity?.({
                type: "iteration",
                label: `Iteration ${iteration + 1}`
            });

            let response;

            try {
                response =
                    await provider.streamChat(
                        model,
                        messages,
                        async chunk => {
                            if (onChunk) {
                                await onChunk(
                                    chunk
                                );
                            }
                        },
                        {
                            temperature:
                                vscode.workspace
                                    .getConfiguration(
                                        "localforge.ollama"
                                    )
                                    .get<number>(
                                        "temperature",
                                        0.2
                                    ),

                            contextLength:
                                vscode.workspace
                                    .getConfiguration(
                                        "localforge.ollama"
                                    )
                                    .get<number>(
                                        "contextLength",
                                        16384
                                    ),

                            maxOutputTokens,

                            tools,
                            signal
                        }
                    );
            } catch (error) {
                if (signal.aborted) {
                    throw new Error("The agent request was canceled.");
                }

                const message =
                    error instanceof Error
                        ? error.message
                        : String(error);

                steps.push(
                    `Provider error: ${message}`
                );

                throw error;
            }

            /*
             * Always preserve the assistant tool-call message. Tool-calling
             * models frequently return empty content alongside tool calls;
             * dropping the message would leave tool results with no matching
             * tool_call_id in the transcript, which OpenAI-compatible APIs
             * reject (audit F1).
             */
            if (
                response.content ||
                (response.toolCalls &&
                    response.toolCalls.length > 0)
            ) {
                messages.push({
                    role: "assistant",
                    content:
                        response.content,
                    tool_calls:
                        response.toolCalls
                });
            }

            const toolCalls =
                response.toolCalls ?? [];

            if (
                toolCalls.length === 0
            ) {
                steps.push(
                    "Agent completed the response."
                );

                const completion =
                    mode === "plan"
                        ? extractPlan(response.content)
                        : { content: response.content };

                return {
                    content:
                        completion.content,
                    steps,
                    proposals,
                    plan: completion.plan
                };
            }

            for (
                const toolCall
                of toolCalls
            ) {
                this.throwIfCanceled(signal);

                const toolName =
                    toolCall.function.name;

                const fingerprint = `${toolName}:${JSON.stringify(
                    toolCall.function.arguments ?? {}
                )}`;
                const callCount =
                    (repeatedToolCalls.get(fingerprint) ?? 0) + 1;

                repeatedToolCalls.set(
                    fingerprint,
                    callCount
                );

                if (callCount > 2) {
                    const loopMessage =
                        `Stopped repeated tool call: ${toolName}.`;

                    steps.push(loopMessage);
                    messages.push({
                        role: "tool",
                        content: JSON.stringify({
                            error: "This identical tool call has already run twice. Inspect the prior result and choose a different action."
                        }),
                        tool_name: toolName
                    });
                    continue;
                }

                steps.push(
                    `Executing tool: ${toolName}`
                );

                await runOptions.onActivity?.({
                    type: "tool",
                    label: `Running ${toolName}`
                });

                const toolResult =
                    await this.executeToolCall(
                        toolCall,
                        proposals,
                        mode,
                        signal,
                        runOptions.onActivity
                    );

                messages.push({
                    role: "tool",
                    content:
                        toolResult,
                    tool_name:
                        toolCall.id ?? toolName
                });

                await runOptions.onActivity?.({
                    type: "tool",
                    label: `Completed ${toolName}`
                });
            }
        }

        steps.push(
            "Maximum agent iterations reached."
        );

        return {
            content:
                "The agent reached the maximum number of iterations without completing the task.",
            steps,
            proposals
        };
    }

    private throwIfCanceled(
        signal: AbortSignal
    ): void {
        if (signal.aborted) {
            throw new Error("The agent request was canceled.");
        }
    }

    private getActiveProvider():
        AIProvider {
        const providerId =
            vscode.workspace
                .getConfiguration(
                    "localforge"
                )
                .get<string>(
                    "provider",
                    "ollama"
                );

        const provider =
            this.providerManager.getProvider(
                providerId
            );

        if (!provider) {
            throw new Error(
                `AI provider "${providerId}" is not registered.`
            );
        }

        return provider;
    }

    private getActiveModel(
        providerId: string
    ):
        string {
        if (providerId !== "ollama") {
            return vscode.workspace
                .getConfiguration(
                    `localforge.providers.${providerId}`
                )
                .get<string>(
                    "model",
                    ""
                );
        }

        return vscode.workspace
            .getConfiguration(
                "localforge.ollama"
            )
            .get<string>(
                "model",
                "qwen3:8b-16k"
            );
    }

    private getSystemPrompt(
        mode: AgentMode,
        toolsAvailable: boolean
    ):
        string {
        if (!toolsAvailable) {
            return `You are LocalSatur AI in ${mode} mode, but the selected model does not support tool calls. Answer directly and do not claim to inspect, modify, or run anything in the workspace.`;
        }

        if (mode === "ask") {
            return `You are LocalSatur AI in Ask mode. Answer naturally and accurately. Use read-only workspace tools when needed to ground explanations or debugging guidance. Do not propose or apply changes, and do not run commands.`;
        }

        if (mode === "plan") {
            return `You are LocalSatur AI in Plan mode. Investigate the request using read-only workspace tools, then produce a concise implementation plan with affected files, ordered changes, validation steps, and risks. Do not propose edits or run commands.

End every Plan mode response with a structured plan block using exactly this format:

${PLAN_FENCE_LANGUAGE}
{"summary":"One sentence describing the change.","steps":[{"title":"Short imperative step title","files":["relative/path.ts"],"action":"edit"}],"risks":["What could go wrong"]}
${PLAN_FENCE_LANGUAGE}

The block must be valid JSON: "steps" is required with 1-50 objects, each having a "title"; "files" lists affected workspace paths relative to the root; "action" is one of create, edit, delete, verify, other. "risks" is optional. Write the human-readable plan as normal Markdown BEFORE the block; do not put anything after it.`;
        }

        return `
You are LocalSatur AI, a local-first AI coding agent running inside Visual Studio Code.

Your job is to help the user inspect, understand, modify, test, and debug their workspace safely.

Available tools:
- read_file
- list_files
- search_files
- get_active_editor
- get_selection
- get_open_files
- propose_file_edit
- propose_file_delete
- propose_file_rename

Important workflow rules:

1. Inspect before modifying.
2. Read the relevant files before proposing changes.
3. Understand the existing implementation before making recommendations.
4. Never directly modify files.
5. All file modifications must go through propose_file_edit.
6. Every proposal must contain the COMPLETE contents of the affected file.
7. Never submit a snippet, patch, diff, excerpt, shortened version, or partial replacement.
8. Never use placeholders such as:
   - ...
   - …
   - ... existing code ...
   - ... rest of file ...
   - ... remaining code ...
   - [rest of file]
   - [remaining code]
   - unchanged
   - omitted
9. Preserve unrelated code, imports, methods, handlers, configuration, comments, and structure.
10. If an existing file is being changed, use read_file to obtain its complete contents before proposing the edit.
11. If you do not have enough information to reconstruct the complete file, inspect or reread it before proposing anything.
12. Large files are not a reason to submit partial content.
13. Multiple affected files require separate complete-file proposals.
14. Proposals require explicit user approval before application.
15. After an approved change, verify the result using appropriate tests, type checking, linting, or other relevant commands.
16. Do not claim a change was applied unless the user explicitly approved it and the application succeeded.

When answering questions about the workspace, use the available tools and base your answer on the actual workspace contents.

When the user asks for a modification, first inspect the relevant files, then propose a complete-file edit for review.
`;
    }

    private async executeToolCall(
        toolCall: OllamaToolCall,
        proposals: string[],
        mode: AgentMode,
        signal: AbortSignal,
        onActivity?: (
            activity: AgentActivity
        ) => void | Promise<void>
    ): Promise<string> {
        const name =
            toolCall.function.name;

        const args =
            toolCall.function.arguments ??
            {};

        try {
            const result =
                await this.toolManager.execute(
                    name,
                    args,
                    mode,
                    signal,
                    async (label, detail) => {
                        await onActivity?.({
                            type: "tool",
                            label,
                            detail
                        });
                    }
                );

            if (
                name === "propose_file_edit" ||
                name === "propose_file_delete" ||
                name === "propose_file_rename"
            ) {
                const proposalId =
                    this.extractProposalId(
                        result
                    );

                if (proposalId) {
                    const proposal =
                        this.toolManager.getProposal(
                            proposalId
                        );

                    if (proposal) {
                        const validationError =
                            proposal.operation === "delete"
                                ? undefined
                                : this.validateWholeFileProposal(proposal);

                        if (
                            validationError
                        ) {
                            this.toolManager
                                .removeProposal(
                                    proposalId
                                );

                            return JSON.stringify({
                                error:
                                    validationError
                            });
                        }

                        proposals.push(
                            proposalId
                        );
                    }
                }
            }

            return result;
        } catch (error) {
            return JSON.stringify({
                error:
                    error instanceof Error
                        ? error.message
                        : String(error)
            });
        }
    }

    private extractProposalId(
        result: string
    ): string | undefined {
        try {
            const parsed =
                JSON.parse(
                    result
                ) as {
                    proposalId?: unknown;
                };

            return typeof
                parsed.proposalId ===
                "string"
                ? parsed.proposalId
                : undefined;
        } catch {
            return undefined;
        }
    }

    private validateWholeFileProposal(
        proposal: FileEditProposal
    ): string | undefined {
        const proposed =
            proposal.proposedContent;

        if (!proposed.trim()) {
            return `Edit proposal rejected for ${proposal.path}: proposed file contents are empty.`;
        }

        const placeholderPatterns = [
            /\.\.\.\s*(existing|rest|remaining|other|implementation|code)/i,
            /^\s*\.\.\.\s*$/m,
            /^\s*…\s*$/m,
            /^\s*\/\/\s*\.\.\.\s*$/m,
            /^\s*\/\*\s*\.\.\.\s*\*\/\s*$/m,
            /^\s*<!--\s*\.\.\.\s*-->\s*$/m,
            /\[\s*rest of (?:the )?file\s*\]/i,
            /\[\s*remaining (?:code|content)\s*\]/i,
            /\bthe rest of (?:the )?file remains unchanged\b/i,
            /\bremaining code remains unchanged\b/i,
            /\bthe remaining code is unchanged\b/i,
            /\bunchanged from (?:the )?original\b/i,
            /\bthe rest remains unchanged\b/i
        ];

        for (
            const pattern
            of placeholderPatterns
        ) {
            if (
                pattern.test(
                    proposed
                )
            ) {
                return `Edit proposal rejected for ${proposal.path}: proposed content appears to contain a placeholder or omitted section. The complete file contents are required.`;
            }
        }

        const originalLength =
            proposal.originalContent.length;

        const proposedLength =
            proposed.length;

        const originalLineCount =
            proposal.originalContent
                .split(/\r?\n/)
                .length;

        const proposedLineCount =
            proposed
                .split(/\r?\n/)
                .length;

        const severelyReduced =
            originalLength >= 2000 &&
            proposedLength <
                originalLength * 0.5;

        const severelyTruncated =
            originalLineCount >= 40 &&
            proposedLineCount <
                originalLineCount * 0.5;

        if (
            severelyReduced ||
            severelyTruncated
        ) {
            return `Edit proposal rejected for ${proposal.path}: proposed content appears significantly shorter than the original file. The complete file contents are required.`;
        }

        return undefined;
    }
}

