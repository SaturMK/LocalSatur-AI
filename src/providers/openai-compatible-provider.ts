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
            options.apiKey;
    }

    async isAvailable(): Promise<boolean> {
        try {
            const response =
                await fetch(
                    `${this.baseUrl}/models`,
                    {
                        method: "GET",
                        headers:
                            this.getHeaders()
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
                        this.getHeaders()
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
                }>;
            };

        return (data.data ?? []).map(
            model => ({
                id: model.id,
                name: model.id,
                provider: this.id
            })
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
                        this.getHeaders(),
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
                        this.getHeaders(),
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

            const lines =
                buffer.split(/\r?\n/);

            buffer =
                lines.pop() ?? "";

            for (const line of lines) {
                const parsed =
                    this.parseSseLine(line);

                if (
                    parsed === null
                ) {
                    continue;
                }

                if (parsed === "[DONE]") {
                    finished = true;
                    break;
                }

                let chunk:
                    OpenAIStreamChunk;

                try {
                    chunk =
                        JSON.parse(parsed) as OpenAIStreamChunk;
                } catch {
                    continue;
                }

                if (chunk.model) {
                    responseModel =
                        chunk.model;
                }

                const delta =
                    chunk.choices?.[0]?.delta;

                if (!delta) {
                    continue;
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
                    break;
                }
            }
        }

        buffer +=
            decoder.decode();

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

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type":
                "application/json"
        };

        if (this.apiKey) {
            headers.Authorization =
                `Bearer ${this.apiKey}`;
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
            typeof options?.contextLength ===
            "number"
        ) {
            request.max_tokens =
                options.contextLength;
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
                            call.function.name,
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

    private parseSseLine(
        line: string
    ): string | null {
        const trimmed =
            line.trim();

        if (!trimmed) {
            return null;
        }

        if (
            trimmed ===
            "data: [DONE]"
        ) {
            return "[DONE]";
        }

        if (
            trimmed.startsWith(
                "data:"
            )
        ) {
            return trimmed
                .slice(5)
                .trim();
        }

        return null;
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
