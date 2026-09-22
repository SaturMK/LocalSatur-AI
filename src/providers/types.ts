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
    tools?: OllamaTool[];
}

export interface AIResponse {
    model: string;
    content: string;
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