export function getChatHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <title>LocalSatur AI</title>

    <style>
        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            padding: 0;

            font-family: var(
                --vscode-font-family,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif
            );

            color:
                var(--vscode-foreground);

            background:
                var(--vscode-editor-background);

            height: 100vh;

            display: flex;
            flex-direction: column;
        }

        .header {
            padding: 14px 18px;

            border-bottom:
                1px solid
                var(--vscode-panel-border);

            display: flex;
            align-items: center;

            gap: 10px;
        }

        .logo {
            font-size: 18px;
            font-weight: 700;
        }

        .status {
            font-size: 11px;
            opacity: 0.7;
        }

        .messages {
            flex: 1;

            overflow-y: auto;

            padding: 20px;
        }

        .message {
            max-width: 85%;

            margin-bottom: 16px;

            padding: 12px 14px;

            border-radius: 8px;

            white-space: pre-wrap;

            line-height: 1.5;
        }

        .user {
            margin-left: auto;

            background:
                var(--vscode-button-background);

            color:
                var(--vscode-button-foreground);
        }

        .assistant {
            margin-right: auto;

            background:
                var(
                    --vscode-textBlockQuote-background
                );

            border:
                1px solid
                var(--vscode-panel-border);
        }

        .error {
            margin-right: auto;

            background:
                var(
                    --vscode-inputValidation-errorBackground
                );

            border:
                1px solid
                var(
                    --vscode-inputValidation-errorBorder
                );

            color:
                var(
                    --vscode-inputValidation-errorForeground
                );
        }

        .welcome {
            opacity: 0.8;
        }

        /* -----------------------------------------
           EDIT PROPOSAL
        ----------------------------------------- */

        .proposal {
            max-width: 900px;

            margin-bottom: 18px;

            padding: 14px;

            border:
                1px solid
                var(--vscode-panel-border);

            border-radius: 8px;

            background:
                var(
                    --vscode-editorWidget-background
                );
        }

        .proposal-title {
            font-weight: 700;

            margin-bottom: 8px;
        }

        .proposal-path {
            font-family:
                var(
                    --vscode-editor-font-family,
                    Consolas,
                    "Courier New",
                    monospace
                );

            font-size: 12px;

            margin-bottom: 8px;

            color:
                var(--vscode-textLink-foreground);
        }

        .proposal-reason {
            font-size: 13px;

            opacity: 0.85;

            margin-bottom: 12px;
        }

        .proposal-actions {
            display: flex;

            gap: 8px;

            flex-wrap: wrap;
        }

        .proposal-actions button {
            border: 0;

            border-radius: 5px;

            padding:
                7px 12px;

            cursor: pointer;

            background:
                var(--vscode-button-background);

            color:
                var(--vscode-button-foreground);
        }

        .proposal-actions button:hover {
            background:
                var(
                    --vscode-button-hoverBackground
                );
        }

        .proposal-actions button:disabled {
            opacity: 0.5;

            cursor: default;
        }

        .approve-button {
            background:
                var(--vscode-testing-iconPassed) !important;
        }

        .reject-button {
            background:
                var(
                    --vscode-testing-iconFailed
                ) !important;
        }

        /* -----------------------------------------
           COMPOSER
        ----------------------------------------- */

        .composer {
            padding: 12px;

            border-top:
                1px solid
                var(--vscode-panel-border);
        }

        textarea {
            width: 100%;

            min-height: 70px;

            resize: vertical;

            padding: 10px;

            border:
                1px solid
                var(--vscode-input-border);

            border-radius: 6px;

            background:
                var(--vscode-input-background);

            color:
                var(--vscode-input-foreground);

            font-family: inherit;

            outline: none;
        }

        textarea:focus {
            border-color:
                var(--vscode-focusBorder);
        }

        .actions {
            display: flex;

            justify-content: flex-end;

            margin-top: 8px;
        }

        button {
            border: 0;

            border-radius: 5px;

            padding:
                7px 14px;

            cursor: pointer;

            background:
                var(--vscode-button-background);

            color:
                var(--vscode-button-foreground);
        }

        button:hover {
            background:
                var(--vscode-button-hoverBackground);
        }

        button:disabled {
            opacity: 0.5;

            cursor: default;
        }
    </style>
</head>

<body>

    <div class="header">

        <div class="logo">
            LocalSatur AI
        </div>

        <div class="status">
            Local AI • Ollama
        </div>

    </div>

    <div
        class="messages"
        id="messages"
    >

        <div
            class="message assistant welcome"
        >
            Welcome to LocalSatur AI.

            Your local AI coding agent is ready.
            Ask about your code, project, errors,
            or development tasks.
        </div>

    </div>

    <div class="composer">

        <textarea
            id="input"
            placeholder="Ask LocalSatur AI..."
        ></textarea>

        <div class="actions">

            <button
                id="send"
            >
                Send
            </button>

        </div>

    </div>

    <script>

        const vscode =
            acquireVsCodeApi();

        const input =
            document.getElementById(
                "input"
            );

        const send =
            document.getElementById(
                "send"
            );

        const messages =
            document.getElementById(
                "messages"
            );

        function addMessage(
            role,
            content
        ) {
            const message =
                document.createElement(
                    "div"
                );

            message.className =
                "message " + role;

            message.textContent =
                content;

            messages.appendChild(
                message
            );

            messages.scrollTop =
                messages.scrollHeight;
        }

        function addProposal(
            proposal
        ) {
            const container =
                document.createElement(
                    "div"
                );

            container.className =
                "proposal";

            const title =
                document.createElement(
                    "div"
                );

            title.className =
                "proposal-title";

            title.textContent =
                "✏️ Edit Proposal";

            const path =
                document.createElement(
                    "div"
                );

            path.className =
                "proposal-path";

            path.textContent =
                proposal.path;

            const reason =
                document.createElement(
                    "div"
                );

            reason.className =
                "proposal-reason";

            reason.textContent =
                proposal.reason;

            const actions =
                document.createElement(
                    "div"
                );

            actions.className =
                "proposal-actions";

            const reviewButton =
                document.createElement(
                    "button"
                );

            reviewButton.textContent =
                "Review Diff";

            reviewButton.addEventListener(
                "click",
                () => {
                    vscode.postMessage({
                        type:
                            "reviewEdit",

                        proposalId:
                            proposal.id
                    });
                }
            );

            const approveButton =
                document.createElement(
                    "button"
                );

            approveButton.className =
                "approve-button";

            approveButton.textContent =
                "Approve";

            approveButton.addEventListener(
                "click",
                () => {
                    approveButton.disabled =
                        true;

                    rejectButton.disabled =
                        true;

                    vscode.postMessage({
                        type:
                            "approveEdit",

                        proposalId:
                            proposal.id
                    });
                }
            );

            const rejectButton =
                document.createElement(
                    "button"
                );

            rejectButton.className =
                "reject-button";

            rejectButton.textContent =
                "Reject";

            rejectButton.addEventListener(
                "click",
                () => {
                    rejectButton.disabled =
                        true;

                    approveButton.disabled =
                        true;

                    vscode.postMessage({
                        type:
                            "rejectEdit",

                        proposalId:
                            proposal.id
                    });
                }
            );

            actions.appendChild(
                reviewButton
            );

            actions.appendChild(
                approveButton
            );

            actions.appendChild(
                rejectButton
            );

            container.appendChild(
                title
            );

            container.appendChild(
                path
            );

            container.appendChild(
                reason
            );

            container.appendChild(
                actions
            );

            messages.appendChild(
                container
            );

            messages.scrollTop =
                messages.scrollHeight;
        }

        function sendMessage() {
            const content =
                input.value.trim();

            if (!content) {
                return;
            }

            addMessage(
                "user",
                content
            );

            vscode.postMessage({
                type:
                    "chat",

                content
            });

            input.value = "";

            send.disabled =
                true;
        }

        send.addEventListener(
            "click",
            sendMessage
        );

        input.addEventListener(
            "keydown",
            event => {
                if (
                    event.key ===
                        "Enter" &&
                    !event.shiftKey
                ) {
                    event.preventDefault();

                    sendMessage();
                }
            }
        );

        window.addEventListener(
            "message",
            event => {
                const message =
                    event.data;

                if (
                    message.type ===
                    "response"
                ) {
                    addMessage(
                        "assistant",
                        message.content
                    );

                    send.disabled =
                        false;

                    input.focus();

                    return;
                }

                if (
                    message.type ===
                    "error"
                ) {
                    addMessage(
                        "error",
                        "Error: " +
                            message.content
                    );

                    send.disabled =
                        false;

                    input.focus();

                    return;
                }

                if (
                    message.type ===
                    "editProposal"
                ) {
                    addProposal(
                        message.proposal
                    );

                    send.disabled =
                        false;

                    input.focus();

                    return;
                }
            }
        );

    </script>

</body>
</html>`;
}
