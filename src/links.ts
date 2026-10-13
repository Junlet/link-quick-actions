/**
 * Finding links in Markdown source, and the edits that act on them.
 *
 * Everything here is pure: it takes the document text and offsets and returns
 * data. The plugin's job is only to turn a right-click into an offset and hand
 * the resulting edit to Obsidian's editor. Keeping the parsing separate is what
 * makes the fiddly parts -- aliases, headings, both link syntaxes, and choosing
 * *which* link the pointer meant -- testable without a running editor.
 *
 * Two syntaxes are recognised:
 *   - wiki:     `[[target]]`, `[[target|alias]]`, `[[target#heading]]`, `![[...]]`
 *   - markdown: `[text](url)`, `![alt](url)`
 *
 * The leading `!` is what the menu toggles, so it is part of the span rather
 * than a decoration.
 */

/** Which link syntax a span uses. */
export type LinkSyntax = "wiki" | "markdown";

/** One link occurrence in the source text. */
export interface LinkSpan {
	/** Offset of the first character: the `!` when present, else the bracket. */
	start: number;
	/** Offset just past the last character. */
	end: number;
	/** Whether the link is an embed (`![[..]]` / `![..](..)`). */
	bang: boolean;
	/**
	 * Comparable target.
	 *
	 * For wiki links this is the file part with any `|alias` and `#heading`
	 * stripped; for markdown links it is the URL without its title.
	 */
	target: string;
	/** The target exactly as written, for messages. */
	rawTarget: string;
	/** Which syntax matched. */
	syntax: LinkSyntax;
	/** The full matched text. */
	raw: string;
}

/** A single replacement to hand to the editor. */
export interface TextEdit {
	/** Offset to replace from. */
	from: number;
	/** Offset to replace to (equal to `from` for a pure insertion). */
	to: number;
	/** Replacement text. */
	insert: string;
}

/**
 * Wiki links: `!?[[ ... ]]`.
 *
 * The body excludes brackets and newlines, so it stops at the closing `]]` and
 * cannot run across lines.
 */
const WIKI_LINK = /(!?)\[\[([^[\]\n]*)\]\]/gu;

/**
 * Markdown links: `!?[text](url)`.
 *
 * Requires `](` immediately after the text, which is why it cannot also match a
 * wiki link's `[[...]]`.
 */
const MARKDOWN_LINK = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/gu;

/**
 * Reduces a wiki target to its comparable file part.
 *
 * @param raw - Text between `[[` and `]]`.
 * @returns The target without alias or heading, with a leading `./` removed.
 */
export function normalizeWikiTarget(raw: string): string {
	let target = raw;
	const pipe = target.indexOf("|");
	if (pipe !== -1) target = target.slice(0, pipe);
	const hash = target.indexOf("#");
	if (hash !== -1) target = target.slice(0, hash);
	return target.trim().replace(/^\.\//u, "");
}

/**
 * Reduces a markdown URL to its comparable form.
 *
 * Strips an optional title and the angle brackets Markdown allows around URLs.
 *
 * @param raw - Text inside the parentheses.
 * @returns The bare URL.
 */
export function normalizeMarkdownTarget(raw: string): string {
	const firstToken = raw.trim().split(/\s+/u)[0] ?? "";
	return firstToken.replace(/^</u, "").replace(/>$/u, "");
}

/**
 * Reduces a link target taken from the DOM to its comparable form.
 *
 * Obsidian's `data-href` and `src` attributes may carry a `#heading` or
 * `|alias`, which the source text comparison must ignore.
 *
 * @param raw - Attribute value.
 * @returns The bare target.
 */
export function normalizeDomTarget(raw: string): string {
	let target = raw;
	const pipe = target.indexOf("|");
	if (pipe !== -1) target = target.slice(0, pipe);
	const hash = target.indexOf("#");
	if (hash !== -1) target = target.slice(0, hash);
	return target.trim().replace(/^\.\//u, "");
}

/**
 * Finds every link in a document, in source order.
 *
 * @param text - Full document text.
 * @returns All link spans.
 */
export function findLinkSpans(text: string): LinkSpan[] {
	const spans: LinkSpan[] = [];

	for (const match of text.matchAll(WIKI_LINK)) {
		const start = match.index ?? 0;
		const rawTarget = match[2] ?? "";
		spans.push({
			start,
			end: start + match[0].length,
			bang: match[1] === "!",
			target: normalizeWikiTarget(rawTarget),
			rawTarget,
			syntax: "wiki",
			raw: match[0],
		});
	}

	for (const match of text.matchAll(MARKDOWN_LINK)) {
		const start = match.index ?? 0;
		const rawTarget = match[3] ?? "";
		spans.push({
			start,
			end: start + match[0].length,
			bang: match[1] === "!",
			target: normalizeMarkdownTarget(rawTarget),
			rawTarget,
			syntax: "markdown",
			raw: match[0],
		});
	}

	spans.sort((a, b) => a.start - b.start);
	return spans;
}

/** What the caller knows about the click. */
export interface LinkLookup {
	/** Source offset of the pointer, when it could be resolved. */
	offset?: number;
	/** Target read from the DOM, when a rendered link or embed was clicked. */
	target?: string;
	/** Whether the clicked element was an embed rather than a plain link. */
	isEmbed?: boolean;
	/**
	 * Stronger alternative to {@link target}, supplied by the caller.
	 *
	 * A source link holds a *linktext* (`图`), while Obsidian's `file-menu`
	 * hands over the resolved `TFile` (path `Z附件库/图.png`). Comparing those
	 * two as strings cannot work, so the caller resolves each span the way
	 * Obsidian would and reports whether it denotes the same file. When
	 * present this replaces the string comparisons entirely.
	 *
	 * @param span - A candidate link.
	 * @returns True when the span refers to the file the caller means.
	 */
	matchesTarget?: (span: LinkSpan) => boolean;
}

/**
 * Narrows a set of candidate spans down to one.
 *
 * @param candidates - Spans that matched the target.
 * @param offset - Source offset of the pointer, when known.
 * @param isEmbed - Whether the click was on an embed.
 * @returns The chosen span, or the first candidate as a last resort.
 */
function narrowCandidates(
	candidates: LinkSpan[],
	offset: number | undefined,
	isEmbed: boolean | undefined
): LinkSpan {
	if (candidates.length === 1) return candidates[0]!;

	const byRole =
		isEmbed === undefined
			? candidates
			: candidates.filter((span) => span.bang === isEmbed);
	const pool = byRole.length > 0 ? byRole : candidates;

	if (offset !== undefined) {
		const containing = pool.find(
			(span) => offset >= span.start && offset <= span.end
		);
		if (containing) return containing;
	}
	return pool[0]!;
}

/**
 * Chooses the link the user meant.
 *
 * Tried in order of confidence:
 *
 *   1. **Target match.** Either the caller's own resolved-file test, or a
 *      string comparison against a target read from the DOM.
 *   2. **Containment.** The pointer is inside the link's source range.
 *   3. **Sole link on the line.** A click inside a rendered embed resolves to
 *      the *line* start rather than the link, so when the line holds exactly one
 *      link that link is unambiguous.
 *
 * Anything less certain returns null rather than acting on the wrong link.
 *
 * @param text - Full document text.
 * @param lookup - What is known about the click.
 * @returns The chosen span, or null when the choice would be a guess.
 */
export function pickLinkSpan(
	text: string,
	lookup: LinkLookup
): LinkSpan | null {
	const spans = findLinkSpans(text);
	if (spans.length === 0) return null;

	const { offset, target, isEmbed, matchesTarget } = lookup;

	if (matchesTarget) {
		const byTarget = spans.filter(matchesTarget);
		if (byTarget.length > 0) {
			return narrowCandidates(byTarget, offset, isEmbed);
		}
	} else if (target) {
		const wanted = normalizeDomTarget(target);
		const byTarget = spans.filter(
			(span) =>
				span.target === wanted ||
				span.rawTarget === wanted ||
				span.target === target
		);
		if (byTarget.length > 0) {
			return narrowCandidates(byTarget, offset, isEmbed);
		}
	}

	if (offset === undefined) return null;

	const containing = spans.find(
		(span) => offset >= span.start && offset <= span.end
	);
	if (containing) return containing;

	const { lineStart, lineEnd } = lineBoundsAt(text, offset);
	const onLine = spans.filter(
		(span) => span.start >= lineStart && span.end <= lineEnd
	);
	return onLine.length === 1 ? onLine[0]! : null;
}

/**
 * Finds the bounds of the line containing an offset.
 *
 * @param text - Full document text.
 * @param offset - Any offset in the document.
 * @returns Start offset (after the previous newline) and end offset (the
 * newline itself, or the end of the text).
 */
export function lineBoundsAt(
	text: string,
	offset: number
): { lineStart: number; lineEnd: number } {
	const clamped = Math.max(0, Math.min(offset, text.length));
	const lineStart = text.lastIndexOf("\n", Math.max(0, clamped - 1)) + 1;
	const found = text.indexOf("\n", clamped);
	return { lineStart, lineEnd: found === -1 ? text.length : found };
}

/**
 * Builds the edit that flips a link's `!`.
 *
 * @param span - The link to change.
 * @returns An edit removing the `!`, or inserting one.
 */
export function toggleBangEdit(span: LinkSpan): TextEdit {
	return span.bang
		? { from: span.start, to: span.start + 1, insert: "" }
		: { from: span.start, to: span.start, insert: "!" };
}

/**
 * Builds the edit that removes a link entirely.
 *
 * The span already includes the `!` when present, so the whole construct goes.
 *
 * @param span - The link to remove.
 * @returns An edit deleting the span.
 */
export function removeLinkEdit(span: LinkSpan): TextEdit {
	return { from: span.start, to: span.end, insert: "" };
}

/**
 * Converts an absolute offset into a line/column pair.
 *
 * Obsidian's `Editor` accepts `EditorPosition` objects, and its own
 * `offsetToPos` exists, but computing it here keeps the mapping testable and
 * avoids depending on that method being present.
 *
 * @param text - Full document text.
 * @param offset - Absolute offset.
 * @returns Zero-based line and column.
 */
export function offsetToLineCh(
	text: string,
	offset: number
): { line: number; ch: number } {
	const clamped = Math.max(0, Math.min(offset, text.length));
	let line = 0;
	let lineStart = 0;
	for (let index = 0; index < clamped; index += 1) {
		if (text.charCodeAt(index) === 10) {
			line += 1;
			lineStart = index + 1;
		}
	}
	return { line, ch: clamped - lineStart };
}
