import * as fs from "fs/promises";
import * as path from "path";

export interface ProjectAnalysis {
    root: string;
    projectType: string[];
    languages: string[];
    frameworks: string[];
    packageManagers: string[];
    databases: string[];
    packageFiles: string[];
    configFiles: string[];
}

export class ProjectAnalyzer {
    private readonly root: string;

    constructor(
        workspaceRoot: string
    ) {
        this.root =
            path.resolve(
                workspaceRoot
            );
    }

    async analyze(): Promise<ProjectAnalysis> {
        const entries =
            await this.safeReadDirectory(
                this.root
            );

        const files =
            entries
                .filter(
                    entry =>
                        entry.isFile()
                )
                .map(
                    entry =>
                        entry.name
                );

        const directories =
            entries
                .filter(
                    entry =>
                        entry.isDirectory()
                )
                .map(
                    entry =>
                        entry.name
                );

        const languages =
            new Set<string>();

        const frameworks =
            new Set<string>();

        const packageManagers =
            new Set<string>();

        const databases =
            new Set<string>();

        const projectType =
            new Set<string>();

        const packageFiles:
            string[] = [];

        const configFiles:
            string[] = [];

        // --------------------------------------------------
        // PACKAGE MANAGERS
        // --------------------------------------------------

        if (
            files.includes(
                "package-lock.json"
            )
        ) {
            packageManagers.add(
                "npm"
            );
        }

        if (
            files.includes(
                "pnpm-lock.yaml"
            )
        ) {
            packageManagers.add(
                "pnpm"
            );
        }

        if (
            files.includes(
                "yarn.lock"
            )
        ) {
            packageManagers.add(
                "yarn"
            );
        }

        if (
            files.includes(
                "bun.lockb"
            ) ||
            files.includes(
                "bun.lock"
            )
        ) {
            packageManagers.add(
                "bun"
            );
        }

        // --------------------------------------------------
        // PACKAGE FILES
        // --------------------------------------------------

        if (
            files.includes(
                "package.json"
            )
        ) {
            packageFiles.push(
                "package.json"
            );

            languages.add(
                "JavaScript/TypeScript"
            );

            projectType.add(
                "Node.js"
            );

            const packageJson =
                await this.readJson(
                    "package.json"
                );

            this.detectNodeProject(
                packageJson,
                frameworks,
                databases,
                languages,
                projectType
            );
        }

        if (
            files.includes(
                "composer.json"
            )
        ) {
            packageFiles.push(
                "composer.json"
            );

            languages.add(
                "PHP"
            );

            projectType.add(
                "PHP"
            );

            const composerJson =
                await this.readJson(
                    "composer.json"
                );

            this.detectPhpProject(
                composerJson,
                frameworks
            );
        }

        if (
            files.includes(
                "requirements.txt"
            )
        ) {
            packageFiles.push(
                "requirements.txt"
            );

            languages.add(
                "Python"
            );

            projectType.add(
                "Python"
            );
        }

        if (
            files.includes(
                "pyproject.toml"
            )
        ) {
            packageFiles.push(
                "pyproject.toml"
            );

            languages.add(
                "Python"
            );

            projectType.add(
                "Python"
            );
        }

        if (
            files.includes(
                "Pipfile"
            )
        ) {
            packageFiles.push(
                "Pipfile"
            );

            languages.add(
                "Python"
            );

            projectType.add(
                "Python"
            );
        }

        if (
            files.includes(
                "Cargo.toml"
            )
        ) {
            packageFiles.push(
                "Cargo.toml"
            );

            languages.add(
                "Rust"
            );

            projectType.add(
                "Rust"
            );
        }

        if (
            files.includes(
                "go.mod"
            )
        ) {
            packageFiles.push(
                "go.mod"
            );

            languages.add(
                "Go"
            );

            projectType.add(
                "Go"
            );
        }

        if (
            files.includes(
                "pom.xml"
            )
        ) {
            packageFiles.push(
                "pom.xml"
            );

            languages.add(
                "Java"
            );

            projectType.add(
                "Java"
            );
        }

        if (
            files.includes(
                "build.gradle"
            ) ||
            files.includes(
                "build.gradle.kts"
            )
        ) {
            packageFiles.push(
                files.includes(
                    "build.gradle.kts"
                )
                    ? "build.gradle.kts"
                    : "build.gradle"
            );

            languages.add(
                "Java/Kotlin"
            );

            projectType.add(
                "JVM"
            );
        }

        // --------------------------------------------------
        // CONFIGURATION FILES
        // --------------------------------------------------

        const knownConfigFiles = [
            "tsconfig.json",
            "jsconfig.json",
            "vite.config.ts",
            "vite.config.js",
            "next.config.js",
            "next.config.mjs",
            "next.config.ts",
            "nuxt.config.ts",
            "angular.json",
            "webpack.config.js",
            "webpack.config.ts",
            "eslint.config.js",
            "eslint.config.mjs",
            ".eslintrc.json",
            ".prettierrc",
            "prisma",
            "docker-compose.yml",
            "docker-compose.yaml",
            "Dockerfile"
        ];

        for (
            const configFile
            of knownConfigFiles
        ) {
            if (
                files.includes(
                    configFile
                ) ||
                directories.includes(
                    configFile
                )
            ) {
                configFiles.push(
                    configFile
                );
            }
        }

        // --------------------------------------------------
        // TYPESCRIPT
        // --------------------------------------------------

        if (
            files.includes(
                "tsconfig.json"
            )
        ) {
            languages.add(
                "TypeScript"
            );
        }

        // --------------------------------------------------
        // JAVASCRIPT
        // --------------------------------------------------

        const javascriptFiles =
            files.filter(
                file =>
                    file.endsWith(
                        ".js"
                    ) ||
                    file.endsWith(
                        ".mjs"
                    ) ||
                    file.endsWith(
                        ".cjs"
                    )
            );

        if (
            javascriptFiles.length >
            0
        ) {
            languages.add(
                "JavaScript"
            );
        }

        // --------------------------------------------------
        // DATABASE DETECTION
        // --------------------------------------------------

        if (
            directories.includes(
                "prisma"
            )
        ) {
            databases.add(
                "Prisma"
            );

            const prismaSchema =
                path.join(
                    this.root,
                    "prisma",
                    "schema.prisma"
                );

            if (
                await this.exists(
                    prismaSchema
                )
            ) {
                const schema =
                    await this.readAbsoluteFile(
                        prismaSchema
                    );

                this.detectPrismaDatabase(
                    schema,
                    databases
                );
            }
        }

        if (
            files.includes(
                "drizzle.config.ts"
            ) ||
            files.includes(
                "drizzle.config.js"
            )
        ) {
            databases.add(
                "Drizzle ORM"
            );
        }

        if (
            files.includes(
                "knexfile.js"
            ) ||
            files.includes(
                "knexfile.ts"
            )
        ) {
            databases.add(
                "Knex"
            );
        }

        if (
            files.includes(
                "sequelize.config.js"
            ) ||
            files.includes(
                ".sequelizerc"
            )
        ) {
            databases.add(
                "Sequelize"
            );
        }

        // --------------------------------------------------
        // ENVIRONMENT / DATABASE CONFIG
        // --------------------------------------------------

        const envFiles =
            files.filter(
                file =>
                    file === ".env" ||
                    file.startsWith(
                        ".env."
                    )
            );

        if (
            envFiles.length > 0
        ) {
            configFiles.push(
                ...envFiles
            );
        }

        // --------------------------------------------------
        // STANDALONE DATABASE INDICATORS
        // --------------------------------------------------

        if (
            files.includes(
                "docker-compose.yml"
            ) ||
            files.includes(
                "docker-compose.yaml"
            )
        ) {
            const composeFile =
                files.includes(
                    "docker-compose.yml"
                )
                    ? "docker-compose.yml"
                    : "docker-compose.yaml";

            const compose =
                await this.readFile(
                    composeFile
                );

            this.detectDatabaseFromText(
                compose,
                databases
            );
        }

        // --------------------------------------------------
        // FINAL RESULT
        // --------------------------------------------------

        return {
            root:
                this.root,

            projectType:
                Array.from(
                    projectType
                ).sort(),

            languages:
                Array.from(
                    languages
                ).sort(),

            frameworks:
                Array.from(
                    frameworks
                ).sort(),

            packageManagers:
                Array.from(
                    packageManagers
                ).sort(),

            databases:
                Array.from(
                    databases
                ).sort(),

            packageFiles:
                Array.from(
                    new Set(
                        packageFiles
                    )
                ).sort(),

            configFiles:
                Array.from(
                    new Set(
                        configFiles
                    )
                ).sort()
        };
    }

    private detectNodeProject(
        packageJson: Record<string, unknown>,
        frameworks: Set<string>,
        databases: Set<string>,
        languages: Set<string>,
        projectType: Set<string>
    ): void {

        const dependencies = {
            ...this.asRecord(
                packageJson.dependencies
            ),
            ...this.asRecord(
                packageJson.devDependencies
            )
        };

        const dependencyNames =
            Object.keys(
                dependencies
            );

        // --------------------------------------------------
        // FRAMEWORKS
        // --------------------------------------------------

        if (
            dependencyNames.includes(
                "react"
            )
        ) {
            frameworks.add(
                "React"
            );
        }

        if (
            dependencyNames.includes(
                "next"
            )
        ) {
            frameworks.add(
                "Next.js"
            );
        }

        if (
            dependencyNames.includes(
                "vue"
            )
        ) {
            frameworks.add(
                "Vue"
            );
        }

        if (
            dependencyNames.includes(
                "nuxt"
            )
        ) {
            frameworks.add(
                "Nuxt"
            );
        }

        if (
            dependencyNames.includes(
                "@angular/core"
            )
        ) {
            frameworks.add(
                "Angular"
            );
        }

        if (
            dependencyNames.includes(
                "express"
            )
        ) {
            frameworks.add(
                "Express"
            );
        }

        if (
            dependencyNames.includes(
                "fastify"
            )
        ) {
            frameworks.add(
                "Fastify"
            );
        }

        if (
            dependencyNames.includes(
                "@nestjs/core"
            )
        ) {
            frameworks.add(
                "NestJS"
            );
        }

        if (
            dependencyNames.includes(
                "electron"
            )
        ) {
            frameworks.add(
                "Electron"
            );
        }

        if (
            dependencyNames.includes(
                "vite"
            )
        ) {
            frameworks.add(
                "Vite"
            );
        }

        if (
            dependencyNames.includes(
                "svelte"
            )
        ) {
            frameworks.add(
                "Svelte"
            );
        }

        // --------------------------------------------------
        // DATABASES / ORMS
        // --------------------------------------------------

        if (
            dependencyNames.includes(
                "prisma"
            ) ||
            dependencyNames.includes(
                "@prisma/client"
            )
        ) {
            databases.add(
                "Prisma"
            );
        }

        if (
            dependencyNames.includes(
                "drizzle-orm"
            )
        ) {
            databases.add(
                "Drizzle ORM"
            );
        }

        if (
            dependencyNames.includes(
                "mongoose"
            )
        ) {
            databases.add(
                "MongoDB / Mongoose"
            );
        }

        if (
            dependencyNames.includes(
                "mysql2"
            ) ||
            dependencyNames.includes(
                "mysql"
            )
        ) {
            databases.add(
                "MySQL"
            );
        }

        if (
            dependencyNames.includes(
                "pg"
            )
        ) {
            databases.add(
                "PostgreSQL"
            );
        }

        if (
            dependencyNames.includes(
                "better-sqlite3"
            ) ||
            dependencyNames.includes(
                "sqlite3"
            )
        ) {
            databases.add(
                "SQLite"
            );
        }

        // --------------------------------------------------
        // LANGUAGE
        // --------------------------------------------------

        if (
            dependencyNames.includes(
                "typescript"
            )
        ) {
            languages.add(
                "TypeScript"
            );
        }

        if (
            dependencyNames.includes(
                "tsx"
            ) ||
            dependencyNames.includes(
                "ts-node"
            )
        ) {
            languages.add(
                "TypeScript"
            );
        }

        // --------------------------------------------------
        // PROJECT TYPE
        // --------------------------------------------------

        const scripts =
            this.asRecord(
                packageJson.scripts
            );

        if (
            Object.keys(
                scripts
            ).some(
                script =>
                    script ===
                    "compile"
            )
        ) {
            projectType.add(
                "Buildable Node.js project"
            );
        }
    }

    private detectPhpProject(
        composerJson: Record<string, unknown>,
        frameworks: Set<string>
    ): void {

        const require =
            this.asRecord(
                composerJson.require
            );

        const requireDev =
            this.asRecord(
                composerJson.requireDev
            );

        const dependencies = {
            ...require,
            ...requireDev
        };

        const names =
            Object.keys(
                dependencies
            );

        if (
            names.some(
                name =>
                    name.startsWith(
                        "laravel/"
                    )
            )
        ) {
            frameworks.add(
                "Laravel"
            );
        }

        if (
            names.some(
                name =>
                    name.startsWith(
                        "symfony/"
                    )
            )
        ) {
            frameworks.add(
                "Symfony"
            );
        }
    }

    private detectPrismaDatabase(
        schema: string,
        databases: Set<string>
    ): void {

        const providerMatches =
            schema.match(
                /provider\s*=\s*"([^"]+)"/g
            );

        if (
            !providerMatches
        ) {
            return;
        }

        for (
            const match
            of providerMatches
        ) {
            const provider =
                match.match(
                    /"([^"]+)"/
                )?.[1];

            if (!provider) {
                continue;
            }

            switch (
                provider
                    .toLowerCase()
            ) {
                case "postgresql":
                    databases.add(
                        "PostgreSQL"
                    );
                    break;

                case "mysql":
                    databases.add(
                        "MySQL"
                    );
                    break;

                case "sqlite":
                    databases.add(
                        "SQLite"
                    );
                    break;

                case "mongodb":
                    databases.add(
                        "MongoDB"
                    );
                    break;

                case "sqlserver":
                    databases.add(
                        "SQL Server"
                    );
                    break;
            }
        }
    }

    private detectDatabaseFromText(
        text: string,
        databases: Set<string>
    ): void {

        const lower =
            text.toLowerCase();

        if (
            lower.includes(
                "postgres"
            )
        ) {
            databases.add(
                "PostgreSQL"
            );
        }

        if (
            lower.includes(
                "mysql"
            )
        ) {
            databases.add(
                "MySQL"
            );
        }

        if (
            lower.includes(
                "mariadb"
            )
        ) {
            databases.add(
                "MariaDB"
            );
        }

        if (
            lower.includes(
                "mongo"
            )
        ) {
            databases.add(
                "MongoDB"
            );
        }

        if (
            lower.includes(
                "redis"
            )
        ) {
            databases.add(
                "Redis"
            );
        }
    }

    private async safeReadDirectory(
        directory: string
    ): Promise<
        import("fs").Dirent[]
    > {

        try {
            return await fs.readdir(
                directory,
                {
                    withFileTypes:
                        true
                }
            );
        } catch {
            return [];
        }
    }

    private async exists(
        target: string
    ): Promise<boolean> {

        try {
            await fs.access(
                target
            );

            return true;
        } catch {
            return false;
        }
    }

    private async readFile(
        relativePath: string
    ): Promise<string> {

        const target =
            path.join(
                this.root,
                relativePath
            );

        return this.readAbsoluteFile(
            target
        );
    }

    private async readAbsoluteFile(
        target: string
    ): Promise<string> {

        try {
            return await fs.readFile(
                target,
                "utf-8"
            );
        } catch {
            return "";
        }
    }

    private async readJson(
        relativePath: string
    ): Promise<
        Record<string, unknown>
    > {

        const content =
            await this.readFile(
                relativePath
            );

        if (
            content.trim() ===
            ""
        ) {
            return {};
        }

        try {
            const parsed =
                JSON.parse(
                    content
                );

            return this.asRecord(
                parsed
            );
        } catch {
            return {};
        }
    }

    private asRecord(
        value: unknown
    ): Record<string, unknown> {

        if (
            typeof value ===
                "object" &&
            value !== null &&
            !Array.isArray(
                value
            )
        ) {
            return value as Record<
                string,
                unknown
            >;
        }

        return {};
    }
}