import * as vscode from "vscode";

import {
    ChatMessage,
    OllamaTool,
    OllamaToolCall
} from "../ollama/client";

import {
    AIChatOptions,
    AIChunkHandler,
    AIModel,
    AIProvider,
    AIResponse
} from "./types";

import {
    ApiKeyStore
} from "./secrets";

interface OpenAIMessage {
    role: string;
    content: string | null;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
            name: string;
            arguments: string;
        };
    }>;
    tool_call_id?: string;
}

interface OpenAIChatResponse {
    model: string;
    choices: Array<{
        message: {
            content?: string | null;
            tool_calls?: Array<{
                id: string;
                type: "function";
                function: {
                    name: string;
                    arguments: string;
                };
            }>;
        };
    }>;
}

interface OpenAIStreamChunk {
    model?: string;
    choices?: Array<{
        delta?: {
            content?: string | null;
            tool_calls?: Array<{
                index: number;
                id?: string;
                type?: "function";
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        finish_reason?: string | null;
    }>;
}

interface AccumulatedToolCall {
    id: string;
    name: string;
    arguments: string;
}

export interface OpenAICompatibleProviderOptions {
    id: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
    apiKeySetting?: string;
}

/**
 * Provider for APIs that implement the OpenAI Chat Completions contract.
 *
 * This is intentionally independent from Ollama. It can later be used for
 * OpenAI, OpenRouter, NVIDIA NIM, Requesty, or another compatible endpoint.
 */
export class OpenAICompatibleProvider
    implements AIProvider {

    readonly id: string;
    readonly name: string;

    private readonly baseUrl: string;
    private readonly apiKey?: string;
    private readonly apiKeySetting?: string;

    constructor(
        options: OpenAICompatibleProviderOptions
    ) {
        this.id = options.id;
        this.name = options.name;

        this.baseUrl =
            options.baseUrl.replace(
                /\/+$/,
                ""
            );

        this.apiKey =
            options.apiKey?.trim() || undefined;
        this.apiKeySetting =
            options.apiKeySetting;
    }

    /**
     * Resolve the API key for this provider.
     *
     * Keys are read from SecretStorage first (secure storage, audit S1).
     * Legacy plaintext configuration values are used as a read-only
     * fallback so existing setups keep working until the key is
     * re-saved through the secure flow.
     */
    async getResolvedApiKey(): Promise<string | undefined> {
        const storedKey = await ApiKeyStore.get(this.id);

        if (storedKey) {
            return storedKey;
        }

        if (this.apiKeySetting) {
            const relativeSetting =
                this.apiKeySetting.startsWith("localforge.")
                    ? this.apiKeySetting.slice("localforge.".length)
                    : this.apiKeySetting;

            const configuredKey =
                vscode.workspace
                    .getConfiguration("localforge")
                    .get<string>(relativeSetting, "");

            const trimmed = configuredKey.trim();
            return trimmed.length > 0 ? trimmed : undefined;
        }

        return this.apiKey;
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response =
                await fetch(
                    `${this.baseUrl}/models`,
                    {
                        method: "GET",
                        headers:
                            await this.getHeaders()
                    }
                );

            return response.ok;
        } catch {
            return false;
        }
    }

    async getModels(): Promise<AIModel[]> {
        const response =
            await fetch(
                `${this.baseUrl}/models`,
                {
                    method: "GET",
                    headers:
                        await this.getHeaders()
                }
            );

        if (!response.ok) {
            throw new Error(
                `Provider models request failed: ` +
                `${response.status} ${response.statusText}`
            );
        }

        const data =
            await response.json() as {
                data?: Array<{
                    id: string;
                    supported_parameters?: string[];
                }>;
            };

        /*
         * Providers that omit `supported_parameters` report unknown
         * capability. A user-configured override (audit F3) settles
         * the question for all models of this provider.
         *
         * The override is read through inspect() because a declared
         * boolean setting resolves to `false` even when unset, which
         * would otherwise disable tool detection for everyone.
         * Only an explicit user value (workspace, then global) counts.
         */
        const overrideInspection = vscode.workspace
            .getConfiguration(`localforge.providers.${this.id}`)
            .inspect<boolean>("supportsTools");

        const supportsToolsOverride =
            overrideInspection?.workspaceValue ??
            overrideInspection?.globalValue;

        return (data.data ?? []).map(
            model => {
                let capabilities: string[] | undefined;

                if (supportsToolsOverride !== undefined) {
                    capabilities = supportsToolsOverride
                        ? ["tools"]
                        : [];
                } else if (
                    model.supported_parameters === undefined
                ) {
                    capabilities = undefined;
                } else {
                    capabilities = model.supported_parameters.includes("tools")
                        ? ["tools"]
                        : [];
                }

                return {
                    id: model.id,
                    name: model.id,
                    provider: this.id,
                    capabilities
                };
            }
        );
    }

    async chat(
        model: string,
        messages: ChatMessage[],
        options?: AIChatOptions
    ): Promise<AIResponse> {
        const response =
            await fetch(
                `${this.baseUrl}/chat/completions`,
                {
                    method: "POST",
                    headers:
                        await this.getHeaders(),
                    signal: options?.signal,
                    body:
                        JSON.stringify(
                            this.buildRequest(
                                model,
                                messages,
                                options,
                                false
                            )
                        )
                }
            );

        if (!response.ok) {
            throw await this.createHttpError(
                response
            );
        }

        const data =
            await response.json() as OpenAIChatResponse;

        const message =
            data.choices?.[0]?.message;

        if (!message) {
            throw new Error(
                "Provider returned no chat completion message."
            );
        }

        return {
            model:
                data.model ?? model,
            content:
                message.content ?? "",
            toolCalls:
                this.convertToolCalls(
                    message.tool_calls
                ),
            done: true
        };
    }

    async streamChat(
        model: string,
        messages: ChatMessage[],
        onChunk: AIChunkHandler,
        options?: AIChatOptions
    ): Promise<AIResponse> {
        const response =
            await fetch(
                `${this.baseUrl}/chat/completions`,
                {
                    method: "POST",
                    headers:
                        await this.getHeaders(),
                    signal: options?.signal,
                    body:
                        JSON.stringify(
                            this.buildRequest(
                                model,
                                messages,
                                options,
                                true
                            )
                        )
                }
            );

        if (!response.ok) {
            throw await this.createHttpError(
                response
            );
        }

        if (!response.body) {
            throw new Error(
                "Provider returned an empty streaming response body."
            );
        }

        const reader =
            response.body.getReader();

        const decoder =
            new TextDecoder();

        let buffer = "";
        let content = "";
        let responseModel = model;

        const toolCalls =
            new Map<
                number,
                AccumulatedToolCall
            >();

        let finished = false;

        /*
         * SSE messages may spread one payload across several
         * "data:" lines; they are joined with newlines before
         * parsing (audit F2).
         */
        let dataLines: string[] = [];

        const processPayload = async (
            payload: string
        ): Promise<void> => {
            if (payload === "[DONE]") {
                finished = true;
                return;
            }

            let chunk:
                OpenAIStreamChunk;

            try {
                chunk =
                    JSON.parse(payload) as OpenAIStreamChunk;
            } catch {
                return;
            }

            if (chunk.model) {
                responseModel =
                    chunk.model;
            }

            const delta =
                chunk.choices?.[0]?.delta;

            if (!delta) {
                return;
            }

            if (
                typeof delta.content ===
                "string" &&
                delta.content.length > 0
            ) {
                content +=
                    delta.content;

                await onChunk(
                    delta.content
                );
            }

            for (
                const toolCall
                of delta.tool_calls ?? []
            ) {
                const existing =
                    toolCalls.get(
                        toolCall.index
                    );

                if (!existing) {
                    toolCalls.set(
                        toolCall.index,
                        {
                            id:
                                toolCall.id ??
                                "",
                            name:
                                toolCall.function
                                    ?.name ??
                                "",
                            arguments:
                                toolCall.function
                                    ?.arguments ??
                                ""
                        }
                    );

                    continue;
                }

                if (toolCall.id) {
                    existing.id =
                        toolCall.id;
                }

                if (
                    toolCall.function?.name
                ) {
                    existing.name =
                        toolCall.function.name;
                }

                if (
                    toolCall.function?.arguments
                ) {
                    existing.arguments +=
                        toolCall.function.arguments;
                }
            }

            if (
                chunk.choices?.[0]?.finish_reason
            ) {
                finished = true;
            }
        };

        const dispatchEvent = async (): Promise<void> => {
            if (dataLines.length === 0) {
                return;
            }

            const payload =
                dataLines.join("\n");

            dataLines = [];

            await processPayload(payload);
        };

        while (!finished) {
            const result =
                await reader.read();

            if (result.done) {
                break;
            }

            buffer +=
                decoder.decode(
                    result.value,
                    {
                        stream: true
                    }
                );

            let newlineIndex =
                buffer.indexOf("\n");

            while (
                !finished &&
                newlineIndex !== -1
            ) {
                const line =
                    buffer
                        .slice(0, newlineIndex)
                        .replace(/\r$/, "");

                buffer =
                    buffer.slice(newlineIndex + 1);

                if (line === "") {
                    // Blank line: end of the current SSE event.
                    await dispatchEvent();
                } else if (line.startsWith("data:")) {
                    dataLines.push(
                        line.slice(5).trimStart()
                    );
                }

                // Other SSE fields (event:, id:, retry:, comments) are ignored.

                newlineIndex =
                    buffer.indexOf("\n");
            }
        }

        buffer +=
            decoder.decode();

        // Flush a final event that was not terminated by a blank line.

        if (buffer.trim()) {
            const line =
                buffer.replace(/\r$/, "");

            if (line.startsWith("data:")) {
                dataLines.push(
                    line.slice(5).trimStart()
                );
            }
        }

        if (!finished) {
            await dispatchEvent();
        }

        const convertedToolCalls =
            this.convertAccumulatedToolCalls(
                toolCalls
            );

        return {
            model: responseModel,
            content,
            toolCalls:
                convertedToolCalls,
            done: true
        };
    }

    private async getHeaders(): Promise<Record<string, string>> {
        const headers: Record<string, string> = {
            "Content-Type":
                "application/json"
        };

        const resolvedApiKey = await this.getResolvedApiKey();

        if (resolvedApiKey) {
            headers.Authorization =
                `Bearer ${resolvedApiKey}`;
        }

        return headers;
    }

    private buildRequest(
        model: string,
        messages: ChatMessage[],
        options: AIChatOptions | undefined,
        stream: boolean
    ): Record<string, unknown> {
        const request: Record<string, unknown> = {
            model,
            messages:
                messages.map(
                    message =>
                        this.convertMessage(
                            message
                        )
                ),
            stream
        };

        if (
            typeof options?.temperature ===
            "number"
        ) {
            request.temperature =
                options.temperature;
        }

        if (
            typeof options?.maxOutputTokens ===
            "number"
        ) {
            request.max_tokens =
                options.maxOutputTokens;
        }

        if (
            options?.tools &&
            options.tools.length > 0
        ) {
            request.tools =
                options.tools.map(
                    tool =>
                        this.convertTool(
                            tool
                        )
                );
        }

        return request;
    }

    private convertMessage(
        message: ChatMessage
    ): OpenAIMessage {
        if (
            message.role ===
            "tool"
        ) {
            return {
                role: "tool",
                content:
                    message.content,
                tool_call_id:
                    message.tool_name
            };
        }

        const converted: OpenAIMessage = {
            role:
                message.role,
            content:
                message.content
        };

        if (
            message.tool_calls &&
            message.tool_calls.length > 0
        ) {
            converted.tool_calls =
                message.tool_calls.map(
                    call => ({
                        id:
                            call.id ?? call.function.name,
                        type:
                            "function",
                        function: {
                            name:
                                call.function.name,
                            arguments:
                                JSON.stringify(
                                    call.function.arguments
                                )
                        }
                    })
                );
        }

        return converted;
    }

    private convertTool(
        tool: OllamaTool
    ): Record<string, unknown> {
        return {
            type: "function",
            function: {
                name:
                    tool.function.name,
                description:
                    tool.function.description,
                parameters:
                    tool.function.parameters
            }
        };
    }

    private convertToolCalls(
        calls:
            Array<{
                id: string;
                type: "function";
                function: {
                    name: string;
                    arguments: string;
                };
            }> | undefined
    ): OllamaToolCall[] | undefined {
        if (
            !calls ||
            calls.length === 0
        ) {
            return undefined;
        }

        return calls.map(
            call => ({
                id:
                    call.id,
                type:
                    "function",
                function: {
                    name:
                        call.function.name,
                    arguments:
                        this.parseArguments(
                            call.function.arguments
                        )
                }
            })
        );
    }

    private convertAccumulatedToolCalls(
        calls:
            Map<
                number,
                AccumulatedToolCall
            >
    ): OllamaToolCall[] | undefined {
        if (calls.size === 0) {
            return undefined;
        }

        return Array.from(
            calls.entries()
        )
            .sort(
                (
                    left,
                    right
                ) =>
                    left[0] -
                    right[0]
            )
            .map(
                ([, call]) => ({
                    id:
                        call.id,
                    type:
                        "function",
                    function: {
                        name:
                            call.name,
                        arguments:
                            this.parseArguments(
                                call.arguments
                            )
                    }
                })
            );
    }

    private parseArguments(
        value: string
    ): Record<string, unknown> {
        try {
            const parsed =
                JSON.parse(value);

            if (
                parsed &&
                typeof parsed ===
                "object" &&
                !Array.isArray(parsed)
            ) {
                return parsed as Record<
                    string,
                    unknown
                >;
            }
        } catch {
            // Fall through to an empty argument object.
        }

        return {};
    }

    private async createHttpError(
        response: Response
    ): Promise<Error> {
        let detail = "";

        try {
            detail =
                await response.text();
        } catch {
            // Ignore response parsing failures.
        }

        return new Error(
            `Provider request failed: ` +
            `${response.status} ${response.statusText}` +
            (
                detail
                    ? ` - ${detail}`
                    : ""
            )
        );
    }
}
