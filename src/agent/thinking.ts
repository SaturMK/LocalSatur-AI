/**
 * Reasoning-model output handling.
 *
 * Reasoning models served by Ollama and OpenAI-compatible routers
 * (deepseek-r1, qwen3, and friends) frequently emit their chain of
 * thought wrapped in <think>...</think> tags inside the assistant
 * content. Left in, that reasoning pollutes the chat transcript and
 * reads as a corrupted answer.
 *
 * Two entry points:
 * - extractThinking(): complete strings (final responses, history).
 * - createThinkingFilter(): streaming, where a tag can be split
 *   across any number of chunks.
 */

export interface ThinkingSplit {
    /** Assistant content safe to show to the user. */
    content: string;

    /** Raw reasoning text, when any was present. */
    thinking?: string;
}

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

/**
 * Remove reasoning tags from a complete assistant string. An
 * unclosed <think> tag means the remainder is all reasoning (the
 * model was cut off mid-thought); nothing after an unclosed tag is
 * user-facing content.
 */
export function extractThinking(raw: string): ThinkingSplit {
    if (typeof raw !== "string" || raw === "") {
        return { content: raw };
    }

    const openIndex = raw.indexOf(OPEN_TAG);

    if (openIndex === -1) {
        return { content: raw };
    }

    const before = raw.slice(0, openIndex);
    const afterOpen = raw.slice(openIndex + OPEN_TAG.length);
    const closeIndex = afterOpen.indexOf(CLOSE_TAG);

    if (closeIndex === -1) {
        return {
            content: before,
            thinking: afterOpen
        };
    }

    const thinking = afterOpen.slice(0, closeIndex);
    const after = afterOpen.slice(closeIndex + CLOSE_TAG.length);

    return {
        content: before + after,
        thinking
    };
}

/**
 * Streaming filter. Feed chunks in; each push returns the text that
 * is safe to emit. Unprocessed text is re-scanned in full on every
 * push, and a tail that could be the start of "<think>" is held
 * back so tags split across chunks are still caught; flush()
 * releases whatever remains at end of stream.
 */
export function createThinkingFilter(): {
    push(chunk: string): ThinkingSplit;
    flush(): ThinkingSplit;
} {
    let pending = "";
    let inThinking = false;

    /**
     * Length of the longest suffix of `text` that is a proper
     * prefix of the open tag, and therefore could be the start of
     * a tag split across chunks.
     */
    const partialOpenSuffix = (text: string): number => {
        const limit = Math.min(OPEN_TAG.length - 1, text.length);

        for (let length = limit; length > 0; length--) {
            if (OPEN_TAG.startsWith(text.slice(text.length - length))) {
                return length;
            }
        }

        return 0;
    };

    const drain = (final: boolean): ThinkingSplit => {
        let content = "";
        let thinking = "";

        for (;;) {
            if (inThinking) {
                const closeIndex =
                    pending.indexOf(CLOSE_TAG);

                if (closeIndex !== -1) {
                    thinking += pending.slice(0, closeIndex);
                    pending = pending.slice(closeIndex + CLOSE_TAG.length);
                    inThinking = false;
                    continue;
                }

                if (final) {
                    thinking += pending;
                    pending = "";
                    break;
                }

                /*
                 * Hold back a tail that could be a partial close
                 * tag. It is re-scanned on the next push, so
                 * nothing is lost.
                 */
                const keep =
                    Math.min(CLOSE_TAG.length - 1, pending.length);

                thinking += pending.slice(0, pending.length - keep);
                pending = pending.slice(pending.length - keep);
                break;
            }

            const openIndex = pending.indexOf(OPEN_TAG);
            const strayCloseIndex = pending.indexOf(CLOSE_TAG);

            /*
             * A close tag outside thinking mode is model noise;
             * drop it rather than leaking it as answer text.
             */
            if (
                strayCloseIndex !== -1 &&
                (openIndex === -1 || strayCloseIndex < openIndex)
            ) {
                content += pending.slice(0, strayCloseIndex);
                pending = pending.slice(strayCloseIndex + CLOSE_TAG.length);
                continue;
            }

            if (openIndex !== -1) {
                content += pending.slice(0, openIndex);
                pending = pending.slice(openIndex + OPEN_TAG.length);
                inThinking = true;
                continue;
            }

            if (final) {
                content += pending;
                pending = "";
                break;
            }

            const keep = partialOpenSuffix(pending);

            content += pending.slice(0, pending.length - keep);
            pending = pending.slice(pending.length - keep);
            break;
        }

        return {
            content,
            thinking: thinking || undefined
        };
    };

    return {
        push(chunk) {
            pending += chunk;
            return drain(false);
        },
        flush() {
            return drain(true);
        }
    };
}
