/**
 * Session management for the chat view (PRD FR-012).
 *
 * A session is a named snapshot of one conversation: its message
 * history and the files the agent changed during it. Sessions are
 * persisted in workspaceState; the webview can list, switch, and
 * delete them.
 */

import { ChatMessage } from "../ollama/client";

import {
    ChangedFileEntry,
    isChangedFileEntry
} from "./changed-files";

export interface ChatSessionSnapshot {
    id: string;

    /** Derived from the first user message; updated as the chat grows. */
    title: string;

    createdAt: number;
    updatedAt: number;

    messages: ChatMessage[];
    changedFiles: ChangedFileEntry[];
}

export interface SessionSummary {
    id: string;
    title: string;
    updatedAt: number;
    messageCount: number;
    changedFileCount: number;
    active: boolean;
}

/** Maximum number of sessions kept in workspaceState. */
export const MAX_SESSIONS = 20;

/** Maximum messages retained per session. */
export const MAX_SESSION_MESSAGES = 40;

export function isValidChatMessage(
    value: unknown
): value is ChatMessage {
    return typeof value === "object" &&
        value !== null &&
        ((value as ChatMessage).role === "user" ||
            (value as ChatMessage).role === "assistant") &&
        typeof (value as ChatMessage).content === "string";
}

/**
 * Deserialize and sanitize a persisted session list. Anything
 * malformed is dropped rather than trusted.
 */
export function sanitizeSessions(
    value: unknown
): ChatSessionSnapshot[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const sessions: ChatSessionSnapshot[] = [];

    for (const raw of value) {
        if (raw === null || typeof raw !== "object") {
            continue;
        }

        const record = raw as Record<string, unknown>;

        if (
            typeof record.id !== "string" ||
            record.id.trim() === "" ||
            typeof record.title !== "string" ||
            typeof record.createdAt !== "number" ||
            typeof record.updatedAt !== "number"
        ) {
            continue;
        }

        const messages = Array.isArray(record.messages)
            ? record.messages.filter(isValidChatMessage)
            : [];

        const changedFiles = Array.isArray(record.changedFiles)
            ? record.changedFiles.filter(isChangedFileEntry)
            : [];

        sessions.push({
            id: record.id,
            title: record.title,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            messages: messages.slice(-MAX_SESSION_MESSAGES),
            changedFiles
        });
    }

    sessions.sort((a, b) => a.updatedAt - b.updatedAt);

    return sessions.slice(-MAX_SESSIONS);
}

/** Derive a display title from the first user message of a session. */
export function sessionTitleFromMessage(
    content: string
): string {
    const firstLine =
        content
            .split(/\r?\n/)
            .map(line => line.trim())
            .find(line => line.length > 0) ?? "";

    const collapsed = firstLine.replace(/\s+/g, " ");

    if (!collapsed) {
        return "New session";
    }

    return collapsed.length > 48
        ? collapsed.slice(0, 48).trimEnd() + "…"
        : collapsed;
}

/** Compact summaries for the webview, most recently updated first. */
export function summarizeSessions(
    sessions: ChatSessionSnapshot[],
    activeSessionId: string
): SessionSummary[] {
    return [...sessions]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(session => ({
            id: session.id,
            title: session.title,
            updatedAt: session.updatedAt,
            messageCount: session.messages.length,
            changedFileCount: session.changedFiles.length,
            active: session.id === activeSessionId
        }));
}
