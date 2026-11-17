/**
 * Minimal Model Context Protocol client for stdio servers (PRD FR-020).
 *
 * Implements the parts of the MCP spec the agent needs:
 * - `initialize` handshake, then `notifications/initialized`
 * - `tools/list` tool discovery
 * - `tools/call` tool execution
 *
 * The transport is newline-delimited JSON-RPC 2.0 over the server's
 * stdio. No MCP SDK dependency: the local-first build stays lean and
 * the surface is easy to audit.
 *
 * Failure model: every server runs in its own child process. Startup
 * and call timeouts reject instead of hanging the agent; a crashed
 * server is restarted lazily on the next use.
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { createInterface } from "readline";

export interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    enabled?: boolean;
}

export interface McpTool {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

export interface McpToolCallResult {
    /** Concatenated text content of the response. */
    text: string;
    isError: boolean;
}

/** Default protocol version spoken by this client. */
const PROTOCOL_VERSION = "2024-11-05";

const DEFAULT_START_TIMEOUT_MS = 10_000;

const DEFAULT_CALL_TIMEOUT_MS = 60_000;

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}

export class McpClient {
    private readonly serverName: string;

    private readonly config: McpServerConfig;

    private process?: ChildProcessWithoutNullStreams;

    private nextRequestId = 1;

    private readonly pending =
        new Map<number, PendingRequest>();

    private readonly stderrChunks: string[] = [];

    private started = false;

    private starting?: Promise<void>;

    constructor(
        serverName: string,
        config: McpServerConfig
    ) {
        this.serverName = serverName;
        this.config = config;
    }

    get isRunning(): boolean {
        return this.process?.exitCode === null &&
            this.started;
    }

    /**
     * Start the server and complete the initialize handshake.
     * Idempotent; concurrent callers share one startup.
     */
    async ensureStarted(
        timeoutMs = DEFAULT_START_TIMEOUT_MS
    ): Promise<void> {
        if (this.isRunning) {
            return;
        }

        if (this.starting) {
            return this.starting;
        }

        this.starting = this.start(timeoutMs)
            .finally(() => {
                this.starting = undefined;
            });

        return this.starting;
    }

    private async start(
        timeoutMs: number
    ): Promise<void> {
        this.cleanupProcess();

        const child = spawn(
            this.config.command,
            this.config.args ?? [],
            {
                env: {
                    ...process.env,
                    ...this.config.env
                },
                stdio: ["pipe", "pipe", "pipe"],
                windowsHide: true
            }
        );

        this.process = child;
        this.started = false;
        this.stderrChunks.length = 0;

        const stdout = createInterface({
            input: child.stdout
        });

        stdout.on("line", line => {
            this.handleLine(line);
        });

        child.stderr.on("data", chunk => {
            // Keep only the tail; stderr is used for error reporting.
            this.stderrChunks.push(String(chunk));

            if (this.stderrChunks.length > 20) {
                this.stderrChunks.shift();
            }
        });

        child.on("exit", () => {
            this.started = false;

            this.rejectAllPending(
                new Error(
                    `MCP server "${this.serverName}" exited unexpectedly.` +
                    (this.stderrChunks.length
                        ? " stderr: " + this.stderrChunks.join("").slice(-2000)
                        : "")
                )
            );
        });

        child.on("error", error => {
            this.started = false;

            this.rejectAllPending(
                new Error(
                    `MCP server "${this.serverName}" could not be started: ${error.message}`
                )
            );
        });

        try {
            await this.request(
                "initialize",
                {
                    protocolVersion: PROTOCOL_VERSION,
                    capabilities: {},
                    clientInfo: {
                        name: "localforge",
                        version: "0.0.1"
                    }
                },
                timeoutMs
            );
        } catch (error) {
            this.cleanupProcess();
            throw error;
        }

        this.notify("notifications/initialized", {});

        this.started = true;
    }

    private handleLine(
        line: string
    ): void {
        const trimmed = line.trim();

        if (!trimmed) {
            return;
        }

        let parsed: unknown;

        try {
            parsed = JSON.parse(trimmed);
        } catch {
            // Not JSON — ignore rather than fail the stream.
            return;
        }

        if (parsed === null || typeof parsed !== "object") {
            return;
        }

        const record = parsed as Record<string, unknown>;
        const id = record.id;

        if (
            typeof id !== "number" ||
            !Number.isInteger(id)
        ) {
            // Notification or malformed — nothing pending to resolve.
            return;
        }

        const pending = this.pending.get(id);

        if (!pending) {
            return;
        }

        this.pending.delete(id);
        clearTimeout(pending.timer);

        if (typeof record.error === "object" && record.error !== null) {
            const error = record.error as Record<string, unknown>;

            pending.reject(
                new Error(
                    `MCP server "${this.serverName}" returned an error: ` +
                    String(error.message ?? JSON.stringify(error))
                )
            );

            return;
        }

        pending.resolve(record.result);
    }

    private rejectAllPending(
        error: Error
    ): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }

        this.pending.clear();
    }

    private writeMessage(
        message: Record<string, unknown>
    ): void {
        if (!this.process?.stdin.writable) {
            throw new Error(
                `MCP server "${this.serverName}" is not running.`
            );
        }

        this.process.stdin.write(
            JSON.stringify(message) + "\n"
        );
    }

    private request(
        method: string,
        params: Record<string, unknown>,
        timeoutMs: number
    ): Promise<unknown> {
        const id = this.nextRequestId++;

        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);

                reject(
                    new Error(
                        `MCP server "${this.serverName}" timed out after ${timeoutMs} ms for ${method}.`
                    )
                );
            }, timeoutMs);

            this.pending.set(id, {
                resolve,
                reject,
                timer
            });

            try {
                this.writeMessage({
                    jsonrpc: "2.0",
                    id,
                    method,
                    params
                });
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private notify(
        method: string,
        params: Record<string, unknown>
    ): void {
        try {
            this.writeMessage({
                jsonrpc: "2.0",
                method,
                params
            });
        } catch {
            // Notifications are best-effort.
        }
    }

    /** Discover the tools this server exposes. */
    async listTools(
        timeoutMs = DEFAULT_CALL_TIMEOUT_MS
    ): Promise<McpTool[]> {
        await this.ensureStarted();

        const result = await this.request(
            "tools/list",
            {},
            timeoutMs
        ) as Record<string, unknown> | undefined;

        const tools = result?.tools;

        if (!Array.isArray(tools)) {
            return [];
        }

        return tools
            .filter(tool => tool !== null && typeof tool === "object")
            .map(tool => {
                const record = tool as Record<string, unknown>;

                return {
                    name:
                        typeof record.name === "string"
                            ? record.name
                            : "",
                    description:
                        typeof record.description === "string"
                            ? record.description
                            : undefined,
                    inputSchema:
                        typeof record.inputSchema === "object" &&
                        record.inputSchema !== null
                            ? record.inputSchema as Record<string, unknown>
                            : undefined
                };
            })
            .filter(tool => tool.name);
    }

    /** Invoke a tool on this server. */
    async callTool(
        toolName: string,
        args: Record<string, unknown>,
        timeoutMs = DEFAULT_CALL_TIMEOUT_MS
    ): Promise<McpToolCallResult> {
        await this.ensureStarted();

        const result = await this.request(
            "tools/call",
            {
                name: toolName,
                arguments: args
            },
            timeoutMs
        ) as Record<string, unknown> | undefined;

        const content = Array.isArray(result?.content)
            ? result?.content
            : [];

        const text = content
            .filter(
                block =>
                    block !== null &&
                    typeof block === "object" &&
                    (block as Record<string, unknown>).type === "text" &&
                    typeof (block as Record<string, unknown>).text === "string"
            )
            .map(block => (block as Record<string, unknown>).text as string)
            .join("\n");

        return {
            text,
            isError: result?.isError === true
        };
    }

    /** Terminate the server process. Safe to call repeatedly. */
    dispose(): void {
        this.rejectAllPending(
            new Error(`MCP server "${this.serverName}" was disposed.`)
        );

        this.cleanupProcess();
    }

    private cleanupProcess(): void {
        this.started = false;

        if (this.process) {
            try {
                this.process.kill();
            } catch {
                // Already gone.
            }

            this.process = undefined;
        }
    }
}
