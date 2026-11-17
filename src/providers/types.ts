import {
    ChatMessage,
    OllamaTool,
    OllamaToolCall
} from "../ollama/client";

export interface AIModel {
    id: string;
    name: string;
    provider: string;
    size?: number;
    capabilities?: string[];
}

export interface AIChatOptions {
    temperature?: number;
    contextLength?: number;
    maxOutputTokens?: number;
    tools?: OllamaTool[];
    /** Cancels an in-flight HTTP request or streamed response. */
    signal?: AbortSignal;
}

export interface AIResponse {
    model: string;
    content: string;
    /**
     * Chain-of-thought text emitted by reasoning models, removed
     * from `content`. Undefined when the model emitted none.
     */
    thinking?: string;
    toolCalls?: OllamaToolCall[];
    done: boolean;
}

export type AIChunkHandler = (
    chunk: string
) => void | Promise<void>;

export interface AIProvider {
    readonly id: string;
    readonly name: string;

    isAvailable(): Promise<boolean>;

    getModels(): Promise<AIModel[]>;

    chat(
        model: string,
        messages: ChatMessage[],
        options?: AIChatOptions
    ): Promise<AIResponse>;

    streamChat(
        model: string,
        messages: ChatMessage[],
        onChunk: AIChunkHandler,
        options?: AIChatOptions
    ): Promise<AIResponse>;
}
