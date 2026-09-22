import * as vscode from "vscode";

import {
    OllamaProvider
} from "./ollama-provider";

import {
    OpenAICompatibleProvider
} from "./openai-compatible-provider";

import {
    AIProvider
} from "./types";

import {
    DEFAULT_PROVIDER_CONFIGS,
    AIProviderConfig
} from "./config";

export class AIProviderManager {
    private readonly providers =
        new Map<string, AIProvider>();

    private activeProviderId =
        "ollama";

    constructor(
        providers: AIProvider[] = []
    ) {
        this.register(
            new OllamaProvider()
        );

        this.registerConfiguredProviders();

        for (
            const provider
            of providers
        ) {
            this.register(provider);
        }

        const configuredProvider =
            vscode.workspace
                .getConfiguration(
                    "localforge"
                )
                .get<string>(
                    "provider",
                    "ollama"
                );

        if (
            this.providers.has(
                configuredProvider
            )
        ) {
            this.activeProviderId =
                configuredProvider;
        }
    }

    private registerConfiguredProviders():
        void {
        for (
            const config
            of DEFAULT_PROVIDER_CONFIGS
        ) {
            if (
                !config.enabled ||
                config.type !==
                    "openai-compatible"
            ) {
                continue;
            }

            const provider =
                this.createOpenAIProvider(
                    config
                );

            if (provider) {
                this.register(provider);
            }
        }
    }

    private createOpenAIProvider(
        config: AIProviderConfig
    ): AIProvider | undefined {
        if (!config.baseUrl) {
            return undefined;
        }

        let apiKey:
            string | undefined;

        if (
            config.apiKeySetting
        ) {
            apiKey =
                vscode.workspace
                    .getConfiguration(
                        "localforge"
                    )
                    .get<string>(
                        config.apiKeySetting
                    );
        }

        return new OpenAICompatibleProvider({
            id: config.id,
            name: config.name,
            baseUrl: config.baseUrl,
            apiKey
        });
    }

    register(
        provider: AIProvider
    ): void {
        this.providers.set(
            provider.id,
            provider
        );

        if (
            !this.activeProviderId ||
            !this.providers.has(
                this.activeProviderId
            )
        ) {
            this.activeProviderId =
                provider.id;
        }
    }

    unregister(
        providerId: string
    ): void {
        this.providers.delete(
            providerId
        );

        if (
            this.activeProviderId ===
            providerId
        ) {
            const firstProvider =
                this.providers
                    .values()
                    .next()
                    .value as
                    | AIProvider
                    | undefined;

            this.activeProviderId =
                firstProvider?.id ??
                "";
        }
    }

    getProvider(
        providerId: string
    ): AIProvider | undefined {
        return this.providers.get(
            providerId
        );
    }

    getActiveProvider():
        AIProvider | undefined {
        return this.getProvider(
            this.activeProviderId
        );
    }

    getActiveProviderId():
        string {
        return this.activeProviderId;
    }

    setActiveProvider(
        providerId: string
    ): void {
        if (
            !this.providers.has(
                providerId
            )
        ) {
            throw new Error(
                `Provider not registered: ${providerId}`
            );
        }

        this.activeProviderId =
            providerId;
    }

    getProviders():
        AIProvider[] {
        return Array.from(
            this.providers.values()
        );
    }

    hasProvider(
        providerId: string
    ): boolean {
        return this.providers.has(
            providerId
        );
    }
}