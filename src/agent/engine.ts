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
    FileEditProposal
} from "./edit";

export interface AgentResult {
    content: string;
    steps: string[];
    proposals: string[];
}

export type AgentChunkHandler = (
    chunk: string
) => void | Promise<void>;

export class AgentEngine {
    private readonly providerManager:
        AIProviderManager;

    private readonly toolManager:
        ToolManager;

    constructor(
        ollama: OllamaClient,
        toolManager: ToolManager
    ) {
        this.providerManager =
            new AIProviderManager();

        this.providerManager.register(
            new OllamaProvider(ollama)
        );

        this.toolManager =
            toolManager;
    }

    async run(
        userMessage: string,
        onChunk?: AgentChunkHandler
    ): Promise<AgentResult> {
        const provider =
            this.getActiveProvider();

        const model =
            this.getActiveModel();

        const messages: ChatMessage[] = [
            {
                role: "system",
                content:
                    this.getSystemPrompt()
            },
            {
                role: "user",
                content: userMessage
            }
        ];

        const tools =
            this.toolManager.getDefinitions();

        const steps: string[] = [];
        const proposals: string[] = [];

        const maxIterations =
            vscode.workspace
                .getConfiguration(
                    "localforge.agent"
                )
                .get<number>(
                    "maxIterations",
                    8
                );

        for (
            let iteration = 0;
            iteration < maxIterations;
            iteration++
        ) {
            steps.push(
                `Iteration ${iteration + 1}`
            );

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

                            tools
                        }
                    );
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : String(error);

                steps.push(
                    `Provider error: ${message}`
                );

                throw error;
            }

            if (response.content) {
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

                return {
                    content:
                        response.content,
                    steps,
                    proposals
                };
            }

            for (
                const toolCall
                of toolCalls
            ) {
                const toolName =
                    toolCall.function.name;

                steps.push(
                    `Executing tool: ${toolName}`
                );

                const toolResult =
                    await this.executeToolCall(
                        toolCall,
                        proposals
                    );

                messages.push({
                    role: "tool",
                    content:
                        toolResult,
                    tool_name:
                        toolName
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

    private getActiveModel():
        string {
        return vscode.workspace
            .getConfiguration(
                "localforge.ollama"
            )
            .get<string>(
                "model",
                "qwen3:8b-16k"
            );
    }

    private getSystemPrompt():
        string {
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
        proposals: string[]
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
                    args
                );

            if (
                name ===
                "propose_file_edit"
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
                            this.validateWholeFileProposal(
                                proposal
                            );

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

