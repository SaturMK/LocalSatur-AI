/**
 * Minimal, escape-first Markdown renderer for the chat webview
 * (PRD 7.3, FR-008).
 *
 * Security model: the entire input is HTML-escaped BEFORE any
 * Markdown transform runs, and the transforms only ever emit a
 * fixed set of tags and attributes. Model output can therefore
 * never inject markup — it can only influence which of the known
 * elements appear. Links are restricted to http(s) and mailto;
 * everything else renders as literal text.
 *
 * This module is bundled separately (esbuild IIFE, global
 * `localforgeMarkdown`) and loaded by the webview next to the
 * inline UI script.
 */

const ESCAPE_MAP: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
};

export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, ch => ESCAPE_MAP[ch]);
}

/** Fenced code block opener: ```lang or ~~~lang, up to 3 spaces of indent. */
const FENCE_OPEN = /^ {0,3}(```+|~~~+)(.*)$/;

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

const HORIZONTAL_RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;

const BLOCKQUOTE = /^ {0,3}>/;

/**
 * Inline-level transforms: code spans, links, bold, italic,
 * strikethrough. Input must already be HTML-escaped.
 */
function renderInline(escaped: string): string {
    /*
     * Code spans are extracted first so emphasis markers inside
     * them stay literal.
     */
    const codeSpans: string[] = [];

    let work = escaped.replace(/`([^`\n]+)`/g, (_match, code: string) => {
        codeSpans.push(`<code class="inline-code">${code}</code>`);
        return `\u0000${codeSpans.length - 1}\u0000`;
    });

    // Links: only http(s) and mailto schemes are honored.
    work = work.replace(
        /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
        (match, label: string, href: string) => {
            const target = href.trim();

            if (/^(https?:\/\/|mailto:)/i.test(target)) {
                return `<a href="${target}" rel="noopener noreferrer">${label}</a>`;
            }

            return match;
        }
    );

    work = work.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    work = work.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    work = work.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    work = work.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

    work = work.replace(
        /\u0000(\d+)\u0000/g,
        (_match, position: string) => codeSpans[Number(position)] ?? ""
    );

    return work;
}

/**
 * Render Markdown source to HTML. Never throws on malformed input;
 * unterminated constructs (e.g. an open code fence while streaming)
 * are closed implicitly.
 */
export function renderMarkdown(source: string): string {
    const lines = escapeHtml(source.replace(/\r\n?/g, "\n")).split("\n");

    const html: string[] = [];
    let paragraph: string[] = [];

    const flushParagraph = (): void => {
        if (paragraph.length === 0) {
            return;
        }

        html.push(
            `<p>${paragraph.map(renderInline).join("<br>")}</p>`
        );

        paragraph = [];
    };

    let index = 0;

    while (index < lines.length) {
        const line = lines[index];

        const fenceMatch = FENCE_OPEN.exec(line);

        if (fenceMatch) {
            flushParagraph();

            const marker = fenceMatch[1];
            const fenceCharacter = marker[0];
            const fenceLength = marker.length;
            const info = fenceMatch[2].trim();
            const language = info ? info.split(/\s+/)[0] : "";

            const code: string[] = [];
            index++;

            while (
                index < lines.length &&
                !new RegExp(
                    `^ {0,3}${fenceCharacter}{${fenceLength},}\\s*$`
                ).test(lines[index])
            ) {
                code.push(lines[index]);
                index++;
            }

            // Skip the closing fence; at EOF the fence is implicitly closed.
            index++;

            html.push(
                `<pre class="code-block"${language ? ` data-language="${language}"` : ""}><code>${code.join("\n")}</code></pre>`
            );

            continue;
        }

        const headingMatch = HEADING.exec(line);

        if (headingMatch) {
            flushParagraph();

            const level = headingMatch[1].length;

            html.push(
                `<h${level}>${renderInline(headingMatch[2])}</h${level}>`
            );

            index++;
            continue;
        }

        if (HORIZONTAL_RULE.test(line)) {
            flushParagraph();
            html.push("<hr>");
            index++;
            continue;
        }

        const listMatch = LIST_ITEM.exec(line);

        if (listMatch) {
            flushParagraph();

            const ordered = /[.)]$/.test(
                listMatch[0].trim().split(/\s+/)[0]
            );

            const items: string[] = [];

            while (index < lines.length) {
                const itemMatch = LIST_ITEM.exec(lines[index]);

                if (!itemMatch) {
                    break;
                }

                items.push(`<li>${renderInline(itemMatch[1])}</li>`);
                index++;
            }

            html.push(
                ordered
                    ? `<ol>${items.join("")}</ol>`
                    : `<ul>${items.join("")}</ul>`
            );

            continue;
        }

        if (BLOCKQUOTE.test(line)) {
            flushParagraph();

            const quoted: string[] = [];

            while (index < lines.length && BLOCKQUOTE.test(lines[index])) {
                quoted.push(
                    lines[index].replace(/^ {0,3}>\s?/, "")
                );
                index++;
            }

            html.push(
                `<blockquote>${quoted.map(renderInline).join("<br>")}</blockquote>`
            );

            continue;
        }

        if (line.trim() === "") {
            flushParagraph();
            index++;
            continue;
        }

        paragraph.push(line);
        index++;
    }

    flushParagraph();

    return html.join("\n");
}
