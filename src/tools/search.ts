import * as fs from "fs/promises";
import * as path from "path";

export interface SearchMatch {
    file: string;
    line: number;
    content: string;
}

export interface SearchResult {
    query: string;
    totalMatches: number;
    truncated: boolean;
    matches: SearchMatch[];
}

export class SearchTools {
    private readonly workspaceRoot: string;

    private readonly ignoredDirectories =
        new Set([
            "node_modules",
            ".git",
            "dist",
            "out",
            "build",
            ".next",
            ".nuxt",
            ".turbo",
            ".cache",
            "coverage",
            "__pycache__",
            ".venv",
            "venv",
            "vendor"
        ]);

    private readonly maxFileSize =
        2 * 1024 * 1024;

    private readonly maxResults =
        200;

    constructor(
        workspaceRoot: string
    ) {
        this.workspaceRoot =
            path.resolve(
                workspaceRoot
            );
    }

    async searchFiles(
        query: string
    ): Promise<SearchResult> {

        const normalizedQuery =
            query.trim();

        if (
            normalizedQuery === ""
        ) {
            throw new Error(
                "Search query cannot be empty."
            );
        }

        const matches: SearchMatch[] = [];

        let totalMatches = 0;

        let truncated = false;

        await this.searchDirectory(
            this.workspaceRoot,
            normalizedQuery,
            matches,
            {
                get total() {
                    return totalMatches;
                },

                set total(value: number) {
                    totalMatches = value;
                }
            },
            {
                get truncated() {
                    return truncated;
                },

                set truncated(value: boolean) {
                    truncated = value;
                }
            }
        );

        return {
            query:
                normalizedQuery,

            totalMatches,

            truncated,

            matches
        };
    }

    private async searchDirectory(
        directory: string,
        query: string,
        matches: SearchMatch[],
        counter: {
            total: number;
        },
        state: {
            truncated: boolean;
        }
    ): Promise<void> {

        if (
            state.truncated
        ) {
            return;
        }

        let entries:
            import("fs").Dirent[];

        try {

            entries =
                await fs.readdir(
                    directory,
                    {
                        withFileTypes:
                            true
                    }
                );

        } catch {

            return;
        }

        for (
            const entry
            of entries
        ) {

            if (
                state.truncated
            ) {
                return;
            }

            const entryName =
                entry.name;

            const fullPath =
                path.join(
                    directory,
                    entryName
                );

            // ------------------------------------------
            // SKIP IGNORED DIRECTORIES
            // ------------------------------------------

            if (
                entry.isDirectory() &&
                this.ignoredDirectories.has(
                    entryName
                )
            ) {
                continue;
            }

            // ------------------------------------------
            // RECURSE INTO DIRECTORIES
            // ------------------------------------------

            if (
                entry.isDirectory()
            ) {

                await this.searchDirectory(
                    fullPath,
                    query,
                    matches,
                    counter,
                    state
                );

                continue;
            }

            // ------------------------------------------
            // ONLY SEARCH REGULAR FILES
            // ------------------------------------------

            if (
                !entry.isFile()
            ) {
                continue;
            }

            // ------------------------------------------
            // SKIP FILES THAT ARE TOO LARGE
            // ------------------------------------------

            let stats;

            try {

                stats =
                    await fs.stat(
                        fullPath
                    );

            } catch {

                continue;
            }

            if (
                stats.size >
                this.maxFileSize
            ) {
                continue;
            }

            // ------------------------------------------
            // READ FILE
            // ------------------------------------------

            let content: string;

            try {

                content =
                    await fs.readFile(
                        fullPath,
                        "utf-8"
                    );

            } catch {

                continue;
            }

            // ------------------------------------------
            // SKIP BINARY FILES
            // ------------------------------------------

            if (
                this.looksBinary(
                    content
                )
            ) {
                continue;
            }

            // ------------------------------------------
            // SEARCH LINE BY LINE
            // ------------------------------------------

            const lines =
                content.split(
                    /\r?\n/
                );

            for (
                let index = 0;
                index < lines.length;
                index++
            ) {

                if (
                    state.truncated
                ) {
                    return;
                }

                const line =
                    lines[index];

                if (
                    line
                        .toLowerCase()
                        .includes(
                            query.toLowerCase()
                        )
                ) {

                    counter.total++;

                    const relativePath =
                        path.relative(
                            this.workspaceRoot,
                            fullPath
                        );

                    matches.push({
                        file:
                            relativePath,

                        line:
                            index + 1,

                        content:
                            line.trim()
                    });

                    if (
                        matches.length >=
                        this.maxResults
                    ) {

                        state.truncated =
                            true;

                        return;
                    }
                }
            }
        }
    }

    private looksBinary(
        content: string
    ): boolean {

        const sample =
            content.slice(
                0,
                4096
            );

        for (
            let index = 0;
            index < sample.length;
            index++
        ) {

            if (
                sample.charCodeAt(
                    index
                ) === 0
            ) {
                return true;
            }
        }

        return false;
    }
}