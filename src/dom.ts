/**
 * Reading link targets out of Obsidian's rendered DOM.
 *
 * Kept apart from `links.ts` (pure text work) and from the plugin wiring so it
 * can be exercised against a hand-built DOM. It imports nothing from Obsidian,
 * which is what makes that possible.
 *
 * The shapes being handled, all of which Obsidian produces for one construct --
 * a wiki link in the source:
 *
 *   - a rendered link:      `<a class="internal-link" data-href="笔记">`
 *   - an image embed:       `<span class="internal-embed image-embed" src="图.png"><img></span>`
 *   - a note embed:         `<div class="markdown-embed" src="笔记">…</div>`
 *   - an anchor-shaped one: `<a class="internal-embed" href="图.png">`
 *
 * A click can land on any descendant, so the *ancestors* are what matter, never
 * the clicked node itself. An image's own `src` is an `app://` resource URL, not
 * a vault path, so reading the img would be actively wrong.
 */

/**
 * An embedded element Obsidian can render.
 *
 * `.image-wrapper` and `.image-embed` are listed because Live Preview does not
 * always put `.internal-embed` on an image the way reading view does -- the
 * image-converter plugin checks exactly these two, which is a strong hint that
 * an image's wrapper is sometimes the only ancestor available.
 */
const EMBED_SELECTOR =
	".internal-embed, .markdown-embed, .image-wrapper, .image-embed";

/** Rendered wiki/markdown links. */
const LINK_SELECTOR = "a.internal-link, a.external-link";

/** Obsidian's own top-right control on every embed, which links to the target. */
const EMBED_CORNER_LINK_SELECTOR = ".markdown-embed-link";

/**
 * Attributes an embed may carry its target on, best first.
 *
 * `src` is the usual one, `href` covers the anchor-shaped variant, and `alt`
 * comes last because it may hold display text rather than a path.
 */
const EMBED_TARGET_ATTRIBUTES = [
	"src",
	"data-href",
	"data-src",
	"href",
	"alt",
] as const;

/** A link target read from the DOM, plus what kind of element it came from. */
export interface DomTarget {
	/** The target exactly as the DOM reported it. */
	target: string;
	/** True when it came from an embed rather than a plain link. */
	isEmbed: boolean;
}

/**
 * Reports whether a value looks like an element we can navigate.
 *
 * Duck-typed rather than `instanceof HTMLElement`, which fails for elements
 * owned by a popout window's document.
 *
 * @param value - Candidate.
 * @returns True when `closest` and `getAttribute` are callable.
 */
export function isElementLike(value: unknown): value is HTMLElement {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<HTMLElement>;
	return (
		typeof candidate.closest === "function" &&
		typeof candidate.getAttribute === "function"
	);
}

/**
 * Reads the target of one rendered embedded element.
 *
 * @param element - The embed element (not a descendant of it).
 * @returns The target string, or null when none of the sources had one.
 */
export function readEmbedTarget(element: Element): string | null {
	for (const name of EMBED_TARGET_ATTRIBUTES) {
		const value = element.getAttribute(name);
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}

	// Obsidian's corner control always points at the embedded file.
	const corner = element.querySelector(EMBED_CORNER_LINK_SELECTOR);
	if (corner) {
		const href =
			corner.getAttribute("href") ?? corner.getAttribute("data-href");
		if (typeof href === "string" && href.trim().length > 0) {
			return href.trim();
		}
	}

	return null;
}

/**
 * Lists the link targets a click could plausibly refer to, best first.
 *
 * A rendered link comes first, then every embed ancestor from the inside out.
 * The nesting matters: an embedded note can itself contain embeds, and only an
 * ancestor that also appears in *this* document's source can be edited from
 * here. Returning them in order lets the caller try each until one matches.
 *
 * @param target - The element under the pointer.
 * @returns Candidate targets, most specific first.
 */
export function collectDomTargets(target: unknown): DomTarget[] {
	if (!isElementLike(target)) return [];
	const candidates: DomTarget[] = [];

	const anchor = target.closest(LINK_SELECTOR);
	if (anchor) {
		const href = anchor.getAttribute("data-href") ?? anchor.getAttribute("href");
		if (typeof href === "string" && href.trim().length > 0) {
			candidates.push({ target: href.trim(), isEmbed: false });
		}
	}

	const visited = new Set<Element>();
	let embed = target.closest(EMBED_SELECTOR);
	while (embed && !visited.has(embed)) {
		visited.add(embed);
		const source = readEmbedTarget(embed);
		if (source) candidates.push({ target: source, isEmbed: true });
		// Step strictly outward, so a nested embed also yields its ancestors.
		embed = embed.parentElement?.closest(EMBED_SELECTOR) ?? null;
	}

	return candidates;
}
