import {
    exec
} from "child_process";

import {
    promisify
} from "util";

const execAsync =
    promisify(exec);

export interface TerminalResult {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    success: boolean;
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
        command: string
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

        try {
            const result =
                await execAsync(
                    normalized,
                    {
                        cwd:
                            this.workspaceRoot,

                        windowsHide:
                            true,

                        timeout:
                            120_000,

                        maxBuffer:
                            10 * 1024 * 1024
                    }
                );

            return {
                command:
                    normalized,

                exitCode:
                    0,

                stdout:
                    result.stdout,

                stderr:
                    result.stderr,

                success:
                    true
            };

        } catch (error) {

            const processError =
                error as {
                    code?: number;
                    stdout?: string;
                    stderr?: string;
                    message?: string;
                };

            return {
                command:
                    normalized,

                exitCode:
                    typeof processError.code ===
                    "number"
                        ? processError.code
                        : 1,

                stdout:
                    processError.stdout ??
                    "",

                stderr:
                    processError.stderr ??
                    processError.message ??
                    "",

                success:
                    false
            };
        }
    }
}

