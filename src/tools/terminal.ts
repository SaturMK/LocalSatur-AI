import {
    spawn
} from "child_process";

export interface TerminalResult {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    success: boolean;
    canceled?: boolean;
    timedOut?: boolean;
    truncated?: boolean;
}

export class TerminalTools {
    private readonly workspaceRoot: string;

    constructor(
        workspaceRoot: string
    ) {
        this.workspaceRoot =
            workspaceRoot;
    }

    /**
     * Commands that LocalSatur AI is currently
     * allowed to execute automatically.
     *
     * Dangerous or modifying commands such as:
     *
     * npm install
     * npm uninstall
     * git commit
     * git push
     * del
     * rm
     * powershell
     *
     * are intentionally NOT allowed yet.
     */
    private readonly allowedCommands = [
        "npm run compile",
        "npm run lint",
        "npm test",
        "npm run check-types",
        "git status --short",
        "git diff --stat",
        "git diff",
        "node --version",
        "npm --version",
        "tsc --noEmit"
    ];

    private isCommandAllowed(
        command: string
    ): boolean {
        const normalized =
            command
                .trim()
                .replace(
                    /\s+/g,
                    " "
                );

        return this.allowedCommands
            .some(
                allowed =>
                    normalized ===
                    allowed
            );
    }

    async runCommand(
        command: string,
        signal?: AbortSignal,
        onOutput?: (
            stream: "stdout" | "stderr",
            chunk: string
        ) => void
    ): Promise<TerminalResult> {

        const normalized =
            command
                .trim()
                .replace(
                    /\s+/g,
                    " "
                );

        if (
            normalized === ""
        ) {
            throw new Error(
                "Command cannot be empty."
            );
        }

        if (
            !this.isCommandAllowed(
                normalized
            )
        ) {
            throw new Error(
                `Command is not allowed by LocalSatur AI safety policy: ${normalized}`
            );
        }

        if (signal?.aborted) {
            return {
                command: normalized,
                exitCode: -1,
                stdout: "",
                stderr: "Command was canceled before it started.",
                success: false,
                canceled: true
            };
        }

        return await new Promise<TerminalResult>(resolve => {
            const maxOutputBytes = 10 * 1024 * 1024;
            let stdout = "";
            let stderr = "";
            let outputBytes = 0;
            let timedOut = false;
            let canceled = false;
            let settled = false;

            const process = spawn(normalized, {
                cwd: this.workspaceRoot,
                shell: true,
                windowsHide: true
            });

            const finish = (
                exitCode: number,
                errorMessage = ""
            ): void => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timeout);
                signal?.removeEventListener("abort", cancel);

                if (errorMessage) {
                    stderr += errorMessage;
                }

                resolve({
                    command: normalized,
                    exitCode,
                    stdout,
                    stderr,
                    success: exitCode === 0 && !canceled && !timedOut,
                    canceled,
                    timedOut,
                    truncated: outputBytes >= maxOutputBytes
                });
            };

            const appendOutput = (
                stream: "stdout" | "stderr",
                chunk: Buffer
            ): void => {
                if (outputBytes >= maxOutputBytes) {
                    return;
                }

                const text = chunk.toString("utf-8");
                const remaining = maxOutputBytes - outputBytes;
                const limited = text.slice(0, remaining);
                outputBytes += Buffer.byteLength(limited);

                if (stream === "stdout") {
                    stdout += limited;
                } else {
                    stderr += limited;
                }

                if (limited) {
                    onOutput?.(stream, limited);
                }
            };

            process.stdout?.on("data", (chunk: Buffer) =>
                appendOutput("stdout", chunk)
            );
            process.stderr?.on("data", (chunk: Buffer) =>
                appendOutput("stderr", chunk)
            );
            process.on("error", error => finish(1, error.message));
            process.on("close", code => finish(code ?? 1));

            const cancel = (): void => {
                canceled = true;
                process.kill();
            };

            const timeout = setTimeout(() => {
                timedOut = true;
                process.kill();
            }, 120_000);

            signal?.addEventListener("abort", cancel, { once: true });
        });
    }
}

