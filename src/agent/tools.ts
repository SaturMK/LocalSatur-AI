import { randomUUID } from "crypto";

import {
    WorkspaceTools
} from "../tools/workspace";

import {
    TerminalTools
} from "../tools/terminal";

import {
    ProjectAnalyzer
} from "./project-analyzer";

import {
    SearchTools
} from "../tools/search";

import {
    VSCodeContextTools
} from "../tools/vscode-context";

import {
    FileEditProposal
} from "./edit";


export interface AgentToolDefinition {
    type: "function";

    function: {
        name: string;
        description: string;

        parameters: {
            type: "object";
            properties: Record<
                string,
                unknown
            >;
            required?: string[];
        };
    };
}


export class ToolManager {

    private readonly workspaceTools:
        WorkspaceTools;

    private readonly terminalTools:
        TerminalTools;

    private readonly projectAnalyzer:
        ProjectAnalyzer;

    private readonly searchTools:
        SearchTools;

    private readonly vscodeContext:
        VSCodeContextTools;

    private readonly proposals =
        new Map<
            string,
            FileEditProposal
        >();


    constructor(
        workspaceTools: WorkspaceTools,
        vscodeContext: VSCodeContextTools
    ) {

        this.workspaceTools =
            workspaceTools;

        this.vscodeContext =
            vscodeContext;

        this.terminalTools =
            new TerminalTools(
                workspaceTools.getRoot()
            );

        this.projectAnalyzer =
            new ProjectAnalyzer(
                workspaceTools.getRoot()
            );

        this.searchTools =
            new SearchTools(
                workspaceTools.getRoot()
            );
    }


    // ================================================================
    // TOOL DEFINITIONS
    // ================================================================

    getDefinitions():
        AgentToolDefinition[] {

        return [

            // ========================================================
            // VS CODE CONTEXT
            // ========================================================

            {
                type:
                    "function",

                function: {
                    name:
                        "get_active_editor",

                    description:
                        "Get the best available VS Code editor context. Use this when the user asks about the file currently being viewed or edited. Do not guess the current file.",

                    parameters: {
                        type:
                            "object",

                        properties: {}
                    }
                }
            },


            {
                type:
                    "function",

                function: {
                    name:
                        "get_selection",

                    description:
                        "Get the currently selected text in the VS Code editor. Use this when the user refers to selected code or text.",

                    parameters: {
                        type:
                            "object",

                        properties: {}
                    }
                }
            },


            {
                type:
                    "function",

                function: {
                    name:
                        "get_open_files",

                    description:
                        "Get files currently open or visible in VS Code.",

                    parameters: {
                        type:
                            "object",

                        properties: {}
                    }
                }
            },


            {
                type:
                    "function",

                function: {
                    name:
                        "open_file",

                    description:
                        "Open a workspace file in the VS Code editor.",

                    parameters: {
                        type:
                            "object",

                        properties: {

                            path: {
                                type:
                                    "string",

                                description:
                                    "Relative workspace path of the file to open."
                            }
                        },

                        required: [
                            "path"
                        ]
                    }
                }
            },


            {
                type:
                    "function",

                function: {
                    name:
                        "reveal_line",

                    description:
                        "Reveal a specific line in the current VS Code editor.",

                    parameters: {
                        type:
                            "object",

                        properties: {

                            line: {
                                type:
                                    "number",

                                description:
                                    "One-based line number."
                            }
                        },

                        required: [
                            "line"
                        ]
                    }
                }
            },


            // ========================================================
            // WORKSPACE
            // ========================================================

            {
                type:
                    "function",

                function: {
                    name:
                        "list_directory",

                    description:
                        "List files and directories in the LocalSatur AI workspace. Use this when inspecting project structure.",

                    parameters: {
                        type:
                            "object",

                        properties: {

                            path: {
                                type:
                                    "string",

                                description:
                                    "Relative directory path. Use an empty string for the workspace root."
                            }
                        }
                    }
                }
            },


            {
                type:
                    "function",

                function: {
                    name:
                        "read_file",

                    description:
                        "Read the complete contents of a file in the LocalSatur AI workspace.",

                    parameters: {
                        type:
                            "object",

                        properties: {

                            path: {
                                type:
                                    "string",

                                description:
                                    "Relative path to the file to read."
                            }
                        },

                        required: [
                            "path"
                        ]
                    }
                }
            },


            // ========================================================
            // PROJECT ANALYSIS
            // ========================================================

            {
                type:
                    "function",

                function: {
                    name:
                        "analyze_project",

                    description:
                        "Analyze the current workspace and detect project type, languages, frameworks, package managers, databases, package files, and configuration files.",

                    parameters: {
                        type:
                            "object",

                        properties: {}
                    }
                }
            },


            // ========================================================
            // SEARCH
            // ========================================================

            {
                type:
                    "function",

                function: {
                    name:
                        "search_files",

                    description:
                        "Search the workspace recursively for a text string. Returns matching file paths, line numbers, and matching lines.",

                    parameters: {
                        type:
                            "object",

                        properties: {

                            query: {
                                type:
                                    "string",

                                description:
                                    "Text to search for. Search is case-insensitive."
                            }
                        },

                        required: [
                            "query"
                        ]
                    }
                }
            },


            // ========================================================
            // EDIT PROPOSAL
            // ========================================================

            {
                type:
                    "function",

                function: {
                    name:
                        "propose_file_edit",

                    description:
                        "Create a file edit proposal. This does NOT modify the file. The user must approve the proposal before it can be applied.",

                    parameters: {
                        type:
                            "object",

                        properties: {

                            path: {
                                type:
                                    "string",

                                description:
                                    "Relative path of the file to edit."
                            },

                            content: {
                                type:
                                    "string",

                                description:
                                    "The complete proposed contents of the file."
                            },

                            reason: {
                                type:
                                    "string",

                                description:
                                    "Why the proposed change is needed."
                            }
                        },

                        required: [
                            "path",
                            "content",
                            "reason"
                        ]
                    }
                }
            },


            // ========================================================
            // TERMINAL
            // ========================================================

            {
                type:
                    "function",

                function: {
                    name:
                        "run_command",

                    description:
                        "Run a safe project verification command inside the LocalSatur AI workspace. Only commands permitted by LocalSatur AI safety rules can execute.",

                    parameters: {
                        type:
                            "object",

                        properties: {

                            command: {
                                type:
                                    "string",

                                description:
                                    "The exact verification command to run."
                            }
                        },

                        required: [
                            "command"
                        ]
                    }
                }
            }
        ];
    }


    // ================================================================
    // TOOL EXECUTION
    // ================================================================

    async execute(
        name: string,
        argumentsObject:
            Record<
                string,
                unknown
            >
    ): Promise<string> {

        switch (name) {


            // ========================================================
            // GET ACTIVE EDITOR
            // ========================================================

            case "get_active_editor": {

                const result =
                    this.vscodeContext
                        .getActiveEditor();

                return JSON.stringify(
                    result,
                    null,
                    2
                );
            }


            // ========================================================
            // GET SELECTION
            // ========================================================

            case "get_selection": {

                const result =
                    this.vscodeContext
                        .getSelection();

                return JSON.stringify(
                    result,
                    null,
                    2
                );
            }


            // ========================================================
            // GET OPEN FILES
            // ========================================================

            case "get_open_files": {

                const result =
                    this.vscodeContext
                        .getOpenFiles();

                return JSON.stringify(
                    result,
                    null,
                    2
                );
            }


            // ========================================================
            // OPEN FILE
            // ========================================================

            case "open_file": {

                const relativePath =
                    argumentsObject.path;

                if (
                    typeof relativePath !==
                        "string" ||
                    relativePath.trim() ===
                        ""
                ) {

                    throw new Error(
                        "open_file requires a valid file path."
                    );
                }

                try {

                    const result =
                        await this.vscodeContext
                            .openFile(
                                relativePath
                            );

                    return JSON.stringify(
                        result,
                        null,
                        2
                    );

                } catch (error) {

                    return JSON.stringify(
                        {
                            success:
                                false,

                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        },
                        null,
                        2
                    );
                }
            }


            // ========================================================
            // REVEAL LINE
            // ========================================================

            case "reveal_line": {

                const line =
                    Number(
                        argumentsObject.line
                    );

                if (
                    !Number.isFinite(line) ||
                    line < 1
                ) {

                    throw new Error(
                        "reveal_line requires a valid one-based line number."
                    );
                }

                const success =
                    await this.vscodeContext
                        .revealLine(
                            line
                        );

                return JSON.stringify(
                    {
                        success
                    },
                    null,
                    2
                );
            }


            // ========================================================
            // LIST DIRECTORY
            // ========================================================

            case "list_directory": {

                const relativePath =
                    typeof argumentsObject.path ===
                        "string"
                        ? argumentsObject.path
                        : "";

                const files =
                    await this.workspaceTools
                        .listDirectory(
                            relativePath
                        );

                return JSON.stringify(
                    files,
                    null,
                    2
                );
            }


            // ========================================================
            // READ FILE
            // ========================================================

            case "read_file": {

                const relativePath =
                    argumentsObject.path;

                if (
                    typeof relativePath !==
                        "string" ||
                    relativePath.trim() ===
                        ""
                ) {

                    throw new Error(
                        "read_file requires a valid file path."
                    );
                }

                return await this.workspaceTools
                    .readFile(
                        relativePath
                    );
            }


            // ========================================================
            // ANALYZE PROJECT
            // ========================================================

            case "analyze_project": {

                const analysis =
                    await this.projectAnalyzer
                        .analyze();

                return JSON.stringify(
                    analysis,
                    null,
                    2
                );
            }


            // ========================================================
            // SEARCH FILES
            // ========================================================

            case "search_files": {

                const query =
                    argumentsObject.query;

                if (
                    typeof query !==
                        "string" ||
                    query.trim() ===
                        ""
                ) {

                    throw new Error(
                        "search_files requires a valid search query."
                    );
                }

                /*
                 * IMPORTANT:
                 * Your existing SearchTools implementation
                 * uses searchFiles(), not search().
                 */
                const result =
                    await this.searchTools
                        .searchFiles(
                            query
                        );

                return JSON.stringify(
                    result,
                    null,
                    2
                );
            }


            // ========================================================
            // PROPOSE FILE EDIT
            // ========================================================

            case "propose_file_edit": {

                return await this
                    .proposeFileEdit(
                        argumentsObject
                    );
            }


            // ========================================================
            // RUN COMMAND
            // ========================================================

            case "run_command": {

                const command =
                    argumentsObject.command;

                if (
                    typeof command !==
                        "string" ||
                    command.trim() ===
                        ""
                ) {

                    throw new Error(
                        "run_command requires a valid command."
                    );
                }

                const result =
                    await this.terminalTools
                        .runCommand(
                            command
                        );

                return JSON.stringify(
                    result,
                    null,
                    2
                );
            }


            // ========================================================
            // UNKNOWN TOOL
            // ========================================================

            default:

                throw new Error(
                    `Unknown tool: ${name}`
                );
        }
    }


    // ================================================================
    // CREATE EDIT PROPOSAL
    // ================================================================

    private async proposeFileEdit(
        argumentsObject:
            Record<
                string,
                unknown
            >
    ): Promise<string> {

        const relativePath =
            argumentsObject.path;

        const proposedContent =
            argumentsObject.content;

        const reason =
            argumentsObject.reason;


        if (
            typeof relativePath !==
                "string" ||
            relativePath.trim() ===
                ""
        ) {

            throw new Error(
                "propose_file_edit requires a valid file path."
            );
        }


        if (
            typeof proposedContent !==
                "string"
        ) {

            throw new Error(
                "propose_file_edit requires string content."
            );
        }


        if (
            typeof reason !==
                "string" ||
            reason.trim() ===
                ""
        ) {

            throw new Error(
                "propose_file_edit requires a reason."
            );
        }


        const exists =
            await this.workspaceTools
                .fileExists(
                    relativePath
                );


        const originalContent =
            exists
                ? await this.workspaceTools
                    .readFile(
                        relativePath
                    )
                : "";


        const proposal:
            FileEditProposal = {

            id:
                randomUUID(),

            path:
                relativePath,

            originalContent,

            proposedContent,

            reason
        };


        this.proposals.set(
            proposal.id,
            proposal
        );


        return JSON.stringify(
            {
                status:
                    "proposal_created",

                proposalId:
                    proposal.id,

                path:
                    proposal.path,

                reason:
                    proposal.reason,

                originalExists:
                    exists,

                message:
                    "The file has NOT been modified. User approval is required before the proposal can be applied."
            },
            null,
            2
        );
    }


    // ================================================================
    // GET PROPOSAL
    // ================================================================

    getProposal(
        proposalId: string
    ):
        FileEditProposal |
        undefined {

        return this.proposals.get(
            proposalId
        );
    }


    // ================================================================
    // REMOVE PROPOSAL
    // ================================================================

    removeProposal(
        proposalId: string
    ): void {

        this.proposals.delete(
            proposalId
        );
    }


    // ================================================================
    // APPLY PROPOSAL
    // ================================================================

    async applyProposal(
        proposalId: string
    ): Promise<void> {

        const proposal =
            this.proposals.get(
                proposalId
            );


        if (!proposal) {

            throw new Error(
                "Edit proposal not found or has expired."
            );
        }


        const currentExists =
            await this.workspaceTools
                .fileExists(
                    proposal.path
                );


        const currentContent =
            currentExists
                ? await this.workspaceTools
                    .readFile(
                        proposal.path
                    )
                : "";


        /*
         * Prevent overwriting a file that changed
         * after the proposal was created.
         */
        if (
            currentContent !==
                proposal.originalContent
        ) {

            throw new Error(
                `File changed after the proposal was created: ${proposal.path}`
            );
        }


        /*
         * Safety guard against malformed or truncated
         * model-generated proposals.
         *
         * Existing files should not suddenly become a
         * small fragment of their previous contents.
         */
        if (currentExists) {

            const original =
                proposal.originalContent;

            const proposed =
                proposal.proposedContent;

            const originalLength =
                original.length;

            const proposedLength =
                proposed.length;

            const originalLineCount =
                original.split(/\r?\n/).length;

            const proposedLineCount =
                proposed.split(/\r?\n/).length;

            const suspiciousPlaceholder =
                /\.\.\.\s*(existing|rest|remaining|other|implementation|code)/i
                    .test(proposed);

            const severelyReduced =
                originalLength >= 2000 &&
                proposedLength < originalLength * 0.5;

            const severelyTruncated =
                originalLineCount >= 40 &&
                proposedLineCount < originalLineCount * 0.5;

            if (
                suspiciousPlaceholder ||
                severelyReduced ||
                severelyTruncated
            ) {

                throw new Error(
                    `Edit proposal rejected for safety: proposed content appears truncated or incomplete for ${proposal.path}. Review the proposal and generate the complete file contents before applying it.`
                );
            }
        }


        /*
         * Create a backup immediately before applying the approved
         * replacement. Keep the backup beside the original file so
         * recovery does not depend on any additional service.
         *
         * The backup uses the original file path plus a timestamp,
         * which prevents an earlier backup from being overwritten.
         */
        if (currentExists) {
            const backupPath =
                `${proposal.path}.localforge-backup-${Date.now()}`;

            await this.workspaceTools.writeFile(
                backupPath,
                currentContent
            );
        }

        await this.workspaceTools
            .writeFile(
                proposal.path,
                proposal.proposedContent
            );


        this.proposals.delete(
            proposalId
        );
    }


    // ================================================================
    // DISPOSE
    // ================================================================

    dispose(): void {

        this.vscodeContext.dispose();

        this.proposals.clear();
    }
}

