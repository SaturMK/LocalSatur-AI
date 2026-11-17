/**
 * Aggregates the configured MCP stdio servers (PRD FR-020).
 *
 * Server configuration comes from the `localforge.mcp.servers`
 * setting: an object whose keys are server names and whose values
 * describe the command to spawn. Tools from all enabled servers are
 * exposed to the agent under namespaced names:
 *
 *     mcp__<server>__<tool>
 *
 * The namespace keeps MCP tools from colliding with built-in tools
 * and lets ToolManager dispatch them without a name registry.
 */

import * as vscode from "vscode";

import {
    McpClient,
    McpServerConfig,
    McpTool
} from "./client";

import type { AgentToolDefinition } from "../agent/tools";

const MCP_PREFIX = "mcp__";

export interface McpServerStatus {
    name: string;
    enabled: boolean;
    connected: boolean;
    toolCount: number;
    error?: string;
}

interface ServerEntry {
    client: McpClient;
    config: McpServerConfig;
}

/** Function names must match ^[a-zA-Z0-9_-]+$ for OpenAI-compatible APIs. */
function sanitizeNameSegment(
    value: string
): string {
    const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "_");

    return sanitized || "server";
}

export function mcpToolName(
    serverName: string,
    toolName: string
): string {
    return `${MCP_PREFIX}${sanitizeNameSegment(serverName)}__${sanitizeNameSegment(toolName)}`;
}

export function isMcpToolName(
    name: string
): boolean {
    return name.startsWith(MCP_PREFIX);
}

export class McpManager {
    private readonly entries =
        new Map<string, ServerEntry>();

    private refreshPromise?: Promise<void>;

    private lastStatuses: McpServerStatus[] = [];

    /** Statuses from the most recent refresh (empty before it). */
    get statuses(): McpServerStatus[] {
        return this.lastStatuses;
    }

    /** Read the configured start/call timeouts. */
    private timeouts(): {
        start: number;
        call: number;
    } {
        const configuration =
            vscode.workspace.getConfiguration("localforge.mcp");

        const start =
            configuration.get<number>("startTimeout", 10_000);

        const call =
            configuration.get<number>("callTimeout", 60_000);

        return {
            start: Number.isFinite(start) && start > 0 ? start : 10_000,
            call: Number.isFinite(call) && call > 0 ? call : 60_000
        };
    }

    /** Read configuration, replace the server set, and discover tools. */
    async refresh(): Promise<McpServerStatus[]> {
        const configuration = vscode.workspace
            .getConfiguration("localforge.mcp")
            .get<Record<string, McpServerConfig>>("servers", {});

        const names = Object.keys(configuration ?? {});

        // Dispose servers that disappeared or were disabled.
        for (const [name, entry] of this.entries) {
            const config = configuration?.[name];

            if (!config || config.enabled === false) {
                entry.client.dispose();
                this.entries.delete(name);
            }
        }

        const statuses: McpServerStatus[] = [];

        for (const name of names) {
            const config = configuration[name];

            if (!config || typeof config.command !== "string" || !config.command.trim()) {
                statuses.push({
                    name,
                    enabled: false,
                    connected: false,
                    toolCount: 0,
                    error: "Missing or invalid command."
                });
                continue;
            }

            if (config.enabled === false) {
                statuses.push({
                    name,
                    enabled: false,
                    connected: false,
                    toolCount: 0
                });
                continue;
            }

            let entry = this.entries.get(name);

            if (!entry) {
                entry = {
                    client: new McpClient(name, config),
                    config
                };
                this.entries.set(name, entry);
            }

            try {
                await entry.client.ensureStarted(this.timeouts().start);
                await entry.client.listTools(this.timeouts().call);

                statuses.push({
                    name,
                    enabled: true,
                    connected: true,
                    toolCount: 0
                });
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : String(error);

                statuses.push({
                    name,
                    enabled: true,
                    connected: false,
                    toolCount: 0,
                    error: message
                });
            }
        }

        // Fill in tool counts for connected servers.
        for (const status of statuses) {
            if (!status.connected) {
                continue;
            }

            const entry = this.entries.get(status.name);

            if (entry) {
                try {
                    status.toolCount = (
                        await entry.client.listTools(this.timeouts().call)
                    ).length;
                } catch {
                    status.connected = false;
                    status.error = "Tool discovery failed.";
                }
            }
        }

        this.lastStatuses = statuses;

        return statuses;
    }

    /**
     * Refresh once per tick; concurrent callers share the run so a
     * burst of agent turns does not spawn duplicate servers.
     */
    refreshShared(): Promise<void> {
        if (!this.refreshPromise) {
            this.refreshPromise = this.refresh()
                .then(() => undefined)
                .finally(() => {
                    this.refreshPromise = undefined;
                });
        }

        return this.refreshPromise;
    }

    /**
     * Tool definitions for all connected servers. A server that
     * failed to start contributes nothing — MCP availability must
     * never be simulated.
     */
    async getToolDefinitions(): Promise<AgentToolDefinition[]> {
        await this.refreshShared();

        const definitions: AgentToolDefinition[] = [];

        for (const [name, entry] of this.entries) {
            let tools: McpTool[];

            try {
                tools = await entry.client.listTools(this.timeouts().call);
            } catch {
                // Server down — skip silently; refresh() reports it.
                continue;
            }

            for (const tool of tools) {
                const schema = tool.inputSchema;

                const parameters:
                    AgentToolDefinition["function"]["parameters"] =
                    schema &&
                    schema.type === "object" &&
                    typeof schema.properties === "object" &&
                    schema.properties !== null
                        ? {
                            type: "object",
                            properties:
                                schema.properties as Record<string, unknown>,
                            required: Array.isArray(schema.required)
                                ? schema.required.filter(
                                    (entry): entry is string =>
                                        typeof entry === "string"
                                )
                                : undefined
                        }
                        : {
                            type: "object",
                            properties: {}
                        };

                definitions.push({
                    type: "function",
                    function: {
                        name: mcpToolName(name, tool.name),
                        description:
                            (tool.description ?? "MCP tool") +
                            ` (MCP server: ${name}, tool: ${tool.name})`,
                        parameters
                    }
                });
            }
        }

        return definitions;
    }

    /** Execute a namespaced MCP tool. */
    async executeTool(
        namespacedName: string,
        args: Record<string, unknown>,
        signal?: AbortSignal
    ): Promise<string> {
        const withoutPrefix = namespacedName.slice(MCP_PREFIX.length);
        const separatorIndex = withoutPrefix.indexOf("__");

        if (separatorIndex === -1) {
            throw new Error(
                `Invalid MCP tool name: ${namespacedName}`
            );
        }

        const serverName = withoutPrefix.slice(0, separatorIndex);
        const toolName = withoutPrefix.slice(separatorIndex + 2);

        const entry = this.entries.get(serverName);

        if (!entry) {
            throw new Error(
                `MCP server "${serverName}" is not configured or not connected.`
            );
        }

        if (signal?.aborted) {
            throw new Error("The agent request was canceled.");
        }

        const result = await entry.client.callTool(
            toolName,
            args,
            this.timeouts().call
        );

        if (result.isError) {
            throw new Error(
                `MCP tool ${toolName} on "${serverName}" reported an error: ${result.text}`
            );
        }

        return result.text;
    }

    dispose(): void {
        for (const entry of this.entries.values()) {
            entry.client.dispose();
        }

        this.entries.clear();
    }
}
