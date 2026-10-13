/**
 * Link Quick Actions
 * ==================
 *
 * Right-click a link in Live Preview and act on it:
 *
 *   - toggle its `!`  -- `[[x]]` <-> `![[x]]`, i.e. link vs embed;
 *   - delete the whole link.
 *
 * This covers a plain note link, an image rendered from `![[图.png]]`, and the
 * body of an embedded note, because all three are the *same construct* in the
 * source: a wiki link, possibly with a leading `!`. The plugin never has to
 * know what was rendered -- it finds the link in the text and edits that.
 *
 * WHY BOTH `file-menu` AND `editor-menu`
 * --------------------------------------
 * `file-menu` is the one that matters: Obsidian raises it for a right-click on
 * a link or an embed inside an editor (its `source` is `"link-context-menu"`,
 * as the kanban plugin's guard shows), and it hands over the resolved `TFile`
 * plus the owning leaf. That is strictly better than reading the DOM:
 *
 *   - the target is the real file, so the link can be matched by *resolved
 *     identity* rather than by string comparison;
 *   - the items go into Obsidian's own menu, so there is exactly one menu.
 *
 * An earlier version also showed its own `Menu` when it thought Obsidian's had
 * not arrived. That produced two menus stacked at the same coordinates, so it
 * is gone: matching the right click is now Obsidian's job, not a race.
 *
 * `editor-menu` is kept as a second chance for right-clicks that only raise the
 * editor menu (plain text links in some configurations). A `WeakSet` of menus
 * already handled stops the two handlers from adding the same items twice.
 *
 * WHY LIVE PREVIEW ONLY
 * ---------------------
 * Both Live Preview and source mode have an editor, so the source text can be
 * rewritten exactly. Reading view has no editor at all -- changing a link there
 * would mean editing the file behind the user's back and reconciling offsets by
 * hand. That is a different, riskier feature and is deliberately not attempted.
 */

import {
	Editor,
	MarkdownView,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	type EditorPosition,
	type MarkdownFileInfo,
	type Menu,
	type WorkspaceLeaf,
} from "obsidian";
import {
	offsetToLineCh,
	pickLinkSpan,
	removeLinkEdit,
	toggleBangEdit,
	type LinkSpan,
	type TextEdit,
} from "./links";
import { collectDomTargets, isElementLike } from "./dom";
import { setLanguage, t } from "./i18n";
import {
	DEFAULT_SETTINGS,
	LinkQuickActionsSettingTab,
	normalizeSettings,
	type LinkQuickActionsSettings,
} from "./settings";

/** The CM6 view behind an Obsidian editor. Absent from the public typings. */
interface CodeMirrorViewLike {
	posAtDOM?(node: Node, offset?: number): number;
}

/** A right-click captured in the DOM, for locating the pointer. */
interface PendingClick {
	target: HTMLElement;
}

export default class LinkQuickActionsPlugin extends Plugin {
	settings: LinkQuickActionsSettings = DEFAULT_SETTINGS;

	/** The most recent right-click inside an editor, if any. */
	private pendingClick: PendingClick | null = null;

	/**
	 * Menus already given our items.
	 *
	 * A single right-click can raise `file-menu` and `editor-menu` for the same
	 * menu object, and both handlers would otherwise append a second copy.
	 */
	private readonly handledMenus = new WeakSet<Menu>();

	async onload(): Promise<void> {
		await this.loadSettings();
		setLanguage(this.settings.language);
		this.addSettingTab(new LinkQuickActionsSettingTab(this.app, this));

		// Capture phase, so this runs before Obsidian's own contextmenu work.
		this.registerDomEvent(
			document,
			"contextmenu",
			this.onContextMenuCapture,
			true
		);
		this.registerEvent(this.app.workspace.on("file-menu", this.onFileMenu));
		this.registerEvent(
			this.app.workspace.on("editor-menu", this.onEditorMenu)
		);

		console.log("[link-quick-actions] " + t("log.loaded"));
	}

	// -- click capture -----------------------------------------------------

	/** Remembers the element under the pointer, which locates it in the source. */
	private onContextMenuCapture = (event: MouseEvent): void => {
		const target = event.target;
		this.pendingClick =
			isElementLike(target) && target.closest(".cm-editor")
				? { target }
				: null;
	};

	/**
	 * Takes the element captured by the last right-click, if it is still fresh.
	 *
	 * @returns The element, or null when no editor right-click preceded this.
	 */
	private takePendingTarget(): HTMLElement | null {
		const pending = this.pendingClick;
		this.pendingClick = null;
		return pending?.target ?? null;
	}

	// -- menu handlers -----------------------------------------------------

	/**
	 * Adds the actions when Obsidian raises the file menu for a link or embed.
	 *
	 * @param menu - The menu being built.
	 * @param file - The file the link or embed points at.
	 * @param _source - Obsidian's description of where the menu came from.
	 * @param leaf - The leaf that owns the menu, when Obsidian supplies one.
	 */
	private onFileMenu = (
		menu: Menu,
		file: TAbstractFile,
		_source: string,
		leaf?: WorkspaceLeaf
	): void => {
		if (!(file instanceof TFile)) return;

		const clicked = this.takePendingTarget();
		const editor = this.editorForLeaf(leaf) ?? this.editorForElement(clicked);
		if (!editor) return;

		this.handleMenu(menu, editor, file, clicked);
	};

	/** Adds the actions through Obsidian's own editor menu. */
	private onEditorMenu = (
		menu: Menu,
		editor: Editor,
		info: MarkdownView | MarkdownFileInfo
	): void => {
		// `file-menu` normally runs first and has already handled this menu.
		if (this.handledMenus.has(menu)) return;

		const clicked = this.takePendingTarget();
		const leaf = "leaf" in info ? info.leaf : undefined;
		const file =
			leaf?.view instanceof MarkdownView
				? leaf.view.file
				: info instanceof MarkdownView
					? info.file
					: null;

		// If `file-menu` never ran for this click, the DOM is the only clue to
		// which link is meant, and matching is by linktext rather than identity.
		this.handleMenu(menu, editor, file, clicked);
	};

	/**
	 * Works out which link is meant and adds the menu items.
	 *
	 * @param menu - The menu to fill.
	 * @param editor - The editor to edit.
	 * @param file - The linked file, when known.
	 * @param clicked - The element under the pointer, when known.
	 */
	private handleMenu(
		menu: Menu,
		editor: Editor,
		file: TFile | null,
		clicked: HTMLElement | null
	): void {
		if (this.handledMenus.has(menu)) return;
		if (!this.settings.enableBangToggle && !this.settings.enableDeleteLink) {
			return;
		}

		const resolved = this.resolveLink(editor, file, clicked);
		if (!resolved) return;

		this.handledMenus.add(menu);
		this.addMenuItems(menu, editor, resolved.text, resolved.span);
	}

	// -- resolution --------------------------------------------------------

	/**
	 * Works out which link a click referred to.
	 *
	 * @param editor - The editor the click came from.
	 * @param file - The linked file, when the menu told us.
	 * @param clicked - The element under the pointer, when known.
	 * @returns The document text and the chosen span, or null.
	 */
	private resolveLink(
		editor: Editor,
		file: TFile | null,
		clicked: HTMLElement | null
	): { text: string; span: LinkSpan } | null {
		const text = editor.getValue();
		const offset = clicked ? resolveOffset(editor, clicked) : null;
		const sourcePath = this.sourcePathFor(editor);

		// 1. Strongest: the menu named the file, so match by resolved identity.
		if (file) {
			const span = pickLinkSpan(text, {
				offset: offset ?? undefined,
				matchesTarget: (candidate) =>
					this.spanResolvesTo(candidate, file, sourcePath),
			});
			if (span) return { text, span };
		}

		// 2. The DOM named a target, matched as a string.
		if (clicked) {
			for (const candidate of collectDomTargets(clicked)) {
				const span = pickLinkSpan(text, {
					offset: offset ?? undefined,
					target: candidate.target,
					isEmbed: candidate.isEmbed,
				});
				if (span) return { text, span };
			}
		}

		// 3. Geometry alone.
		if (offset !== null) {
			const span = pickLinkSpan(text, { offset });
			if (span) return { text, span };
		}

		if (file || clicked) {
			console.warn("[link-quick-actions] " + t("log.linkNotFound"), {
				file: file?.path ?? null,
				clicked: Boolean(clicked),
				offset,
			});
		}
		return null;
	}

	/**
	 * Reports whether a span denotes a specific file.
	 *
	 * The source holds a *linktext* (`图`) while the menu supplies a path
	 * (`Z附件库/图.png`), so string comparison is not enough; the link is
	 * resolved the way Obsidian itself would and the results compared.
	 *
	 * @param span - Candidate link.
	 * @param file - The file the click referred to.
	 * @param sourcePath - Path of the document holding the link.
	 * @returns True when they are the same file.
	 */
	private spanResolvesTo(
		span: LinkSpan,
		file: TFile,
		sourcePath: string
	): boolean {
		// Cheap exact forms first, which also covers a link written as a full path.
		if (
			span.target === file.path ||
			span.target === file.name ||
			span.target === file.basename
		) {
			return true;
		}
		try {
			const destination = this.app.metadataCache.getFirstLinkpathDest(
				span.target,
				sourcePath
			);
			return destination?.path === file.path;
		} catch (error) {
			console.error("[link-quick-actions] " + t("log.resolveFailed"), error);
			return false;
		}
	}

	/**
	 * Finds the Markdown view's path for link resolution.
	 *
	 * @param editor - The editor to look up.
	 * @returns The vault path, or an empty string when unavailable.
	 */
	private sourcePathFor(editor: Editor): string {
		let path = "";
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (path) return;
			const view = leaf.view;
			if (view instanceof MarkdownView && view.editor === editor) {
				path = view.file?.path ?? "";
			}
		});
		return path;
	}

	/**
	 * Gets the editor behind a workspace leaf.
	 *
	 * @param leaf - The leaf Obsidian supplied, if any.
	 * @returns Its editor, or null when it is not a Markdown view.
	 */
	private editorForLeaf(leaf?: WorkspaceLeaf): Editor | null {
		const view = leaf?.view;
		return view instanceof MarkdownView ? view.editor : null;
	}

	/**
	 * Finds the editor that owns a DOM element.
	 *
	 * Walks the leaves rather than asking for the active view, so a click in a
	 * split pane or a popout still resolves correctly.
	 *
	 * @param element - The element under the pointer.
	 * @returns The owning editor, or null when it is not a Markdown view.
	 */
	private editorForElement(element: HTMLElement | null): Editor | null {
		if (!element) return null;
		let found: Editor | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (found) return;
			const view = leaf.view;
			if (
				view instanceof MarkdownView &&
				view.containerEl.contains(element)
			) {
				found = view.editor;
			}
		});
		return found;
	}

	/**
	 * Adds the configured entries to a menu.
	 *
	 * @param menu - Menu to fill.
	 * @param editor - Editor the click came from.
	 * @param text - Document text the offsets were computed against.
	 * @param span - The link to act on.
	 * @returns True when at least one item was added.
	 */
	private addMenuItems(
		menu: Menu,
		editor: Editor,
		text: string,
		span: LinkSpan
	): boolean {
		let added = false;

		if (this.settings.enableBangToggle) {
			added = true;
			menu.addItem((item) =>
				item
					.setTitle(t(span.bang ? "menu.removeBang" : "menu.addBang"))
					.setIcon(span.bang ? "link" : "image")
					.onClick(() => {
						this.applyEdit(editor, text, toggleBangEdit(span));
					})
			);
		}

		if (this.settings.enableDeleteLink) {
			added = true;
			menu.addItem((item) =>
				item
					.setTitle(t("menu.deleteLink"))
					.setIcon("trash-2")
					.onClick(() => {
						this.applyEdit(editor, text, removeLinkEdit(span));
					})
			);
		}

		return added;
	}

	/**
	 * Applies a single replacement through Obsidian's editor, so the change
	 * lands in the undo history like any other edit.
	 *
	 * @param editor - The editor the click came from.
	 * @param text - Document text the offsets were computed against.
	 * @param edit - The replacement to make.
	 */
	private applyEdit(editor: Editor, text: string, edit: TextEdit): void {
		try {
			editor.replaceRange(
				edit.insert,
				toEditorPosition(editor, text, edit.from),
				toEditorPosition(editor, text, edit.to)
			);
		} catch (error) {
			console.error("[link-quick-actions] " + t("log.editFailed"), error);
			new Notice(t("notice.editFailed"));
		}
	}

	/** Loads persisted settings, falling back to defaults. */
	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
	}

	/** Persists the current settings. */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

// -- helpers -------------------------------------------------------------

/**
 * Turns the clicked DOM element into a source offset.
 *
 * Tries the element itself first (precise), then its `.cm-line` -- clicking
 * inside a rendered embed resolves to the line rather than the link, and
 * `pickLinkSpan`'s "sole link on the line" rule covers that case.
 *
 * @param editor - The editor the click came from.
 * @param target - The element under the pointer.
 * @returns A source offset, or null when none could be determined.
 */
function resolveOffset(
	editor: Editor,
	target: HTMLElement | null
): number | null {
	const cm = (editor as unknown as { cm?: CodeMirrorViewLike }).cm;
	if (cm && typeof cm.posAtDOM === "function" && target) {
		const candidates: Array<Node | null> = [
			target,
			target.closest(".cm-line"),
		];
		for (const node of candidates) {
			if (!node) continue;
			try {
				const position = cm.posAtDOM(node, 0);
				if (Number.isFinite(position) && position >= 0) return position;
			} catch (error) {
				console.error(
					"[link-quick-actions] " + t("log.posAtDomFailed"),
					error
				);
			}
		}
	}

	// Fallback: Obsidian places the caret on right-click, so the cursor is the
	// pointer position. Only used when the CM6 view is unavailable.
	try {
		return editor.posToOffset(editor.getCursor());
	} catch (error) {
		console.error("[link-quick-actions] " + t("log.posToOffsetFailed"), error);
		return null;
	}
}

/**
 * Converts an offset to an `EditorPosition`.
 *
 * Uses Obsidian's own conversion, falling back to the local one so a missing or
 * throwing method cannot break an otherwise valid edit.
 *
 * @param editor - The editor.
 * @param text - Document text the offset was computed against.
 * @param offset - Absolute offset.
 * @returns The editor position.
 */
function toEditorPosition(
	editor: Editor,
	text: string,
	offset: number
): EditorPosition {
	try {
		return editor.offsetToPos(offset);
	} catch (error) {
		console.error(
			"[link-quick-actions] " + t("log.offsetToPosFailed"),
			error
		);
		return offsetToLineCh(text, offset);
	}
}
