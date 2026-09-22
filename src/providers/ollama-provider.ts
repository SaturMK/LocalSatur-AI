import {
    ChatMessage,
    OllamaClient
} from "../ollama/client";

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
                options?.tools
            );

        return {
            model: response.model,
            content: response.message.content,
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
        const response =
            await this.client.streamChat(
                model,
                messages,
                options?.tools,
                onChunk
            );

        return {
            model: response.model,
            content: response.message.content,
            toolCalls:
                response.message.tool_calls,
            done: response.done
        };
    }
}
