import {
    ChatMessage,
    OllamaClient
} from "../ollama/client";

import {
    createThinkingFilter,
    extractThinking
} from "../agent/thinking";

import {
    AIChatOptions,
    AIChunkHandler,
    AIModel,
    AIProvider,
    AIResponse
} from "./types";

export class OllamaProvider implements AIProvider {
    readonly id = "ollama";
    readonly name = "Ollama";

    private readonly client: OllamaClient;

    constructor(client?: OllamaClient) {
        this.client =
            client ??
            new OllamaClient();
    }

    async isAvailable(): Promise<boolean> {
        return this.client.isAvailable();
    }

    async getModels(): Promise<AIModel[]> {
        const models =
            await this.client.getModels();

        const detailedModels =
            await Promise.all(
                models.map(async model => {
                    try {
                        const details =
                            await this.client.getModelDetails(
                                model.name
                            );

                        return {
                            id: model.name,
                            name: model.name,
                            provider: this.id,
                            size: model.size,
                            capabilities:
                                details.capabilities
                        };
                    } catch {
                        return {
                            id: model.name,
                            name: model.name,
                            provider: this.id,
                            size: model.size,
                            capabilities: []
                        };
                    }
                })
            );

        return detailedModels;
    }

    async chat(
        model: string,
        messages: ChatMessage[],
        options?: AIChatOptions
    ): Promise<AIResponse> {
        const response =
            await this.client.chat(
                model,
                messages,
                options?.tools,
                options?.maxOutputTokens,
                options?.signal
            );

        /*
         * Reasoning models can wrap their chain of thought in
         * <think> tags; never surface that as answer content.
         */
        const split = extractThinking(response.message.content);

        return {
            model: response.model,
            content: split.content,
            thinking: split.thinking,
            toolCalls:
                response.message.tool_calls,
            done: response.done
        };
    }

    async streamChat(
        model: string,
        messages: ChatMessage[],
        onChunk: AIChunkHandler,
        options?: AIChatOptions
    ): Promise<AIResponse> {
        /*
         * Reasoning models stream <think>...</think> as content
         * chunks. Filter through a stateful wrapper so tags split
         * across chunk boundaries are still caught; the user only
         * ever sees answer text.
         */
        const filter = createThinkingFilter();
        let streamedThinking = "";

        const response =
            await this.client.streamChat(
                model,
                messages,
                options?.tools,
                async chunk => {
                    const split = filter.push(chunk);

                    if (split.content) {
                        await onChunk(split.content);
                    }

                    if (split.thinking) {
                        streamedThinking += split.thinking;
                    }
                },
                options?.maxOutputTokens,
                options?.signal
            );

        const flushed = filter.flush();
        const finalSplit = extractThinking(
            response.message.content
        );

        if (flushed.content) {
            await onChunk(flushed.content);
        }

        return {
            model: response.model,
            content: finalSplit.content || flushed.content,
            thinking: finalSplit.thinking || streamedThinking || flushed.thinking,
            toolCalls:
                response.message.tool_calls,
            done: response.done
        };
    }
}
