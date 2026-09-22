import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

export interface WorkspaceFile {
    name: string;
    path: string;
    type: "file" | "directory";
}

export class WorkspaceTools {
    private readonly fallbackRoot: string;

    constructor(fallbackRoot: string) {
        this.fallbackRoot = fallbackRoot;
    }

    private getWorkspaceRoot(): string {
        const workspaceFolder =
            vscode.workspace.workspaceFolders?.[0];

        if (workspaceFolder) {
            return workspaceFolder.uri.fsPath;
        }

        return this.fallbackRoot;
    }

    private resolveSafePath(
        relativePath: string
    ): string {
        const root =
            path.resolve(
                this.getWorkspaceRoot()
            );

        const target =
            path.resolve(
                root,
                relativePath
            );

        if (
            target !== root &&
            !target.startsWith(
                `${root}${path.sep}`
            )
        ) {
            throw new Error(
                "Access denied: path is outside the workspace."
            );
        }

        return target;
    }

    async listDirectory(
        relativePath: string = ""
    ): Promise<WorkspaceFile[]> {
        const targetPath =
            this.resolveSafePath(
                relativePath
            );

        const entries =
            await fs.readdir(
                targetPath,
                {
                    withFileTypes: true
                }
            );

        const root =
            this.getWorkspaceRoot();

        return entries.map(
            (
                entry
            ): WorkspaceFile => ({
                name: entry.name,

                path:
                    path.relative(
                        root,
                        path.join(
                            targetPath,
                            entry.name
                        )
                    ),

                type:
                    entry.isDirectory()
                        ? "directory"
                        : "file"
            })
        );
    }

    async readFile(
        relativePath: string
    ): Promise<string> {
        const targetPath =
            this.resolveSafePath(
                relativePath
            );

        const stats =
            await fs.stat(
                targetPath
            );

        if (!stats.isFile()) {
            throw new Error(
                `Not a file: ${relativePath}`
            );
        }

        return await fs.readFile(
            targetPath,
            "utf-8"
        );
    }

    async writeFile(
        relativePath: string,
        content: string
    ): Promise<void> {
        const targetPath =
            this.resolveSafePath(
                relativePath
            );

        const parentDirectory =
            path.dirname(
                targetPath
            );

        await fs.mkdir(
            parentDirectory,
            {
                recursive: true
            }
        );

        await fs.writeFile(
            targetPath,
            content,
            "utf-8"
        );
    }

    async fileExists(
        relativePath: string
    ): Promise<boolean> {
        const targetPath =
            this.resolveSafePath(
                relativePath
            );

        try {
            await fs.access(
                targetPath
            );

            return true;
        } catch {
            return false;
        }
    }

    getRoot(): string {
        return this.getWorkspaceRoot();
    }

    getAbsolutePath(
        relativePath: string
    ): string {
        return this.resolveSafePath(
            relativePath
        );
    }
}