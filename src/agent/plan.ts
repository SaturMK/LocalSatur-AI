/**
 * Structured Plan entities for Plan mode (PRD FR-010).
 *
 * In Plan mode the model is asked to end its response with a fenced
 * `localforge-plan` block containing a JSON plan. This module parses
 * and validates that block. Parsing is defensive by design: model
 * output is untrusted, so any malformed block is left in the message
 * verbatim instead of producing a partial plan.
 */

export type PlanStepAction =
    | "create"
    | "edit"
    | "delete"
    | "verify"
    | "other";

export interface PlanStep {
    title: string;
    files: string[];
    action: PlanStepAction;
}

export interface PlanEntity {
    summary: string;
    steps: PlanStep[];
    risks: string[];
}

/** Fence language the plan block must use. */
export const PLAN_FENCE_LANGUAGE = "localforge-plan";

const VALID_ACTIONS: PlanStepAction[] = [
    "create",
    "edit",
    "delete",
    "verify",
    "other"
];

interface RawPlan {
    summary?: unknown;
    steps?: unknown;
    risks?: unknown;
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((entry): entry is string => typeof entry === "string")
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0)
        .slice(0, 20);
}

function asAction(value: unknown): PlanStepAction {
    return typeof value === "string" &&
        (VALID_ACTIONS as string[]).includes(value)
        ? value as PlanStepAction
        : "other";
}

function parsePlanBlock(block: string): PlanEntity | undefined {
    let raw: RawPlan;

    try {
        raw = JSON.parse(block) as RawPlan;
    } catch {
        return undefined;
    }

    if (raw === null || typeof raw !== "object" || !Array.isArray(raw.steps)) {
        return undefined;
    }

    const steps: PlanStep[] = raw.steps
        .filter(step => step !== null && typeof step === "object")
        .map(step => {
            const record = step as Record<string, unknown>;

            return {
                title:
                    typeof record.title === "string"
                        ? record.title.trim()
                        : "",
                files: asStringArray(record.files),
                action: asAction(record.action)
            };
        })
        .filter(step => step.title.length > 0)
        .slice(0, 50);

    if (steps.length === 0) {
        return undefined;
    }

    return {
        summary:
            typeof raw.summary === "string" && raw.summary.trim()
                ? raw.summary.trim()
                : "",
        steps,
        risks: asStringArray(raw.risks)
    };
}

/**
 * Extract a plan entity from a Plan mode response.
 *
 * Returns the response content with the plan block removed (so the
 * chat shows prose plus a rendered card, not raw JSON) and the
 * parsed plan when a valid block was present. If the block is
 * missing or malformed, the content is returned unchanged and the
 * plan is undefined.
 */
export function extractPlan(
    content: string
): {
    content: string;
    plan?: PlanEntity;
} {
    /*
     * Match the LAST localforge-plan fence in the response. The
     * regex is tolerant of leading whitespace and missing trailing
     * newline.
     */
    const pattern = new RegExp(
        "```" + PLAN_FENCE_LANGUAGE + "\\s*\\n([\\s\\S]*?)\\n?```\\s*$",
        "i"
    );

    const match = pattern.exec(content);

    if (!match) {
        return { content };
    }

    const plan = parsePlanBlock(match[1]);

    if (!plan) {
        return { content };
    }

    return {
        content: content.slice(0, match.index).trimEnd(),
        plan
    };
}
