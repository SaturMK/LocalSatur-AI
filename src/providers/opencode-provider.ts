/**
 * OpenCode CLI provider.
 *
 * Delegates chat generation to the `opencode` CLI (`opencode run`),
 * which runs its own local agent with its own workspace tools and
 * permission model. Unlike the Ollama/OpenAI providers, this is a
 * DELEGATED agent: the extension does not supply tool definitions
 * and the CLI never returns OpenAI-style tool_calls. Workspace
 * inspection and file operations are performed by the OpenCode
 * agent itself; its plain-text reply is streamed back as chat
 * content.
 *
 * The provider never simulates availability: when the CLI is not
 * installed, isAvailable() is false and the UI surfaces it as
 * unavailable.
 */

import {
    spawn,
    ChildProcess
} from "child_process";

import * as vscode from "vscode";

import {
    ChatMessage
} from "../ollama/client";

import {
    AIChatOptions,
    AIChunkHandler,
    AIModel,
    AIProvider,
    AIResponse
} from "./types";

/** How the CLI is invoked for a chat request. */
interface OpenCodeInvocation {
    args: string[];

    /** Prompt text written to the child's stdin. */
    prompt: string;
}

export function parseOpencodeModels(
    stdout: string
): string[] {

    const models = new Set<string>();

    for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();

        // Lines are "provider/model", optionally with annotations
        // after whitespace; require a sane id shape before use.
        const match = trimmed.match(/^([a-zA-Z0-9._-]+\/[a-zA-Z0-9._:-]+)$/);

        if (match) {
            models.add(match[1]);
        }
    }

    return Array.from(models).sort();
}

/**
 * Serialize the extension's message transcript into a single
 * prompt for `opencode run`, which accepts one message.
 */
export function buildOpencodePrompt(
    messages: ChatMessage[]
): string {

    const parts: string[] = [];

    for (const message of messages) {
        if (message.role === "system") {
            parts.push("[Instructions]\n" + message.content);
        } else if (message.role === "user") {
            parts.push("[User]\n" + message.content);
        } else if (message.role === "assistant") {
            parts.push("[Assistant]\n" + message.content);
        } else {
            // Tool-role history is not applicable to the CLI.
            continue;
        }
    }

    parts.push(
        "Continue this conversation as the assistant. Reply with the assistant's response only."
    );

    // Safety cap for CLI argument length limits.
    return parts.join("\n\n").slice(-120_000);
}

export class OpenCodeProvider implements AIProvider {
    readonly id = "opencode";

    readonly name = "OpenCode CLI";

    /**
     * The CLI runs its own agent with its own tools; the extension
     * does not pass tool definitions (see the engine).
     */
    readonly delegatedAgent = true;

    private readonly cliPath: string;

    constructor(cliPath?: string) {
        this.cliPath =
            cliPath ??
            vscode.workspace
                .getConfiguration("localforge.opencode")
                .get<string>("cliPath", "opencode");
    }

    async isAvailable(): Promise<boolean> {
        try {
            await this.exec(
                ["--version"],
                10_000
            );

            return true;
        } catch {
            return false;
        }
    }

    async getModels(): Promise<AIModel[]> {
        const configured =
            vscode.workspace
                .getConfiguration("localforge.opencode")
                .get<string>("model", "")
                ?.trim();

        if (configured) {
            return [
                {
                    id: configured,
                    name: configured,
                    provider: this.id,
                    capabilities: []
                }
            ];
        }

        try {
            const stdout =
                await this.exec(["models"], 15_000);

            const parsed =
                parseOpencodeModels(stdout);

            if (parsed.length > 0) {
                return parsed.map(model => ({
                    id: model,
                    name: model,
                    provider: this.id,
                    capabilities: []
                }));
            }
        } catch {
            // CLI missing or listing failed; fall through to the
            // default entry below.
        }

        /*
         * The CLI always has a configured default model; expose it
         * under an explicit id rather than inventing model names.
         */
        return [
            {
                id: "default",
                name: "Default (opencode config)",
                provider: this.id,
                capabilities: []
            }
        ];
    }

    async chat(
        model: string,
        messages: ChatMessage[],
        options?: AIChatOptions
    ): Promise<AIResponse> {
        return this.streamChat(
            model,
            messages,
            () => undefined,
            options
        );
    }

    async streamChat(
        model: string,
        messages: ChatMessage[],
        onChunk: AIChunkHandler,
        options?: AIChatOptions
    ): Promise<AIResponse> {
        const invocation =
            this.buildInvocation(
                model,
                messages
            );

        const timeoutMs =
            this.timeoutMs();

        let child: ChildProcess;

        try {
            child = spawn(
                this.cliPath,
                invocation.args,
                {
                    shell: process.platform === "win32",
                    windowsHide: true,
                    stdio: ["pipe", "pipe", "pipe"]
                }
            );
        } catch (error) {
            throw new Error(
                `Could not start the OpenCode CLI ("${this.cliPath}"): ` +
                (error instanceof Error ? error.message : String(error)) +
                ". Install it or set localforge.opencode.cliPath to the full path."
            );
        }

        /*
         * The prompt goes through stdin, never argv: the CLI reads
         * the message from stdin and this keeps transcript text out
         * of the shell command line entirely.
         */
        child.stdin?.end(invocation.prompt, "utf8");

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: string[] = [];

        let settled = false;

        return await new Promise<AIResponse>((resolve, reject) => {
            const finish = (
                action: () => void
            ): void => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timer);
                action();
            };

            const timer = setTimeout(() => {
                try {
                    child.kill();
                } catch {
                    // Already gone.
                }

                finish(() =>
                    reject(
                        new Error(
                            `The OpenCode CLI timed out after ${Math.round(timeoutMs / 1000)}s.`
                        )
                    )
                );
            }, timeoutMs);

            options?.signal?.addEventListener("abort", () => {
                try {
                    child.kill();
                } catch {
                    // Already gone.
                }

                finish(() =>
                    reject(
                        new Error("The agent request was canceled.")
                    )
                );
            });

            child.stdout?.on("data", (chunk: Buffer) => {
                const text = chunk.toString("utf8");
                stdoutChunks.push(chunk);

                void onChunk(text);
            });

            child.stderr?.on("data", (chunk: Buffer) => {
                // Keep only the tail for error reporting.
                stderrChunks.push(chunk.toString("utf8"));

                if (stderrChunks.length > 20) {
                    stderrChunks.shift();
                }
            });

            child.on("error", error => {
                finish(() =>
                    reject(
                        new Error(
                            `The OpenCode CLI ("${this.cliPath}") failed: ${error.message}`
                        )
                    )
                );
            });

            child.on("exit", code => {
                finish(() => {
                    if (code !== 0) {
                        const stderr = stderrChunks
                            .join("")
                            .trim()
                            .slice(-2000);

                        reject(
                            new Error(
                                `The OpenCode CLI exited with code ${code}` +
                                (stderr ? `: ${stderr}` : ".")
                            )
                        );

                        return;
                    }

                    resolve({
                        model,
                        content:
                            Buffer.concat(stdoutChunks).toString("utf8"),
                        done: true
                    });
                });
            });
        });
    }

    // ================================================================
    // INTERNALS
    // ================================================================

    private timeoutMs(): number {
        const seconds =
            vscode.workspace
                .getConfiguration("localforge.opencode")
                .get<number>("timeoutSeconds", 300);

        return Number.isFinite(seconds) && seconds > 0
            ? seconds * 1000
            : 300_000;
    }

    private buildInvocation(
        model: string,
        messages: ChatMessage[]
    ): OpenCodeInvocation {

        const args = ["run"];

        /*
         * The model id reaches a shell (Windows spawns through
         * cmd.exe), so only well-formed ids are passed. Anything
         * else falls back to the CLI's configured default.
         */
        if (model && model !== "default" && /^[a-zA-Z0-9._:#-]+\/[a-zA-Z0-9._:#-]+$/.test(model)) {
            args.push("--model", model);
        }

        return {
            args,
            prompt: buildOpencodePrompt(messages)
        };
    }

    private exec(
        args: string[],
        timeoutMs: number
    ): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let child: ChildProcess;

            try {
                child = spawn(
                    this.cliPath,
                    args,
                    {
                        shell: process.platform === "win32",
                        windowsHide: true,
                        stdio: ["ignore", "pipe", "pipe"]
                    }
                );
            } catch (error) {
                reject(
                    error instanceof Error
                        ? error
                        : new Error(String(error))
                );

                return;
            }

            const stdoutChunks: Buffer[] = [];
            const stderrChunks: string[] = [];

            const timer = setTimeout(() => {
                try {
                    child.kill();
                } catch {
                    // Already gone.
                }

                reject(
                    new Error(
                        `The OpenCode CLI timed out after ${Math.round(timeoutMs / 1000)}s.`
                    )
                );
            }, timeoutMs);

            child.stdout?.on("data", (chunk: Buffer) => {
                stdoutChunks.push(chunk);
            });

            child.stderr?.on("data", (chunk: Buffer) => {
                stderrChunks.push(chunk.toString("utf8"));
            });

            child.on("error", error => {
                clearTimeout(timer);
                reject(error);
            });

            child.on("exit", code => {
                clearTimeout(timer);

                if (code !== 0) {
                    reject(
                        new Error(
                            `The OpenCode CLI exited with code ${code}: ` +
                            stderrChunks.join("").trim().slice(-1000)
                        )
                    );

                    return;
                }

                resolve(
                    Buffer.concat(stdoutChunks).toString("utf8")
                );
            });
        });
    }
}
