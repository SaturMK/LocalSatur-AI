import * as vscode from "vscode";

export interface OllamaModel {
    name: string;
    model: string;
    size: number;
    modified_at: string;
}

export interface OllamaModelDetails {
    name: string;
    model: string;
    capabilities: string[];
    supportsTools: boolean;
}

export type ChatMessageRole =
    | "system"
    | "user"
    | "assistant"
    | "tool";

export interface ChatMessage {
    role: ChatMessageRole;
    content: string;
    tool_calls?: OllamaToolCall[];
    tool_name?: string;
}

export interface OllamaToolCall {
    type?: "function";
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

export interface OllamaTool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, unknown>;
            required?: string[];
        };
    };
}

export interface OllamaChatResponse {
    model: string;
    message: {
        role: string;
        content: string;
        tool_calls?: OllamaToolCall[];
    };
    done: boolean;
}

export interface OllamaStreamChunk {
    model?: string;
    message?: {
        role?: string;
        content?: string;
        tool_calls?: OllamaToolCall[];
    };
    done?: boolean;
}

export type OllamaChunkHandler = (
    chunk: string
) => void | Promise<void>;

/**
 * Communicates with the local Ollama API for model discovery,
 * chat, streaming, and tool-enabled agent operations.
 */
export class OllamaClient {
    private readonly baseUrl: string;

    constructor(baseUrl?: string) {
        const configuredHost =
            baseUrl ??
            vscode.workspace
                .getConfiguration("localforge.ollama")
                .get<string>(
                    "host",
                    "http://localhost:11434"
                );

        this.baseUrl = configuredHost.replace(
            /\/+$/,
            ""
        );
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response = await fetch(
                `${this.baseUrl}/api/tags`
            );

            return response.ok;
        } catch {
            return false;
        }
    }

    async getModels(): Promise<OllamaModel[]> {
        const response = await fetch(
            `${this.baseUrl}/api/tags`
        );

        if (!response.ok) {
            throw new Error(
                `Ollama returned HTTP ${response.status}`
            );
        }

        const data =
            await response.json() as {
                models?: OllamaModel[];
            };

        return data.models ?? [];
    }

    async getModelDetails(
        model: string
    ): Promise<OllamaModelDetails> {
        const response = await fetch(
            `${this.baseUrl}/api/show`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model
                })
            }
        );

        if (!response.ok) {
            const error =
                await response.text();

            throw new Error(
                `Ollama model details failed (${response.status}): ${error}`
            );
        }

        const data =
            await response.json() as {
                capabilities?: string[];
                details?: {
                    families?: string[];
                };
            };

        const capabilities =
            Array.isArray(data.capabilities)
                ? data.capabilities
                : [];

        return {
            name: model,
            model,
            capabilities,
            supportsTools:
                capabilities.includes("tools")
        };
    }

    async chat(
        model: string,
        messages: ChatMessage[],
        tools?: OllamaTool[]
    ): Promise<OllamaChatResponse> {
        const configuration =
            vscode.workspace.getConfiguration(
                "localforge.ollama"
            );

        const temperature =
            configuration.get<number>(
                "temperature",
                0.2
            );

        const contextLength =
            configuration.get<number>(
                "contextLength",
                16384
            );

        const body: Record<string, unknown> = {
            model,
            messages,
            stream: false,
            options: {
                temperature,
                num_ctx: contextLength
            }
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
        }

        const response = await fetch(
            `${this.baseUrl}/api/chat`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            }
        );

        if (!response.ok) {
            const error =
                await response.text();

            throw new Error(
                `Ollama chat failed (${response.status}): ${error}`
            );
        }

        const data =
            await response.json();

        return data as OllamaChatResponse;
    }

    async streamChat(
        model: string,
        messages: ChatMessage[],
        tools?: OllamaTool[],
        onChunk?: OllamaChunkHandler
    ): Promise<OllamaChatResponse> {
        const configuration =
            vscode.workspace.getConfiguration(
                "localforge.ollama"
            );

        const temperature =
            configuration.get<number>(
                "temperature",
                0.2
            );

        const contextLength =
            configuration.get<number>(
                "contextLength",
                16384
            );

        const body: Record<string, unknown> = {
            model,
            messages,
            stream: true,
            options: {
                temperature,
                num_ctx: contextLength
            }
        };

        if (tools && tools.length > 0) {
            body.tools = tools;
        }

        const response = await fetch(
            `${this.baseUrl}/api/chat`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            }
        );

        if (!response.ok) {
            const error =
                await response.text();

            throw new Error(
                `Ollama streaming chat failed (${response.status}): ${error}`
            );
        }

        if (!response.body) {
            throw new Error(
                "Ollama streaming response did not contain a readable body."
            );
        }

        const reader =
            response.body.getReader();

        const decoder =
            new TextDecoder();

        let buffer = "";

        let modelName = model;

        let role = "assistant";

        let content = "";

        const toolCalls: OllamaToolCall[] = [];

        let streamFinished = false;

        try {
            while (!streamFinished) {
                const {
                    value,
                    done
                } = await reader.read();

                if (done) {
                    break;
                }

                buffer += decoder.decode(
                    value,
                    {
                        stream: true
                    }
                );

                const lines =
                    buffer.split("\n");

                buffer =
                    lines.pop() ?? "";

                for (const line of lines) {
                    const trimmed =
                        line.trim();

                    if (!trimmed) {
                        continue;
                    }

                    let chunk:
                        OllamaStreamChunk;

                    try {
                        chunk =
                            JSON.parse(
                                trimmed
                            ) as OllamaStreamChunk;
                    } catch {
                        continue;
                    }

                    if (chunk.model) {
                        modelName =
                            chunk.model;
                    }

                    const message =
                        chunk.message;

                    if (message?.role) {
                        role =
                            message.role;
                    }

                    const fragment =
                        message?.content ?? "";

                    if (fragment) {
                        content += fragment;

                        if (onChunk) {
                            await onChunk(
                                fragment
                            );
                        }
                    }

                    if (
                        message?.tool_calls &&
                        message.tool_calls.length > 0
                    ) {
                        toolCalls.push(
                            ...message.tool_calls
                        );
                    }

                    if (chunk.done) {
                        streamFinished = true;
                    }
                }
            }

            buffer += decoder.decode();

            if (buffer.trim()) {
                const lines =
                    buffer.split("\n");

                for (const line of lines) {
                    const trimmed =
                        line.trim();

                    if (!trimmed) {
                        continue;
                    }

                    let chunk:
                        OllamaStreamChunk;

                    try {
                        chunk =
                            JSON.parse(
                                trimmed
                            ) as OllamaStreamChunk;
                    } catch {
                        continue;
                    }

                    if (chunk.model) {
                        modelName =
                            chunk.model;
                    }

                    const message =
                        chunk.message;

                    if (message?.role) {
                        role =
                            message.role;
                    }

                    const fragment =
                        message?.content ?? "";

                    if (fragment) {
                        content += fragment;

                        if (onChunk) {
                            await onChunk(
                                fragment
                            );
                        }
                    }

                    if (
                        message?.tool_calls &&
                        message.tool_calls.length > 0
                    ) {
                        toolCalls.push(
                            ...message.tool_calls
                        );
                    }

                    if (chunk.done) {
                        streamFinished = true;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        return {
            model: modelName,
            message: {
                role,
                content,
                ...(toolCalls.length > 0
                    ? {
                        tool_calls:
                            toolCalls
                    }
                    : {})
            },
            done: true
        };
    }
}