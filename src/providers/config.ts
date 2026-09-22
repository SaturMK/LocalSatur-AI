export interface AIProviderConfig {
    id: string;
    name: string;
    type: "ollama" | "openai-compatible";
    baseUrl?: string;
    apiKeySetting?: string;
    enabled: boolean;
}

export const DEFAULT_PROVIDER_CONFIGS:
    AIProviderConfig[] = [
    {
        id: "ollama",
        name: "Ollama",
        type: "ollama",
        enabled: true
    },
    {
        id: "openrouter",
        name: "OpenRouter",
        type: "openai-compatible",
        baseUrl:
            "https://openrouter.ai/api/v1",
        apiKeySetting:
            "localforge.providers.openrouter.apiKey",
        enabled: true
    },
    {
        id: "nvidia",
        name: "NVIDIA NIM",
        type: "openai-compatible",
        baseUrl:
            "https://integrate.api.nvidia.com/v1",
        apiKeySetting:
            "localforge.providers.nvidia.apiKey",
        enabled: true
    },
    {
        id: "requesty",
        name: "Requesty",
        type: "openai-compatible",
        baseUrl:
            "https://router.requesty.ai/v1",
        apiKeySetting:
            "localforge.providers.requesty.apiKey",
        enabled: true
    }
];

export function getProviderConfig(
    providerId: string
): AIProviderConfig | undefined {
    return DEFAULT_PROVIDER_CONFIGS.find(
        provider =>
            provider.id === providerId
    );
}