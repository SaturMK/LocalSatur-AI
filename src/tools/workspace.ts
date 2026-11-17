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

    private assertInside(
        root: string,
        target: string
    ): void {
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
    }

    /**
     * Resolve symlinks so a link inside the workspace cannot point
     * outside of it (audit S4).
     *
     * The final segment may not exist yet (new files), so the deepest
     * existing ancestor is resolved instead.
     */
    private async resolveRealPath(
        target: string
    ): Promise<string> {
        try {
            return await fs.realpath(
                target
            );
        } catch {
            let existing =
                path.dirname(target);

            while (
                existing !==
                path.dirname(existing)
            ) {
                try {
                    const resolved =
                        await fs.realpath(
                            existing
                        );

                    return path.join(
                        resolved,
                        path.relative(
                            existing,
                            target
                        )
                    );
                } catch {
                    existing =
                        path.dirname(existing);
                }
            }

            return target;
        }
    }

    private async resolveSafePath(
        relativePath: string
    ): Promise<string> {
        const root =
            path.resolve(
                this.getWorkspaceRoot()
            );

        const target =
            path.resolve(
                root,
                relativePath
            );

        this.assertInside(
            root,
            target
        );

        /*
         * The workspace root itself may be reached
         * through a symlink (e.g. a mounted folder).
         */
        const realRoot = await fs.realpath(root).catch(() => root);

        const realTarget = await this.resolveRealPath(target);

        this.assertInside(
            realRoot,
            realTarget
        );

        return target;
    }

    async listDirectory(
        relativePath: string = ""
    ): Promise<WorkspaceFile[]> {
        const targetPath =
            await this.resolveSafePath(
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
            await this.resolveSafePath(
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
            await this.resolveSafePath(
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

    async deleteFile(
        relativePath: string
    ): Promise<void> {
        const targetPath = await this.resolveSafePath(relativePath);
        await fs.unlink(targetPath);
    }

    async renameFile(
        sourcePath: string,
        targetPath: string
    ): Promise<void> {
        const source = await this.resolveSafePath(sourcePath);
        const target = await this.resolveSafePath(targetPath);

        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.rename(source, target);
    }

    async fileExists(
        relativePath: string
    ): Promise<boolean> {
        const targetPath =
            await this.resolveSafePath(
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

    async getAbsolutePath(
        relativePath: string
    ): Promise<string> {
        return await this.resolveSafePath(
            relativePath
        );
    }
}
