import * as vscode from "vscode";

/**
 * Access point for provider API keys stored in VS Code SecretStorage.
 *
 * API keys must never be written to settings.json (plaintext, often
 * committed to source control). This store keeps them in the encrypted
 * secret storage of the VS Code profile instead.
 *
 * Legacy plaintext settings are still read as a read-only fallback so
 * existing configurations keep working until the user re-saves the key.
 */
export class ApiKeyStore {
    private static secrets?: vscode.SecretStorage;

    private static storageKey(providerId: string): string {
        return `localforge.apiKey.${providerId}`;
    }

    /** Initialize with the extension context secret storage. Call once in activate(). */
    static init(secrets: vscode.SecretStorage): void {
        this.secrets = secrets;
    }

    static async get(providerId: string): Promise<string | undefined> {
        if (!this.secrets) {
            return undefined;
        }

        const value = await this.secrets.get(this.storageKey(providerId));
        const trimmed = value?.trim();

        return trimmed ? trimmed : undefined;
    }

    static async set(providerId: string, value: string): Promise<void> {
        if (!this.secrets) {
            throw new Error("SecretStorage is not initialized.");
        }

        await this.secrets.store(this.storageKey(providerId), value.trim());
    }

    static async delete(providerId: string): Promise<void> {
        if (!this.secrets) {
            return;
        }

        await this.secrets.delete(this.storageKey(providerId));
    }
}
