/**
 * LocalSatur AI webview UI.
 *
 * Implements the PRD v1.0 design system and application shell:
 * - Design tokens (PRD 5.2), app header and Ask/Plan/Agent navigation (7.1)
 * - Provider/model configuration bar with filtering and states (7.2)
 * - Ask workspace messages with Markdown-style code blocks and timestamps (7.3)
 * - Agent activity timeline with expandable details (7.5)
 * - Prompt composer with attachments, drag-and-drop and paste (7.7)
 * - Workspace file dashboard modal
 * - Empty and error states (11)
 *
 * The message contract with the extension host is unchanged.
 */

export function getChatHtml(
    nonce: string,
    markdownScriptUri: string
): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">

    <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data:;"
    >

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>LocalSatur AI</title>

    <style>
        /* =========================================
           DESIGN TOKENS (PRD 5.2)
           ========================================= */

        :root {
            --bg: #111419;
            --card: #1D222B;
            --surface: #252B35;
            --primary: #0788F9;
            --bright: #159DFF;
            --success: #45E879;
            --danger: #FF5656;
            --text: #F4F6FA;
            --muted: #AAB4C3;
            --border: #394351;

            --radius-card: 16px;
            --radius-button: 10px;
            --radius-input: 12px;

            --space-1: 4px;
            --space-2: 8px;
            --space-3: 12px;
            --space-4: 16px;
            --space-5: 20px;

            --font: "Inter", -apple-system, "Segoe UI", sans-serif;
            --mono: Consolas, "Cascadia Code", monospace;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 0;

            background: var(--bg);
            color: var(--text);
            font-family: var(--font);
            font-size: 14px;
            line-height: 1.5;
        }

        button,
        input,
        select,
        textarea {
            font-family: inherit;
            font-size: inherit;
            color: inherit;
        }

        :focus-visible {
            outline: 2px solid var(--bright);
            outline-offset: 2px;
        }

        .hidden {
            display: none !important;
        }

        /* =========================================
           APP SHELL (PRD 7.1)
           ========================================= */

        .app {
            display: flex;
            flex-direction: column;

            height: 100vh;
            min-height: 0;
        }

        .header {
            display: flex;
            align-items: center;
            gap: var(--space-3);

            padding: var(--space-3) var(--space-4);

            border-bottom: 1px solid var(--border);
            background: var(--card);
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 10px;

            flex: 1;
            min-width: 0;
        }

        .brand-mark {
            width: 30px;
            height: 30px;
            flex: 0 0 auto;

            display: flex;
            align-items: center;
            justify-content: center;

            border-radius: 9px;
            background: linear-gradient(135deg, var(--primary), var(--bright));

            color: #FFFFFF;
            font-size: 14px;
            font-weight: 700;
        }

        .brand-name {
            font-size: 16px;
            font-weight: 700;
            letter-spacing: -0.2px;
        }

        .brand-subtitle {
            font-size: 11px;
            color: var(--muted);
        }

        /* =========================================
           STATUS PILL (PRD 5.1)
           ========================================= */

        .status {
            display: inline-flex;
            align-items: center;
            gap: 6px;

            padding: 4px 10px;

            border: 1px solid var(--border);
            border-radius: 999px;
            background: var(--surface);

            color: var(--muted);
            font-size: 11px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 260px;
        }

        .status::before {
            content: "";
            width: 7px;
            height: 7px;
            flex: 0 0 auto;

            border-radius: 50%;
            background: var(--muted);
        }

        .status.ok::before {
            background: var(--success);
        }

        .status.busy::before {
            background: var(--bright);
        }

        .status.warn::before {
            background: #E8C545;
        }

        .status.error::before {
            background: var(--danger);
        }

        /* =========================================
           MODE NAVIGATION (PRD 7.1, FR-002)
           ========================================= */

        .mode-nav {
            display: flex;
            gap: var(--space-2);

            padding: var(--space-2) var(--space-4) 0;
            background: var(--card);
        }

        .mode-tab {
            padding: 8px 16px;

            border: 1px solid transparent;
            border-bottom: 0;
            border-radius: var(--radius-button) var(--radius-button) 0 0;
            background: transparent;

            color: var(--muted);
            font-size: 13px;
            font-weight: 600;

            cursor: pointer;
        }

        .mode-tab:hover {
            color: var(--text);
            background: var(--surface);
        }

        .mode-tab.active {
            color: #FFFFFF;
            background: var(--bg);
            border-color: var(--border);

            box-shadow: inset 0 2px 0 var(--primary);
        }

        /* Hidden state holder for the authoritative mode value. */
        .visually-hidden {
            position: absolute;

            width: 1px;
            height: 1px;

            overflow: hidden;

            clip: rect(0 0 0 0);
            clip-path: inset(50%);

            border: 0;
            margin: -1px;
            padding: 0;

            white-space: nowrap;
        }

        /* =========================================
           CONFIG BAR (PRD 7.2, FR-003..005)
           ========================================= */

        .config-bar {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);

            padding: var(--space-3) var(--space-4);

            border-bottom: 1px solid var(--border);
            background: var(--bg);
        }

        .config-row {
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .config-field {
            display: flex;
            align-items: center;
            gap: 6px;

            flex: 1;
            min-width: 0;
        }

        .config-field label {
            font-size: 11px;
            color: var(--muted);
            white-space: nowrap;
        }

        select {
            flex: 1;
            min-width: 0;

            padding: 6px 8px;

            border: 1px solid var(--border);
            border-radius: var(--radius-input);
            background: var(--surface);
            color: var(--text);

            cursor: pointer;
        }

        select:disabled {
            opacity: 0.5;
            cursor: default;
        }

        #model-filter {
            flex: 1;

            padding: 6px 10px;

            border: 1px solid var(--border);
            border-radius: var(--radius-input);
            background: var(--surface);
            color: var(--text);
        }

        /* =========================================
           BUTTONS (PRD 5.3)
           ========================================= */

        button {
            padding: 7px 14px;

            border: 0;
            border-radius: var(--radius-button);
            background: var(--surface);

            color: var(--text);
            font-size: 13px;

            cursor: pointer;
        }

        button:hover {
            background: #2E3542;
        }

        button:disabled {
            opacity: 0.45;
            cursor: default;
        }

        button.primary {
            background: var(--primary);
            color: #FFFFFF;
        }

        button.primary:hover:not(:disabled) {
            background: var(--bright);
        }

        button.danger {
            background: rgba(255, 86, 86, 0.16);
            color: var(--danger);
            border: 1px solid rgba(255, 86, 86, 0.4);
        }

        button.danger:hover:not(:disabled) {
            background: rgba(255, 86, 86, 0.26);
        }

        button.icon {
            padding: 6px 10px;
        }

        /* =========================================
           MESSAGES (PRD 7.3, FR-008)
           ========================================= */

        .messages {
            flex: 1;
            min-height: 0;

            overflow-y: auto;
            padding: var(--space-4);
        }

        .message {
            max-width: 92%;

            margin-bottom: var(--space-4);
            padding: var(--space-3) var(--space-4);

            border: 1px solid var(--border);
            border-radius: var(--radius-card);
            background: var(--card);

            overflow-wrap: anywhere;
        }

        .message.user {
            margin-left: auto;
            border-color: rgba(7, 136, 249, 0.5);
        }

        .message.assistant {
            margin-right: auto;
        }

        .message.error {
            margin-right: auto;
            border-color: rgba(255, 86, 86, 0.55);
            background: rgba(255, 86, 86, 0.08);
        }

        .message-head {
            display: flex;
            align-items: baseline;
            gap: var(--space-2);

            margin-bottom: 6px;
        }

        .message-role {
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--bright);
        }

        .message.user .message-role {
            color: var(--primary);
        }

        .message.error .message-role {
            color: var(--danger);
        }

        .message-time {
            font-size: 10px;
            color: var(--muted);
        }

        .message-body div {
            white-space: pre-wrap;
        }

        /* Welcome / empty state (PRD 11) */

        .welcome {
            max-width: 100%;

            border-style: dashed;
        }

        .welcome-title {
            font-size: 15px;
            font-weight: 700;
            margin-bottom: 6px;
        }

        .welcome-text {
            color: var(--muted);
            white-space: pre-wrap;
            margin-bottom: var(--space-3);
        }

        .welcome-actions {
            display: flex;
            gap: var(--space-2);
            flex-wrap: wrap;
        }

        /* =========================================
           CODE BLOCKS (PRD 7.3, FR-008)
           ========================================= */

        .code-block {
            position: relative;

            margin: var(--space-2) 0;
            padding: var(--space-3);

            border: 1px solid var(--border);
            border-radius: var(--radius-button);
            background: #0C0F13;

            overflow: auto;
        }

        .code-block code {
            font-family: var(--mono);
            font-size: 12.5px;
            white-space: pre;
        }

        .copy-code {
            float: right;

            margin-left: var(--space-2);
            margin-bottom: var(--space-1);
            padding: 3px 8px;

            font-size: 10px;
        }

        /* =========================================
           MARKDOWN CONTENT (PRD 7.3, FR-008)
           ========================================= */

        .message-body p {
            margin: 0 0 var(--space-2);
        }

        .message-body h1,
        .message-body h2,
        .message-body h3,
        .message-body h4,
        .message-body h5,
        .message-body h6 {
            margin: var(--space-3) 0 var(--space-2);
            font-weight: 700;
        }

        .message-body h1 { font-size: 16px; }
        .message-body h2 { font-size: 15px; }
        .message-body h3 { font-size: 14px; }
        .message-body h4,
        .message-body h5,
        .message-body h6 { font-size: 13px; }

        .message-body ul,
        .message-body ol {
            margin: 0 0 var(--space-2);
            padding-left: 20px;
        }

        .message-body li {
            margin: 2px 0;
        }

        .message-body blockquote {
            margin: var(--space-2) 0;
            padding: var(--space-1) var(--space-3);

            border-left: 3px solid var(--border);
            color: var(--muted);
        }

        .message-body a {
            color: var(--bright);
        }

        .inline-code {
            padding: 1px 5px;

            border: 1px solid var(--border);
            border-radius: 4px;
            background: #0C0F13;

            font-family: var(--mono);
            font-size: 12px;
        }

        .message-body hr {
            margin: var(--space-3) 0;

            border: none;
            border-top: 1px solid var(--border);
        }

        /* =========================================
           ACTIVITY TIMELINE (PRD 7.5, FR-013)
           ========================================= */

        .activity {
            margin: var(--space-2) 0;
            padding: 8px 12px;

            border-left: 3px solid var(--primary);
            border-radius: 6px;
            background: var(--surface);

            font-size: 12px;
            color: var(--muted);
        }

        .activity-label {
            color: var(--text);
            font-weight: 600;
        }

        .activity-detail {
            margin-top: 4px;

            font-family: var(--mono);
            font-size: 11px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        .activity-detail.collapsed {
            max-height: 84px;
            overflow: hidden;
        }

        .activity-toggle {
            margin-top: 4px;
            padding: 2px 8px;

            font-size: 10px;
        }

        /* =========================================
           PROPOSALS (PRD 7.5, FR-015/016)
           ========================================= */

        .proposal {
            margin: var(--space-3) 0;
            padding: var(--space-3) var(--space-4);

            border: 1px solid rgba(7, 136, 249, 0.55);
            border-radius: var(--radius-card);
            background: var(--card);

            max-width: 92%;
        }

        .proposal-title {
            font-weight: 700;
            margin-bottom: 4px;
            color: var(--bright);
        }

        .proposal-path {
            font-family: var(--mono);
            font-size: 12px;

            margin-bottom: 4px;
            overflow-wrap: anywhere;
        }

        .proposal-reason {
            font-size: 13px;
            color: var(--muted);

            margin-bottom: var(--space-3);
        }

        .proposal .buttons {
            display: flex;
            gap: var(--space-2);
            flex-wrap: wrap;
        }

        /* =========================================
           PLAN CARDS (PRD FR-010)
           ========================================= */

        .plan-card {
            margin: var(--space-3) 0;
            padding: var(--space-3) var(--space-4);

            border: 1px solid rgba(69, 232, 121, 0.45);
            border-radius: var(--radius-card);
            background: var(--card);

            max-width: 92%;
        }

        .plan-title {
            font-weight: 700;
            margin-bottom: 4px;
            color: var(--success);
        }

        .plan-summary {
            font-size: 13px;
            color: var(--text);
            margin-bottom: var(--space-3);
        }

        .plan-steps {
            list-style: none;
            margin: 0 0 var(--space-2);
            padding: 0;

            display: flex;
            flex-direction: column;
            gap: var(--space-2);
        }

        .plan-step {
            display: flex;
            gap: var(--space-2);
            align-items: baseline;
        }

        .plan-step-number {
            font-family: var(--mono);
            font-size: 11px;
            color: var(--muted);
        }

        .plan-step-title {
            font-size: 13px;
        }

        .plan-action-chip {
            padding: 1px 7px;

            border-radius: 999px;
            border: 1px solid var(--border);
            background: var(--surface);

            font-size: 10px;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }

        .plan-action-chip.action-create { color: var(--success); border-color: rgba(69, 232, 121, 0.5); }
        .plan-action-chip.action-edit { color: var(--bright); border-color: rgba(21, 157, 255, 0.5); }
        .plan-action-chip.action-delete { color: var(--danger); border-color: rgba(255, 86, 86, 0.5); }

        .plan-files {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-1) var(--space-2);
            margin-top: 2px;
        }

        .plan-file {
            font-family: var(--mono);
            font-size: 11px;
            color: var(--muted);
            overflow-wrap: anywhere;
        }

        .plan-risks {
            margin: var(--space-2) 0;
            padding-left: 18px;

            font-size: 12px;
            color: var(--muted);
        }

        .plan-card .buttons {
            display: flex;
            gap: var(--space-2);
            flex-wrap: wrap;
            margin-top: var(--space-2);
        }

        /* =========================================
           CHANGED FILES (PRD FR-011)
           ========================================= */

        .changes-panel {
            padding: var(--space-2) var(--space-4);

            border-bottom: 1px solid var(--border);
            background: var(--card);
        }

        .changes-panel-title {
            font-size: 11px;
            font-weight: 700;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: var(--space-1);
        }

        .changes-list {
            display: flex;
            flex-direction: column;
        }

        .changes-row {
            display: flex;
            align-items: center;
            gap: var(--space-2);

            padding: 4px 2px;

            border: 0;
            border-radius: var(--radius-button);
            background: transparent;

            font-size: 12px;
            text-align: left;
        }

        .changes-row:hover {
            background: var(--surface);
        }

        .changes-op {
            padding: 1px 7px;

            border-radius: 999px;
            border: 1px solid var(--border);
            background: var(--surface);

            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            color: var(--muted);
        }

        .changes-op.op-create { color: var(--success); border-color: rgba(69, 232, 121, 0.5); }
        .changes-op.op-edit { color: var(--bright); border-color: rgba(21, 157, 255, 0.5); }
        .changes-op.op-delete { color: var(--danger); border-color: rgba(255, 86, 86, 0.5); }

        .changes-path {
            flex: 1;

            font-family: var(--mono);
            font-size: 11.5px;
            overflow-wrap: anywhere;
        }

        .changes-time {
            font-size: 10px;
            color: var(--muted);
        }

        /* =========================================
           SESSIONS (PRD FR-012)
           ========================================= */

        .session-row {
            display: flex;
            align-items: center;
            gap: var(--space-2);

            padding: 5px 6px;

            border: 1px solid transparent;
            border-radius: var(--radius-button);
            background: transparent;

            font-size: 12px;
            text-align: left;
        }

        .session-row:hover {
            background: var(--surface);
        }

        .session-row.active {
            border-color: rgba(7, 136, 249, 0.55);
        }

        .session-title {
            flex: 1;

            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .session-meta {
            font-size: 10px;
            color: var(--muted);
            white-space: nowrap;
        }

        .session-delete {
            padding: 0 6px;

            border: 0;
            border-radius: 50%;
            background: transparent;

            color: var(--muted);
            font-size: 13px;
            line-height: 1.4;
        }

        .session-delete:hover {
            color: var(--danger);
            background: rgba(255, 86, 86, 0.14);
        }

        /* =========================================
           MCP STATUS (PRD FR-020)
           ========================================= */

        .mcp-status {
            align-self: center;

            padding: 2px 9px;

            border: 1px solid var(--border);
            border-radius: 999px;
            background: var(--surface);

            font-size: 10.5px;
            color: var(--muted);
            white-space: nowrap;
        }

        .mcp-status.ok {
            color: var(--success);
            border-color: rgba(69, 232, 121, 0.45);
        }

        .mcp-status.error {
            color: var(--danger);
            border-color: rgba(255, 86, 86, 0.45);
        }

        /* =========================================
           COMPOSER (PRD 7.7, FR-009/010)
           ========================================= */

        .composer {
            padding: var(--space-3) var(--space-4) var(--space-4);

            border-top: 1px solid var(--border);
            background: var(--card);
        }

        .composer.dragging {
            outline: 2px dashed var(--bright);
            outline-offset: -6px;
        }

        .attachment-zone {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
        }

        .attachment-list {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2);
        }

        .attachment-list:empty {
            display: none;
        }

        .attachment-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;

            padding: 4px 10px;

            border: 1px solid var(--border);
            border-radius: 999px;
            background: var(--surface);

            font-size: 11px;
        }

        .attachment-name {
            max-width: 220px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .attachment-remove {
            padding: 0 6px;

            border: 0;
            border-radius: 50%;
            background: transparent;

            color: var(--muted);
            font-size: 13px;
            line-height: 1.4;
        }

        .attachment-remove:hover {
            color: var(--danger);
            background: rgba(255, 86, 86, 0.14);
        }

        textarea {
            width: 100%;
            min-height: 84px;

            resize: vertical;
            padding: 10px 12px;

            border: 1px solid var(--border);
            border-radius: var(--radius-input);
            background: var(--surface);
            color: var(--text);

            outline: none;
        }

        textarea:focus {
            border-color: var(--bright);
        }

        .composer-row {
            display: flex;
            align-items: center;
            gap: var(--space-2);

            margin-top: var(--space-2);
        }

        .attachment-plus {
            width: 36px;
            padding: 6px 0;

            font-size: 17px;
            line-height: 1;
        }

        .attachment-plus.open {
            background: var(--primary);
            color: #FFFFFF;
        }

        .attachment-hint {
            font-size: 11px;
            color: var(--muted);
        }

        .composer-spacer {
            flex: 1;
        }

        .attachment-menu {
            position: absolute;
            bottom: 76px;
            left: 20px;
            z-index: 30;

            min-width: 230px;
            padding: 6px;

            border: 1px solid var(--border);
            border-radius: var(--radius-button);
            background: var(--card);

            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        }

        .attachment-menu-item {
            display: flex;
            align-items: center;
            gap: 8px;

            width: 100%;
            padding: 8px 10px;

            border: 0;
            border-radius: 8px;
            background: transparent;

            text-align: left;
            font-size: 13px;
        }

        .attachment-menu-item:hover {
            background: var(--surface);
        }

        .attachment-menu-note {
            padding: 6px 10px 4px;

            font-size: 10px;
            color: var(--muted);
        }

        /* =========================================
           WORKSPACE DASHBOARD (PRD 7.7)
           ========================================= */

        .workspace-dashboard {
            position: fixed;
            inset: 0;
            z-index: 40;

            display: flex;
            align-items: center;
            justify-content: center;

            background: rgba(10, 12, 16, 0.72);
        }

        .workspace-dashboard-panel {
            display: flex;
            flex-direction: column;
            gap: var(--space-3);

            width: min(680px, calc(100vw - 48px));
            max-height: min(560px, calc(100vh - 96px));
            padding: var(--space-4);

            border: 1px solid var(--border);
            border-radius: var(--radius-card);
            background: var(--card);

            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        }

        .workspace-dashboard-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: var(--space-3);
        }

        .workspace-dashboard-title {
            font-size: 17px;
            font-weight: 700;
        }

        .workspace-dashboard-subtitle {
            font-size: 12px;
            color: var(--muted);
        }

        .workspace-dashboard-search {
            padding: 8px 12px;

            border: 1px solid var(--border);
            border-radius: var(--radius-input);
            background: var(--surface);
            color: var(--text);
        }

        .workspace-file-list {
            flex: 1;
            min-height: 120px;

            overflow-y: auto;

            border: 1px solid var(--border);
            border-radius: var(--radius-input);
            background: var(--bg);
        }

        .workspace-file-row {
            display: flex;
            align-items: center;
            gap: var(--space-2);

            padding: 7px 12px;

            border-bottom: 1px solid rgba(57, 67, 81, 0.4);

            cursor: pointer;
        }

        .workspace-file-row:hover {
            background: var(--surface);
        }

        .workspace-file-path {
            flex: 1;
            min-width: 0;

            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;

            font-family: var(--mono);
            font-size: 12px;
        }

        .workspace-file-size {
            font-size: 11px;
            color: var(--muted);
        }

        .workspace-empty {
            padding: var(--space-5);
            color: var(--muted);
            text-align: center;
        }

        .workspace-dashboard-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-3);
        }

        .workspace-dashboard-actions {
            display: flex;
            gap: var(--space-2);
        }
    </style>
</head>

<body>

    <div class="app">

        <!-- =====================================
             HEADER (PRD 7.1, FR-001)
             ===================================== -->

        <header class="header">

            <div class="brand">
                <div class="brand-mark" aria-hidden="true">L</div>

                <div>
                    <div class="brand-name">LocalSatur AI</div>
                    <div class="brand-subtitle">AI Development Workspace</div>
                </div>
            </div>

            <div
                id="status"
                class="status"
                role="status"
                aria-live="polite"
            >
                Ready
            </div>

            <button
                id="sessions-button"
                class="icon"
                type="button"
                title="Chat sessions"
                aria-expanded="false"
                aria-controls="sessions-panel"
            >
                Sessions
            </button>

            <button
                id="changed-files-button"
                class="icon hidden"
                type="button"
                title="Files changed in this session"
                aria-expanded="false"
                aria-controls="changed-files-panel"
            >
                Changes
            </button>

            <button
                id="new-chat"
                class="icon"
                type="button"
                title="New session"
                aria-label="Start a new session"
            >
                + New
            </button>

        </header>

        <!-- =====================================
             CHANGED FILES (PRD FR-011)
             ===================================== -->

        <div
            id="changed-files-panel"
            class="changes-panel hidden"
        >

            <div class="changes-panel-title">
                Files changed this session
            </div>

            <div
                id="changed-files-list"
                class="changes-list"
            >
            </div>

        </div>

        <div
            id="sessions-panel"
            class="changes-panel hidden"
        >

            <div class="changes-panel-title">
                Chat sessions
            </div>

            <div
                id="sessions-list"
                class="changes-list"
            >
            </div>

        </div>

        <!-- =====================================
             MODE NAVIGATION (PRD 7.1, FR-002)
             ===================================== -->

        <nav
            class="mode-nav"
            role="tablist"
            aria-label="Assistant mode"
        >

            <button
                class="mode-tab active"
                type="button"
                role="tab"
                aria-selected="true"
                data-mode="ask"
            >
                Ask
            </button>

            <button
                class="mode-tab"
                type="button"
                role="tab"
                aria-selected="false"
                data-mode="plan"
            >
                Plan
            </button>

            <button
                class="mode-tab"
                type="button"
                role="tab"
                aria-selected="false"
                data-mode="agent"
            >
                Agent
            </button>

            <!--
                The authoritative mode value lives here, hidden: the
                visible tabs above write to it and listeners read it.
            -->
            <select
                id="mode"
                class="visually-hidden"
                aria-hidden="true"
                tabindex="-1"
            >
                <option
                    value="ask"
                    selected
                >
                    Ask
                </option>
                <option value="plan">
                    Plan
                </option>
                <option value="agent">
                    Agent
                </option>
            </select>

        </nav>

        <!-- =====================================
             PROVIDER / MODEL CONFIG (PRD 7.2)
             ===================================== -->

        <div class="config-bar">

            <div class="config-row">

                <div class="config-field">
                    <label for="provider">Provider</label>

                    <select
                        id="provider"
                        aria-label="AI provider"
                    >
                    </select>
                </div>

                <div class="config-field">
                    <label for="model">Model</label>

                    <select
                        id="model"
                        aria-label="AI model"
                    >
                    </select>
                </div>

                <button
                    id="refresh-models"
                    class="icon"
                    type="button"
                    title="Refresh models"
                    aria-label="Refresh model list"
                >
                    ⟳
                </button>

                <button
                    id="api-key-button"
                    class="icon"
                    type="button"
                    title="Configure provider API key"
                >
                    API Key
                </button>

                <span
                    id="mcp-status"
                    class="mcp-status hidden"
                    role="status"
                >
                </span>

            </div>

            <input
                id="model-filter"
                class="hidden"
                type="search"
                placeholder="Filter models..."
                aria-label="Filter model list"
            >

        </div>

        <!-- =====================================
             MESSAGES (PRD 7.3)
             ===================================== -->

        <main
            id="messages"
            class="messages"
        >

            <div class="message assistant welcome">

                <div class="welcome-title">
                    LocalSatur AI is ready.
                </div>

                <div class="welcome-text">
                    Ask about your code, plan an implementation, or run an agent task.

                    Switch modes above, choose a provider and model, and attach files for context.
                </div>

                <div class="welcome-actions">

                    <button
                        id="welcome-provider"
                        class="primary"
                        type="button"
                    >
                        Configure Provider
                    </button>

                    <button
                        id="welcome-models"
                        type="button"
                    >
                        Refresh Models
                    </button>

                </div>

            </div>

        </main>

        <!-- =====================================
             COMPOSER (PRD 7.7)
             ===================================== -->

        <footer
            id="composer"
            class="composer"
        >

            <div class="attachment-zone">

                <div
                    id="attachment-list"
                    class="attachment-list"
                >
                </div>

                <textarea
                    id="input"
                    placeholder="Ask LocalSatur AI about your code... (Enter to send, Shift+Enter for a new line)"
                    aria-label="Prompt input"
                ></textarea>

                <div class="composer-row">

                    <button
                        id="attach"
                        class="attachment-plus"
                        type="button"
                        title="Add attachment"
                        aria-label="Add attachment"
                        aria-expanded="false"
                        aria-haspopup="menu"
                    >
                        +
                    </button>

                    <span class="attachment-hint">
                        Text and code files up to 1 MB. Drag files here or paste to attach.
                    </span>

                    <span class="composer-spacer"></span>

                    <button
                        id="stop"
                        class="danger"
                        type="button"
                        disabled
                    >
                        Stop
                    </button>

                    <button
                        id="send"
                        class="primary"
                        type="button"
                    >
                        Send
                    </button>

                </div>

                <div
                    id="attachment-menu"
                    class="attachment-menu hidden"
                    role="menu"
                >

                    <button
                        id="upload-from-computer"
                        class="attachment-menu-item"
                        type="button"
                        role="menuitem"
                    >
                        <span aria-hidden="true">↑</span>
                        <span>Upload from computer</span>
                    </button>

                    <button
                        id="add-from-workspace"
                        class="attachment-menu-item"
                        type="button"
                        role="menuitem"
                    >
                        <span aria-hidden="true">⌂</span>
                        <span>Add from workspace</span>
                    </button>

                    <div class="attachment-menu-note">
                        Attachments are sent as text. Image input is not supported yet.
                    </div>

                </div>

                <input
                    id="file-input"
                    type="file"
                    multiple
                    hidden
                >

            </div>

        </footer>

    </div>

    <!-- =====================================
         WORKSPACE DASHBOARD (PRD 7.7)
         ===================================== -->

    <div
        id="workspace-dashboard"
        class="workspace-dashboard hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-dashboard-title"
    >

        <div class="workspace-dashboard-panel">

            <div class="workspace-dashboard-header">

                <div>
                    <div
                        id="workspace-dashboard-title"
                        class="workspace-dashboard-title"
                    >
                        Workspace Files
                    </div>

                    <div class="workspace-dashboard-subtitle">
                        Add files as attachments or move workspace files to the Recycle Bin.
                    </div>
                </div>

                <button
                    id="workspace-dashboard-close"
                    class="icon"
                    type="button"
                    aria-label="Close workspace files"
                >
                    ×
                </button>

            </div>

            <input
                id="workspace-dashboard-search"
                class="workspace-dashboard-search"
                type="search"
                placeholder="Search workspace files..."
                aria-label="Search workspace files"
            >

            <div
                id="workspace-file-list"
                class="workspace-file-list"
            >
                <div class="workspace-empty">Loading workspace files...</div>
            </div>

            <div class="workspace-dashboard-footer">

                <span
                    id="workspace-selection-count"
                    class="workspace-dashboard-subtitle"
                >
                    0 selected
                </span>

                <div class="workspace-dashboard-actions">

                    <button
                        id="workspace-add-selected"
                        type="button"
                    >
                        Add Selected
                    </button>

                    <button
                        id="workspace-delete-selected"
                        class="danger"
                        type="button"
                    >
                        Delete Selected
                    </button>

                </div>

            </div>

        </div>

    </div>

    <script nonce="${nonce}" src="${markdownScriptUri}"></script>
    <script nonce="${nonce}">

        const vscode = acquireVsCodeApi();

        const el = id => document.getElementById(id);

        const messages = el("messages");
        const input = el("input");
        const attachButton = el("attach");
        const fileInput = el("file-input");
        const uploadFromComputer = el("upload-from-computer");
        const addFromWorkspace = el("add-from-workspace");
        const attachmentMenu = el("attachment-menu");
        const attachmentList = el("attachment-list");
        const composer = el("composer");
        const sendButton = el("send");
        const stopButton = el("stop");
        const status = el("status");
        const modeSelect = el("mode");
        const providerSelect = el("provider");
        const modelSelect = el("model");
        const modelFilter = el("model-filter");
        const refreshModelsButton = el("refresh-models");
        const apiKeyButton = el("api-key-button");
        const mcpStatusElement = el("mcp-status");
        const newChatButton = el("new-chat");
        const sessionsButton = el("sessions-button");
        const sessionsPanel = el("sessions-panel");
        const sessionsList = el("sessions-list");
        const changedFilesButton = el("changed-files-button");
        const changedFilesPanel = el("changed-files-panel");
        const changedFilesList = el("changed-files-list");
        const welcomeProviderButton = el("welcome-provider");
        const welcomeModelsButton = el("welcome-models");
        const modeTabs = Array.from(document.querySelectorAll(".mode-tab"));

        // =========================================
        // CHANGED FILES (PRD FR-011)
        // =========================================

        let changedFiles = [];

        function formatChangedTime(timestamp) {
            return new Date(timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            });
        }

        function renderChangedFiles() {
            changedFilesList.innerHTML = "";

            if (changedFiles.length === 0) {
                changedFilesButton.classList.add("hidden");
                changedFilesPanel.classList.add("hidden");
                changedFilesButton.setAttribute("aria-expanded", "false");
                return;
            }

            changedFilesButton.classList.remove("hidden");
            changedFilesButton.textContent = "Changes (" + changedFiles.length + ")";

            changedFiles.forEach(entry => {
                const row = document.createElement("button");
                row.type = "button";
                row.className = "changes-row";
                row.title = "Open " + (entry.operation === "rename" ? entry.targetPath : entry.path);

                const op = document.createElement("span");
                op.className = "changes-op op-" + entry.operation;
                op.textContent = entry.operation;
                row.appendChild(op);

                const pathLabel = document.createElement("span");
                pathLabel.className = "changes-path";
                pathLabel.textContent =
                    entry.operation === "rename"
                        ? entry.path + " → " + entry.targetPath
                        : entry.path;
                row.appendChild(pathLabel);

                const time = document.createElement("span");
                time.className = "changes-time";
                time.textContent = formatChangedTime(entry.timestamp);
                row.appendChild(time);

                row.addEventListener("click", () => {
                    vscode.postMessage({
                        type: "revealFile",
                        path: entry.operation === "rename" ? entry.targetPath : entry.path
                    });
                });

                changedFilesList.appendChild(row);
            });
        }

        changedFilesButton.addEventListener("click", () => {
            const hidden = changedFilesPanel.classList.toggle("hidden");
            changedFilesButton.setAttribute("aria-expanded", String(!hidden));
        });

        // =========================================
        // SESSIONS (PRD FR-012)
        // =========================================

        let sessionSummaries = [];

        let activeSessionId = "";

        function formatSessionAge(timestamp) {
            const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));

            if (minutes < 1) {
                return "now";
            }

            if (minutes < 60) {
                return minutes + "m";
            }

            const hours = Math.round(minutes / 60);

            if (hours < 24) {
                return hours + "h";
            }

            return Math.round(hours / 24) + "d";
        }

        function renderSessions() {
            sessionsList.innerHTML = "";

            sessionSummaries.forEach(session => {
                const row = document.createElement("div");
                row.className = "session-row" + (session.id === activeSessionId ? " active" : "");

                const title = document.createElement("button");
                title.type = "button";
                title.className = "session-title";
                title.textContent = session.title;
                title.title = "Switch to this session";
                title.addEventListener("click", () => {
                    if (session.id === activeSessionId || sendButton.disabled) {
                        return;
                    }

                    vscode.postMessage({
                        type: "switchSession",
                        id: session.id
                    });
                });

                const meta = document.createElement("span");
                meta.className = "session-meta";
                meta.textContent =
                    session.messageCount + " msg · " + formatSessionAge(session.updatedAt);

                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "session-delete";
                remove.textContent = "×";
                remove.title = "Delete session";
                remove.setAttribute("aria-label", "Delete session: " + session.title);
                remove.addEventListener("click", () => {
                    vscode.postMessage({
                        type: "deleteSession",
                        id: session.id
                    });
                });

                row.appendChild(title);
                row.appendChild(meta);
                row.appendChild(remove);
                sessionsList.appendChild(row);
            });
        }

        function applySessions(sessions, newActiveSessionId) {
            sessionSummaries = Array.isArray(sessions) ? sessions : [];
            activeSessionId = typeof newActiveSessionId === "string" ? newActiveSessionId : "";
            renderSessions();
        }

        sessionsButton.addEventListener("click", () => {
            const hidden = sessionsPanel.classList.toggle("hidden");
            sessionsButton.setAttribute("aria-expanded", String(!hidden));
        });

        function applyChangedFiles(list) {
            changedFiles = Array.isArray(list) ? list : [];
            renderChangedFiles();
        }

        // =========================================
        // STATUS (PRD 5.1: real state, colour-coded)
        // =========================================

        function statusClass(value) {
            const text = String(value || "");

            if (/error|fail|not allowed|not a text|too large|could not/i.test(text)) {
                return "status error";
            }

            if (/cancel|loading|thinking|generating|switching|preparing|running/i.test(text)) {
                return "status busy";
            }

            if (/complete|ready|connected|applied|copied|deleted|renamed/i.test(text)) {
                return "status ok";
            }

            if (/requires|no models|unknown|not found|not support/i.test(text)) {
                return "status warn";
            }

            return "status";
        }

        function setStatus(value) {
            status.textContent = value;
            status.className = statusClass(value);
            status.title = value;
        }

        function setRunning(running) {
            sendButton.disabled = running;
            stopButton.disabled = !running;
        }

        // =========================================
        // MODE NAVIGATION (PRD 7.1, FR-002)
        // =========================================

        function syncModeTabs() {
            modeTabs.forEach(tab => {
                const active = tab.getAttribute("data-mode") === modeSelect.value;

                tab.classList.toggle("active", active);
                tab.setAttribute("aria-selected", String(active));
            });
        }

        modeTabs.forEach(tab => {
            tab.addEventListener("click", () => {
                const target = tab.getAttribute("data-mode");

                if (!target || modeSelect.value === target) {
                    return;
                }

                modeSelect.value = target;
                syncModeTabs();
                modeSelect.dispatchEvent(new Event("change"));
            });
        });

        // =========================================
        // MESSAGES (PRD 7.3, FR-008)
        // =========================================

        function messageBody(element) {
            return element.querySelector(".message-body");
        }

        function appendAssistantContentFallback(element, content) {
            const fenceMarker = String.fromCharCode(96).repeat(3);
            const fence = new RegExp(
                fenceMarker + "([a-zA-Z0-9_+-]*)?\\\\n?([\\\\s\\\\S]*?)" + fenceMarker,
                "g"
            );
            let cursor = 0;
            let match;

            while ((match = fence.exec(content)) !== null) {
                if (match.index > cursor) {
                    const text = document.createElement("div");
                    text.textContent = content.slice(cursor, match.index);
                    element.appendChild(text);
                }

                const block = document.createElement("pre");
                block.className = "code-block";
                const language = match[1] || "code";
                const codeContent = match[2];
                block.setAttribute("data-language", language);

                const copy = document.createElement("button");
                copy.className = "copy-code";
                copy.type = "button";
                copy.textContent = "Copy " + language;
                copy.addEventListener("click", async () => {
                    try {
                        await navigator.clipboard.writeText(codeContent);
                        copy.textContent = "Copied";
                    } catch {
                        copy.textContent = "Copy unavailable";
                    }
                });

                const code = document.createElement("code");
                code.textContent = codeContent;
                block.appendChild(copy);
                block.appendChild(code);
                element.appendChild(block);
                cursor = fence.lastIndex;
            }

            if (cursor < content.length || cursor === 0) {
                const text = document.createElement("div");
                text.textContent = content.slice(cursor);
                element.appendChild(text);
            }
        }

        function attachCopyButtons(element) {
            element.querySelectorAll("pre.code-block").forEach(block => {
                const language = block.getAttribute("data-language") || "code";
                const code = block.querySelector("code");
                const codeContent = code ? code.textContent : "";

                const copy = document.createElement("button");
                copy.className = "copy-code";
                copy.type = "button";
                copy.textContent = "Copy " + language;
                copy.addEventListener("click", async () => {
                    try {
                        await navigator.clipboard.writeText(codeContent);
                        copy.textContent = "Copied";
                    } catch {
                        copy.textContent = "Copy unavailable";
                    }
                });

                block.insertBefore(copy, block.firstChild);
            });
        }

        function appendAssistantContent(element, content) {
            const renderer = window.localforgeMarkdown;

            if (renderer && typeof renderer.renderMarkdown === "function") {
                // The renderer escapes all input before emitting markup.
                element.innerHTML = renderer.renderMarkdown(content);
                attachCopyButtons(element);
                return;
            }

            appendAssistantContentFallback(element, content);
        }

        function addMessage(role, content) {
            const element = document.createElement("div");
            element.className = "message " + role;

            const head = document.createElement("div");
            head.className = "message-head";

            const roleLabel = document.createElement("span");
            roleLabel.className = "message-role";
            roleLabel.textContent =
                role === "user"
                    ? "You"
                    : role === "error"
                        ? "Attention"
                        : "LocalSatur AI";

            const time = document.createElement("span");
            time.className = "message-time";
            time.textContent = new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            });

            head.appendChild(roleLabel);
            head.appendChild(time);

            const body = document.createElement("div");
            body.className = "message-body";

            if (role === "assistant") {
                appendAssistantContent(body, content);
            } else {
                body.textContent = content;
            }

            element.appendChild(head);
            element.appendChild(body);

            messages.appendChild(element);
            messages.scrollTop = messages.scrollHeight;

            return element;
        }

        // =========================================
        // ACTIVITY TIMELINE (PRD 7.5, FR-013)
        // =========================================

        function addActivity(activity) {
            const element = document.createElement("div");
            element.className = "activity activity-" + (activity.type || "status");

            const labelRow = document.createElement("div");
            labelRow.className = "activity-label";
            labelRow.textContent = activity.label || "";
            element.appendChild(labelRow);

            const detail = typeof activity.detail === "string" ? activity.detail : "";

            if (detail) {
                const detailElement = document.createElement("div");
                detailElement.className = "activity-detail";
                detailElement.textContent = detail;
                element.appendChild(detailElement);

                if (detail.length > 160) {
                    detailElement.classList.add("collapsed");

                    const toggle = document.createElement("button");
                    toggle.className = "activity-toggle";
                    toggle.type = "button";
                    toggle.textContent = "Show more";

                    toggle.addEventListener("click", () => {
                        const collapsed = detailElement.classList.toggle("collapsed");
                        toggle.textContent = collapsed ? "Show more" : "Show less";
                    });

                    element.appendChild(toggle);
                }
            }

            messages.appendChild(element);
            messages.scrollTop = messages.scrollHeight;
        }

        // =========================================
        // EDIT PROPOSALS (PRD 7.5, FR-015/016)
        // =========================================

        function addProposal(proposal) {
            const wrapper = document.createElement("div");
            wrapper.className = "proposal";

            const title = document.createElement("div");
            title.className = "proposal-title";
            title.textContent =
                proposal.operation === "delete"
                    ? "Delete Proposal"
                    : proposal.operation === "rename"
                        ? "Rename Proposal"
                        : "Edit Proposal";

            const file = document.createElement("div");
            file.className = "proposal-path";
            file.textContent =
                proposal.operation === "rename"
                    ? proposal.path + " → " + proposal.targetPath
                    : proposal.path;

            const reason = document.createElement("div");
            reason.className = "proposal-reason";
            reason.textContent = proposal.reason;

            const buttons = document.createElement("div");
            buttons.className = "buttons";

            const review = document.createElement("button");
            review.textContent = "Review Diff";
            review.addEventListener("click", () => {
                vscode.postMessage({
                    type: "reviewEdit",
                    proposalId: proposal.id
                });
            });

            const approve = document.createElement("button");
            approve.className = "primary";
            approve.textContent = "Approve";
            approve.addEventListener("click", () => {
                vscode.postMessage({
                    type: "approveEdit",
                    proposalId: proposal.id
                });
            });

            const reject = document.createElement("button");
            reject.className = "danger";
            reject.textContent = "Reject";
            reject.addEventListener("click", () => {
                vscode.postMessage({
                    type: "rejectEdit",
                    proposalId: proposal.id
                });
            });

            buttons.appendChild(review);
            buttons.appendChild(approve);
            buttons.appendChild(reject);

            wrapper.appendChild(title);
            wrapper.appendChild(file);
            wrapper.appendChild(reason);
            wrapper.appendChild(buttons);

            messages.appendChild(wrapper);
            messages.scrollTop = messages.scrollHeight;
        }

        // =========================================
        // PLAN CARDS (PRD FR-010)
        // =========================================

        function addPlanCard(plan) {
            if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
                return;
            }

            const wrapper = document.createElement("div");
            wrapper.className = "plan-card";

            const title = document.createElement("div");
            title.className = "plan-title";
            title.textContent = "Implementation Plan";

            wrapper.appendChild(title);

            if (plan.summary) {
                const summary = document.createElement("div");
                summary.className = "plan-summary";
                summary.textContent = plan.summary;
                wrapper.appendChild(summary);
            }

            const steps = document.createElement("ol");
            steps.className = "plan-steps";

            plan.steps.forEach((step, stepIndex) => {
                const item = document.createElement("li");
                item.className = "plan-step";

                const number = document.createElement("span");
                number.className = "plan-step-number";
                number.textContent = String(stepIndex + 1) + ".";
                item.appendChild(number);

                const content = document.createElement("span");

                const titleSpan = document.createElement("span");
                titleSpan.className = "plan-step-title";
                titleSpan.textContent = step.title;
                content.appendChild(titleSpan);

                const chip = document.createElement("span");
                chip.className = "plan-action-chip action-" + (step.action || "other");
                chip.textContent = step.action || "other";
                content.appendChild(chip);

                if (Array.isArray(step.files) && step.files.length > 0) {
                    const files = document.createElement("div");
                    files.className = "plan-files";

                    step.files.forEach(file => {
                        const fileLabel = document.createElement("span");
                        fileLabel.className = "plan-file";
                        fileLabel.textContent = file;
                        files.appendChild(fileLabel);
                    });

                    content.appendChild(files);
                }

                item.appendChild(content);
                steps.appendChild(item);
            });

            wrapper.appendChild(steps);

            if (Array.isArray(plan.risks) && plan.risks.length > 0) {
                const risks = document.createElement("ul");
                risks.className = "plan-risks";

                plan.risks.forEach(risk => {
                    const riskItem = document.createElement("li");
                    riskItem.textContent = risk;
                    risks.appendChild(riskItem);
                });

                wrapper.appendChild(risks);
            }

            const buttons = document.createElement("div");
            buttons.className = "buttons";

            const execute = document.createElement("button");
            execute.className = "primary";
            execute.textContent = "Execute in Agent mode";
            execute.addEventListener("click", () => {
                // Real run state: the composer send button is disabled while a request is active.
                if (sendButton.disabled) {
                    return;
                }

                const prompt = [
                    "Execute this plan step by step:",
                    "",
                    plan.summary ? plan.summary : "",
                    "",
                    ...plan.steps.map(
                        (step, index) =>
                            (index + 1) + ". " + step.title +
                            (Array.isArray(step.files) && step.files.length > 0
                                ? " (files: " + step.files.join(", ") + ")"
                                : "")
                    ),
                    "",
                    "Inspect the affected files first, then make the changes. Validate the result before finishing."
                ].filter(part => part !== "").join("\\n");

                modeSelect.value = "agent";
                syncModeTabs();
                modeSelect.dispatchEvent(new Event("change"));

                submitChat(prompt, "agent", [], "Execute plan: " + (plan.summary || "implementation steps"));
            });

            buttons.appendChild(execute);
            wrapper.appendChild(buttons);

            messages.appendChild(wrapper);
            messages.scrollTop = messages.scrollHeight;
        }

        // =========================================
        // ATTACHMENTS (PRD 7.7, FR-009)
        // =========================================

        let selectedAttachments = [];

        function formatFileSize(bytes) {
            if (bytes < 1024) {
                return bytes + " B";
            }

            if (bytes < 1024 * 1024) {
                return (bytes / 1024).toFixed(1) + " KB";
            }

            return (bytes / (1024 * 1024)).toFixed(1) + " MB";
        }

        function renderAttachments() {
            attachmentList.innerHTML = "";

            selectedAttachments.forEach((file, index) => {
                const chip = document.createElement("div");
                chip.className = "attachment-chip";

                const name = document.createElement("span");
                name.className = "attachment-name";
                name.title = file.name;
                name.textContent = file.name + " (" + formatFileSize(file.size) + ")";

                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "attachment-remove";
                remove.title = "Remove " + file.name;
                remove.setAttribute("aria-label", "Remove " + file.name);
                remove.textContent = "×";

                remove.addEventListener("click", () => {
                    selectedAttachments.splice(index, 1);
                    renderAttachments();
                });

                chip.appendChild(name);
                chip.appendChild(remove);
                attachmentList.appendChild(chip);
            });
        }

        function addWorkspaceAttachment(attachment) {
            if (!attachment || typeof attachment.content !== "string") {
                setStatus("Could not add workspace file.");
                return;
            }

            const alreadySelected = selectedAttachments.some(
                selected =>
                    selected.name === attachment.name &&
                    selected.size === attachment.size &&
                    selected.path === attachment.path
            );

            if (!alreadySelected) {
                selectedAttachments.push(attachment);
            }

            renderAttachments();
        }

        const textFileExtensions = new Set([
            "txt", "md", "markdown", "json", "jsonc",
            "js", "jsx", "ts", "tsx", "mjs", "cjs",
            "css", "scss", "less", "html", "htm",
            "xml", "svg", "csv", "tsv", "yaml", "yml",
            "sql", "php", "py", "java", "c", "h",
            "cpp", "hpp", "cs", "go", "rs", "rb",
            "sh", "ps1", "bat", "cmd", "ini", "env",
            "toml", "conf", "config", "log"
        ]);

        function isTextFile(file) {
            if (file.type && file.type.startsWith("text/")) {
                return true;
            }

            const parts = file.name.toLowerCase().split(".");
            const extension = parts.length > 1 ? parts[parts.length - 1] : "";

            return textFileExtensions.has(extension);
        }

        function addFiles(files) {
            Array.from(files).forEach(file => {
                if (file.size > 1024 * 1024) {
                    setStatus(file.name + " is too large. Maximum size is 1 MB.");
                    return;
                }

                if (!isTextFile(file)) {
                    setStatus(file.name + " is not a text or code file.");
                    return;
                }

                const alreadySelected = selectedAttachments.some(
                    selected =>
                        selected.name === file.name &&
                        selected.size === file.size &&
                        selected.lastModified === file.lastModified
                );

                if (!alreadySelected) {
                    selectedAttachments.push(file);
                }
            });

            renderAttachments();
        }

        function setAttachmentMenuOpen(open) {
            attachmentMenu.classList.toggle("hidden", !open);
            attachButton.classList.toggle("open", open);
            attachButton.setAttribute("aria-expanded", String(open));
        }

        attachButton.addEventListener("click", event => {
            event.stopPropagation();
            setAttachmentMenuOpen(!attachmentMenu.classList.contains("hidden"));
        });

        uploadFromComputer.addEventListener("click", event => {
            event.stopPropagation();
            setAttachmentMenuOpen(false);
            fileInput.click();
        });

        addFromWorkspace.addEventListener("click", event => {
            event.stopPropagation();
            setAttachmentMenuOpen(false);
            openWorkspaceDashboard();
        });

        fileInput.addEventListener("change", () => {
            if (fileInput.files) {
                addFiles(fileInput.files);
            }

            fileInput.value = "";
        });

        document.addEventListener("click", event => {
            const target = event.target;

            if (
                target instanceof Node &&
                !attachmentMenu.contains(target) &&
                !attachButton.contains(target)
            ) {
                setAttachmentMenuOpen(false);
            }
        });

        // Drag-and-drop and paste attachments (PRD 7.7).

        composer.addEventListener("dragover", event => {
            event.preventDefault();
            composer.classList.add("dragging");
        });

        composer.addEventListener("dragleave", () => {
            composer.classList.remove("dragging");
        });

        composer.addEventListener("drop", event => {
            event.preventDefault();
            composer.classList.remove("dragging");

            if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length > 0) {
                addFiles(event.dataTransfer.files);
            }
        });

        input.addEventListener("paste", event => {
            const files = event.clipboardData && event.clipboardData.files;

            if (files && files.length > 0) {
                event.preventDefault();
                addFiles(files);
            }
        });

        // =========================================
        // WORKSPACE DASHBOARD (PRD 7.7)
        // =========================================

        const workspaceDashboard = el("workspace-dashboard");
        const workspaceDashboardClose = el("workspace-dashboard-close");
        const workspaceDashboardSearch = el("workspace-dashboard-search");
        const workspaceFileList = el("workspace-file-list");
        const workspaceSelectionCount = el("workspace-selection-count");
        const workspaceAddSelected = el("workspace-add-selected");
        const workspaceDeleteSelected = el("workspace-delete-selected");

        let workspaceFiles = [];
        const workspaceSelectedPaths = new Set();

        function formatWorkspaceSize(bytes) {
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
            return (bytes / (1024 * 1024)).toFixed(1) + " MB";
        }

        function updateWorkspaceSelectionCount() {
            const count = workspaceSelectedPaths.size;
            workspaceSelectionCount.textContent = count + (count === 1 ? " file selected" : " files selected");
        }

        function renderWorkspaceFiles() {
            workspaceFileList.innerHTML = "";
            const query = workspaceDashboardSearch.value.trim().toLowerCase();
            const filtered = workspaceFiles.filter(file => !query || file.path.toLowerCase().includes(query));

            if (filtered.length === 0) {
                const empty = document.createElement("div");
                empty.className = "workspace-empty";
                empty.textContent = workspaceFiles.length === 0
                    ? "No files found in the workspace."
                    : "No files match your search.";
                workspaceFileList.appendChild(empty);
            } else {
                filtered.forEach(file => {
                    const row = document.createElement("label");
                    row.className = "workspace-file-row";

                    const checkbox = document.createElement("input");
                    checkbox.type = "checkbox";
                    checkbox.checked = workspaceSelectedPaths.has(file.path);
                    checkbox.addEventListener("change", () => {
                        if (checkbox.checked) workspaceSelectedPaths.add(file.path);
                        else workspaceSelectedPaths.delete(file.path);
                        updateWorkspaceSelectionCount();
                    });

                    const pathLabel = document.createElement("span");
                    pathLabel.className = "workspace-file-path";
                    pathLabel.title = file.path;
                    pathLabel.textContent = file.path;

                    const size = document.createElement("span");
                    size.className = "workspace-file-size";
                    size.textContent = formatWorkspaceSize(file.size);

                    row.appendChild(checkbox);
                    row.appendChild(pathLabel);
                    row.appendChild(size);
                    workspaceFileList.appendChild(row);
                });
            }

            updateWorkspaceSelectionCount();
        }

        function openWorkspaceDashboard() {
            workspaceSelectedPaths.clear();
            workspaceDashboardSearch.value = "";
            workspaceDashboard.classList.remove("hidden");
            workspaceFileList.innerHTML = '<div class="workspace-empty">Loading workspace files...</div>';
            updateWorkspaceSelectionCount();
            vscode.postMessage({ type: "openWorkspaceDashboard" });
        }

        function closeWorkspaceDashboard() {
            workspaceDashboard.classList.add("hidden");
            workspaceSelectedPaths.clear();
        }

        workspaceDashboardClose.addEventListener("click", closeWorkspaceDashboard);

        workspaceDashboard.addEventListener("click", event => {
            if (event.target === workspaceDashboard) closeWorkspaceDashboard();
        });

        workspaceDashboardSearch.addEventListener("input", renderWorkspaceFiles);

        workspaceAddSelected.addEventListener("click", () => {
            const paths = Array.from(workspaceSelectedPaths);
            if (paths.length === 0) { setStatus("Select at least one workspace file."); return; }
            vscode.postMessage({ type: "addWorkspaceFiles", paths });
            closeWorkspaceDashboard();
        });

        workspaceDeleteSelected.addEventListener("click", () => {
            const paths = Array.from(workspaceSelectedPaths);
            if (paths.length === 0) { setStatus("Select at least one workspace file."); return; }
            vscode.postMessage({ type: "deleteWorkspaceFiles", paths });
        });

        // =========================================
        // PROVIDER SELECTION (PRD 7.2, FR-003)
        // =========================================

        providerSelect.addEventListener("change", () => {
            const selectedProvider = providerSelect.value;

            if (!selectedProvider) {
                return;
            }

            providerSelect.disabled = true;
            setStatus("Switching provider...");

            vscode.postMessage({
                type: "setProvider",
                provider: selectedProvider
            });
        });

        // =========================================
        // MODE SELECTION (PRD 7.1, FR-002)
        // =========================================

        modeSelect.addEventListener("change", () => {
            syncModeTabs();
            updateModelAvailability();

            if (modeSelect.value === "agent" && !selectedModelSupportsTools) {
                setStatus("Agent requires a tool-capable model");
                return;
            }

            setStatus(
                modeSelect.value === "ask"
                    ? "Ask mode"
                    : modeSelect.value === "plan"
                        ? "Plan mode"
                        : "Agent mode"
            );
        });

        // =========================================
        // MODEL SELECTION (PRD 7.2, FR-004/005)
        // =========================================

        let availableModels = [];

        let selectedModelSupportsTools = false;

        function modelOptionLabel(model) {
            const supportsTools = model?.supportsTools;

            return supportsTools === true
                ? model.name + " — Agent + Chat"
                : supportsTools === false
                    ? model.name + " — Chat only"
                    : model.name + " — Tool support unknown";
        }

        function renderModelOptions(filter, selectedModel) {
            modelSelect.innerHTML = "";

            const query = (filter || "").trim().toLowerCase();
            const visible = availableModels.filter(
                model => !query || model.name.toLowerCase().includes(query)
            );

            if (visible.length === 0) {
                const emptyOption = document.createElement("option");
                emptyOption.textContent = query
                    ? 'No models match "' + query + '"'
                    : "No models found";
                modelSelect.appendChild(emptyOption);
                modelSelect.disabled = true;
                return 0;
            }

            visible.forEach(model => {
                const option = document.createElement("option");
                option.value = model.name;
                option.textContent = modelOptionLabel(model);
                option.selected = model.name === selectedModel;
                modelSelect.appendChild(option);
            });

            modelSelect.disabled = false;
            return visible.length;
        }

        function loadModels() {
            modelSelect.disabled = true;
            modelSelect.innerHTML = "";

            const loadingOption = document.createElement("option");
            loadingOption.textContent = "Loading models...";
            modelSelect.appendChild(loadingOption);

            setStatus("Loading provider models...");
            vscode.postMessage({ type: "getModels" });
        }

        function populateModels(models, selectedModel) {
            if (!Array.isArray(models) || models.length === 0) {
                availableModels = [];
                modelFilter.classList.add("hidden");
                renderModelOptions("", "");
                selectedModelSupportsTools = false;
                setStatus("No models found for this provider");
                return;
            }

            availableModels = models;

            // Model search/filter for large lists (PRD 7.2).

            const filterVisible = models.length > 25;
            modelFilter.classList.toggle("hidden", !filterVisible);

            if (filterVisible) {
                modelFilter.value = "";
            }

            let effectiveModel = selectedModel;

            if (!models.some(model => model.name === selectedModel) && models[0]) {
                effectiveModel = models[0].name;
            }

            renderModelOptions(modelFilter.value, effectiveModel);

            const effectiveDetails = models.find(model => model.name === effectiveModel);
            selectedModelSupportsTools = effectiveDetails?.supportsTools === true;

            setStatus(
                modeSelect.value === "agent"
                    ? selectedModelSupportsTools === false
                        ? "Agent mode active; this model cannot use workspace tools"
                        : selectedModelSupportsTools === true
                            ? "Agent ready"
                            : "Agent ready; tool support unverified"
                    : modeSelect.value === "plan"
                        ? "Plan ready"
                        : "Ask ready"
            );
        }

        function updateModelAvailability() {
            if (!Array.isArray(availableModels) || availableModels.length === 0) {
                return;
            }

            const selectedName = modelSelect.value;
            const selectedDetails = availableModels.find(model => model.name === selectedName);

            selectedModelSupportsTools = selectedDetails?.supportsTools;

            setStatus(
                modeSelect.value === "agent"
                    ? selectedModelSupportsTools === false
                        ? "Agent mode active; this model cannot use workspace tools"
                        : selectedModelSupportsTools === true
                            ? "Agent ready"
                            : "Agent ready; tool support unverified"
                    : modeSelect.value === "plan"
                        ? "Plan ready"
                        : "Ask ready"
            );
        }

        modelSelect.addEventListener("change", () => {
            const selectedModel = modelSelect.value;

            if (!selectedModel) {
                return;
            }

            const selectedDetails = availableModels.find(model => model.name === selectedModel);
            selectedModelSupportsTools = selectedDetails?.supportsTools === true;

            modelSelect.disabled = true;
            setStatus("Switching model...");

            vscode.postMessage({
                type: "setModel",
                model: selectedModel
            });
        });

        modelFilter.addEventListener("input", () => {
            renderModelOptions(modelFilter.value, modelSelect.value);
        });

        refreshModelsButton.addEventListener("click", loadModels);

        apiKeyButton.addEventListener("click", () => {
            vscode.postMessage({ type: "setProviderApiKey" });
        });

        newChatButton.addEventListener("click", () => {
            vscode.postMessage({ type: "newChat" });
        });

        welcomeProviderButton.addEventListener("click", () => {
            vscode.postMessage({ type: "setProviderApiKey" });
        });

        welcomeModelsButton.addEventListener("click", loadModels);

        // =========================================
        // SEND (PRD 7.7)
        // =========================================

        let streamingAssistantElement = null;

        let streamingAssistantContent = "";

        async function send() {
            const content = input.value.trim();

            if (!content && selectedAttachments.length === 0) {
                return;
            }

            setStatus("Preparing attachments...");

            let attachments = [];

            try {
                attachments = await Promise.all(
                    selectedAttachments.map(async file => {
                        if (typeof file.content === "string") {
                            return {
                                name: file.name,
                                type: file.type,
                                size: file.size,
                                content: file.content
                            };
                        }

                        return {
                            name: file.name,
                            type: file.type,
                            size: file.size,
                            content: await file.text()
                        };
                    })
                );
            } catch (error) {
                setStatus("Could not read attachment");
                return;
            }

            const displayContent =
                content ||
                (attachments.length === 1
                    ? "Attached file: " + attachments[0].name
                    : "Attached " + attachments.length + " files");

            const mode = modeSelect.value;

            input.value = "";

            submitChat(content, mode, attachments, displayContent);
        }

        function submitChat(rawContent, mode, attachments, displayContent) {
            addMessage("user", displayContent);

            streamingAssistantElement = null;
            streamingAssistantContent = "";

            selectedAttachments = [];
            renderAttachments();

            setStatus("Thinking...");
            setRunning(true);

            vscode.postMessage({
                type: "chat",
                mode: mode,
                content: rawContent,
                attachments: attachments
            });
        }

        sendButton.addEventListener("click", send);

        stopButton.addEventListener("click", () => {
            stopButton.disabled = true;
            setStatus("Canceling...");
            vscode.postMessage({ type: "cancelChat" });
        });

        input.addEventListener("keydown", event => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
            }
        });

        // =========================================
        // EXTENSION MESSAGES (unchanged contract)
        // =========================================

        window.addEventListener("message", event => {
            const message = event.data;

            if (message.type === "workspaceFiles") {
                workspaceFiles = Array.isArray(message.files) ? message.files : [];
                renderWorkspaceFiles();
                return;
            }

            if (message.type === "conversation") {
                const history = Array.isArray(message.messages) ? message.messages : [];

                if (message.reset || history.length > 0) {
                    messages.innerHTML = "";
                }

                history.forEach(item => {
                    if (
                        (item.role === "user" || item.role === "assistant") &&
                        typeof item.content === "string"
                    ) {
                        addMessage(item.role, item.content);
                    }
                });

                applyChangedFiles(message.changedFiles);
                return;
            }

            if (message.type === "sessions") {
                applySessions(message.sessions, message.activeSessionId);
                return;
            }

            if (message.type === "mcpStatus") {
                const statuses = Array.isArray(message.statuses) ? message.statuses : [];

                if (statuses.length === 0) {
                    mcpStatusElement.classList.add("hidden");
                    return;
                }

                const connected = statuses.filter(status => status.connected);
                const tools = connected.reduce(
                    (sum, status) => sum + (status.toolCount || 0), 0
                );

                const failed = statuses.filter(status => status.enabled && !status.connected);

                mcpStatusElement.classList.remove("hidden");

                if (connected.length === 0) {
                    mcpStatusElement.textContent = "MCP: offline";
                    mcpStatusElement.className = "mcp-status error";
                } else if (failed.length > 0) {
                    mcpStatusElement.textContent = "MCP: " + tools + " tools (" + failed.length + " down)";
                    mcpStatusElement.className = "mcp-status error";
                } else {
                    mcpStatusElement.textContent = "MCP: " + tools + " tools";
                    mcpStatusElement.className = "mcp-status ok";
                }

                // Tooltip carries the real per-server detail.
                mcpStatusElement.title = statuses.map(status =>
                    status.name + ": " +
                    (status.connected
                        ? status.toolCount + " tool(s)"
                        : "offline" + (status.error ? " — " + status.error : ""))
                ).join("\\n");

                return;
            }

            if (message.type === "conversationCleared") {
                messages.innerHTML = "";
                addMessage("assistant", "LocalSatur AI is ready. Ask me to inspect, understand, modify, or verify your project.");
                setStatus("Ready");
                applyChangedFiles(message.changedFiles);
                return;
            }

            if (message.type === "changedFiles") {
                applyChangedFiles(message.changedFiles);
                return;
            }

            if (message.type === "workspaceFilesDeleted") {
                const deleted = Array.isArray(message.paths) ? message.paths : [];
                workspaceFiles = workspaceFiles.filter(file => !deleted.includes(file.path));
                deleted.forEach(path => workspaceSelectedPaths.delete(path));
                renderWorkspaceFiles();
                setStatus(
                    deleted.length === 1
                        ? "Moved " + deleted[0] + " to the Recycle Bin."
                        : "Moved " + deleted.length + " files to the Recycle Bin."
                );
                return;
            }

            if (message.type === "workspaceAttachment") {
                addWorkspaceAttachment(message.attachment);
                setStatus("Added " + (message.attachment?.name ?? "workspace file"));
                return;
            }

            if (message.type === "attachmentError") {
                setStatus(message.message || "Attachment operation failed.");
                return;
            }

            if (message.type === "providers") {
                providerSelect.innerHTML = "";

                if (!Array.isArray(message.providers) || message.providers.length === 0) {
                    const option = document.createElement("option");
                    option.value = "";
                    option.textContent = "No providers available";
                    providerSelect.appendChild(option);
                    providerSelect.disabled = true;
                    setStatus("No AI providers available");
                    return;
                }

                message.providers.forEach(provider => {
                    const option = document.createElement("option");
                    option.value = provider.id;
                    option.textContent = provider.name;
                    option.selected = provider.id === message.selectedProvider;
                    providerSelect.appendChild(option);
                });

                providerSelect.disabled = false;

                const selected = message.providers.find(
                    provider => provider.id === message.selectedProvider
                );

                setStatus("Provider: " + (selected?.name ?? message.selectedProvider));
                return;
            }

            if (message.type === "providerSelected") {
                providerSelect.value = message.provider;
                providerSelect.disabled = false;
                setStatus("Provider: " + (message.name ?? message.provider));
                loadModels();
                return;
            }

            if (message.type === "setProviderApiKey") {
                vscode.commands.executeCommand("localforge.setProviderApiKey");
                return;
            }

            if (message.type === "providerError") {
                providerSelect.disabled = false;
                setStatus("Provider error");
                addMessage("error", message.message);
                return;
            }

            if (message.type === "models") {
                populateModels(message.models, message.selectedModel);
                return;
            }

            if (message.type === "modelSelected") {
                modelSelect.value = message.model;

                const selectedDetails = availableModels.find(
                    model => model.name === message.model
                );

                selectedModelSupportsTools = selectedDetails?.supportsTools === true;
                modelSelect.disabled = false;

                setStatus(
                    modeSelect.value !== "agent"
                        ? modeSelect.value + " - " + message.model
                        : selectedModelSupportsTools
                            ? "Agent - " + message.model
                            : "Chat only - " + message.model
                );
                return;
            }

            if (message.type === "modelsError") {
                modelSelect.disabled = false;
                setStatus("Model error");
                addMessage("error", message.message);
                return;
            }

            if (message.type === "activity") {
                addActivity(message.activity);
                setStatus(message.activity.label);
                return;
            }

            if (message.type === "stream") {
                if (!streamingAssistantElement) {
                    streamingAssistantElement = addMessage("assistant", "");
                }

                const chunk = typeof message.content === "string" ? message.content : "";

                streamingAssistantContent += chunk;
                appendAssistantContent(
                    messageBody(streamingAssistantElement),
                    streamingAssistantContent
                );

                messages.scrollTop = messages.scrollHeight;
                setStatus("Generating...");
                return;
            }

            if (message.type === "response") {
                // Streaming already rendered the assistant response. Only create a
                // message here when no stream chunks were received.

                if (message.content && !streamingAssistantElement) {
                    addMessage("assistant", message.content);
                } else if (message.content && streamingAssistantElement) {
                    const body = messageBody(streamingAssistantElement);
                    body.textContent = "";
                    appendAssistantContent(body, message.content);
                }

                streamingAssistantElement = null;
                streamingAssistantContent = "";

                setStatus("Completed");
                setRunning(false);
                return;
            }

            if (message.type === "plan") {
                addPlanCard(message.plan);
                return;
            }

            if (message.type === "error") {
                addMessage("error", message.message);
                setStatus("Error");
                setRunning(false);
                return;
            }

            if (message.type === "status") {
                setStatus(message.status);

                if (
                    message.status === "Completed" ||
                    message.status === "Canceled" ||
                    message.status === "Error"
                ) {
                    setRunning(false);
                }

                return;
            }

            if (message.type === "editProposal") {
                addProposal(message.proposal);
                setStatus("Edit proposal ready");
                return;
            }

            if (message.type === "editApplied") {
                setStatus("Edit applied");
                return;
            }

            if (message.type === "editRejected") {
                setStatus("Edit rejected");
            }
        });

        // Load registered providers and the saved conversation when the chat opens.

        vscode.postMessage({ type: "getProviders" });
        vscode.postMessage({ type: "getConversation" });
        loadModels();

    </script>

</body>
</html>`;
}
