/**
 * Two-language string table.
 *
 * The plugin ships Chinese and English. The setting has three values:
 *
 *   - `"auto"` follows whatever language Obsidian itself is using;
 *   - `"zh"` / `"en"` pin it.
 *
 * The factory default is `"zh"`, so an existing install keeps the exact wording
 * it had before this module existed.
 *
 * HOW THE APP LANGUAGE IS DETECTED
 * --------------------------------
 * Both signals below were verified against Obsidian's own bundle rather than
 * guessed:
 *
 *   1. `localStorage.getItem("language")` -- Obsidian stores the UI language
 *      under that key (its bundle literally has `ta = "language"` feeding
 *      `localStorage.getItem(ta)` / `setItem(ta, ...)`).
 *   2. `window.moment.locale()` -- Obsidian calls `window.moment.locale(<app
 *      language>)` right after loading a language pack, so moment's locale
 *      mirrors the app language.
 *
 * Anything that is not Chinese resolves to English, which is the sensible
 * fallback for a German or Japanese Obsidian.
 */

/** What the user picked in settings. */
export type LanguageSetting = "auto" | "zh" | "en";

/** What that resolves to at runtime. */
export type ResolvedLanguage = "zh" | "en";

/**
 * Chinese strings.
 *
 * This table is the source of truth for the key set: `MessageKey` is derived
 * from it, and the English table is typed as `Record<MessageKey, string>`, so a
 * key added here and forgotten there is a compile error.
 */
const zh = {
	// -- console ----------------------------------------------------------
	"log.loaded": "已加载",
	"log.linkNotFound": "右键了链接/嵌入，但正文里找不到对应链接",
	"log.resolveFailed": "getFirstLinkpathDest 失败",
	"log.editFailed": "改写链接失败",
	"log.posAtDomFailed": "posAtDOM 失败，尝试下一个候选",
	"log.posToOffsetFailed": "posToOffset 失败",
	"log.offsetToPosFailed": "offsetToPos 失败，用本地换算兜底",

	// -- notices ----------------------------------------------------------
	"notice.editFailed": "改写链接失败，详情见控制台。",

	// -- context menu -----------------------------------------------------
	"menu.removeBang": "去掉叹号（改为普通链接）",
	"menu.addBang": "加上叹号（改为嵌入）",
	"menu.deleteLink": "删除这个链接",

	// -- settings ---------------------------------------------------------
	// Deliberately identical in both tables: someone who switched to a
	// language they cannot read must still be able to find this one row.
	"settings.language.name": "界面语言 / Interface language",
	"settings.language.desc":
		"本插件的菜单与设置界面使用的语言。「自动」跟随 Obsidian 自身的语言设置。",
	"settings.language.auto": "自动（跟随 Obsidian）",
	"settings.language.zh": "中文",
	"settings.language.en": "English",

	"settings.bangToggle.name": "显示「切换叹号」",
	"settings.bangToggle.desc":
		"在实时预览里右键链接或嵌入内容时，菜单里出现一项，用来在" +
		"`[[链接]]` 与 `![[嵌入]]` 之间切换。关闭后这一项不再出现。",

	"settings.deleteLink.name": "显示「删除链接」",
	"settings.deleteLink.desc":
		"在实时预览里右键链接或嵌入内容时，菜单里出现一项，用来整段删除该链接" +
		"（含叹号）。关闭后这一项不再出现。",

	"settings.scope.name": "适用范围",
	"settings.scope.desc":
		"目前只在**实时预览**（含源码模式）里生效——这两种模式都有编辑器，" +
		"可以精确地改写源码。阅读视图没有编辑器，暂不支持。",
} as const;

/** Every valid key. Derived from the Chinese table. */
export type MessageKey = keyof typeof zh;

/** English strings. Must cover every key in `zh`. */
const en: Record<MessageKey, string> = {
	// -- console ----------------------------------------------------------
	"log.loaded": "loaded",
	"log.linkNotFound":
		"right-clicked a link/embed, but no matching link was found in the document",
	"log.resolveFailed": "getFirstLinkpathDest failed",
	"log.editFailed": "could not rewrite the link",
	"log.posAtDomFailed": "posAtDOM failed, trying the next candidate",
	"log.posToOffsetFailed": "posToOffset failed",
	"log.offsetToPosFailed":
		"offsetToPos failed, falling back to the local conversion",

	// -- notices ----------------------------------------------------------
	"notice.editFailed": "Could not rewrite the link. See the console for details.",

	// -- context menu -----------------------------------------------------
	"menu.removeBang": "Remove the ! (make it a normal link)",
	"menu.addBang": "Add ! (make it an embed)",
	"menu.deleteLink": "Delete this link",

	// -- settings ---------------------------------------------------------
	"settings.language.name": "界面语言 / Interface language",
	"settings.language.desc":
		"Language used by this plugin's menus and settings pane. " +
		'"Automatic" follows Obsidian\'s own language.',
	"settings.language.auto": "Automatic (follow Obsidian)",
	"settings.language.zh": "中文",
	"settings.language.en": "English",

	"settings.bangToggle.name": 'Show "Toggle the !"',
	"settings.bangToggle.desc":
		"Adds a menu entry when you right-click a link or embed in Live Preview, " +
		"switching between `[[link]]` and `![[embed]]`. Turn it off and the entry " +
		"stops appearing.",

	"settings.deleteLink.name": 'Show "Delete this link"',
	"settings.deleteLink.desc":
		"Adds a menu entry when you right-click a link or embed in Live Preview, " +
		"deleting the whole construct including the `!`. Turn it off and the entry " +
		"stops appearing.",

	"settings.scope.name": "Where it applies",
	"settings.scope.desc":
		"Live Preview (source mode included) only -- both have an editor, so the " +
		"source text can be rewritten exactly. Reading view has no editor and is " +
		"not supported.",
};

/** All tables, keyed by resolved language. */
const TABLES: Record<ResolvedLanguage, Record<MessageKey, string>> = { zh, en };

/** The language currently in effect. Starts at the factory default. */
let resolved: ResolvedLanguage = "zh";

/** The shape of `window` we actually rely on. */
interface WindowWithMoment {
	moment?: { locale?: () => string };
}

/**
 * Reads the language Obsidian itself is running in.
 *
 * @returns `"zh"` for any Chinese locale, otherwise `"en"`.
 */
function detectObsidianLanguage(): ResolvedLanguage {
	// 1. Obsidian's own key for the UI language.
	try {
		const stored = window.localStorage.getItem("language");
		if (stored) return stored.toLowerCase().startsWith("zh") ? "zh" : "en";
	} catch {
		// localStorage can throw when storage is disabled; fall through.
	}

	// 2. Obsidian keeps moment's locale in step with the app language.
	try {
		const locale = (window as unknown as WindowWithMoment).moment?.locale?.();
		if (typeof locale === "string" && locale.length > 0) {
			return locale.toLowerCase().startsWith("zh") ? "zh" : "en";
		}
	} catch {
		// Moment is not guaranteed to be loaded; fall through.
	}

	// 3. Last resort. In Electron this is usually the OS locale.
	const nav = typeof navigator === "undefined" ? "" : navigator.language;
	return nav && nav.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/**
 * Turns the stored setting into a concrete language.
 *
 * @param setting - The value from settings.
 * @returns The language to render in.
 */
export function resolveLanguage(setting: LanguageSetting): ResolvedLanguage {
	if (setting === "zh" || setting === "en") return setting;
	return detectObsidianLanguage();
}

/**
 * Applies a setting and remembers the result.
 *
 * @param setting - The value from settings.
 * @returns The language now in effect.
 */
export function setLanguage(setting: LanguageSetting): ResolvedLanguage {
	resolved = resolveLanguage(setting);
	return resolved;
}

/**
 * @returns The language now in effect.
 */
export function currentLanguage(): ResolvedLanguage {
	return resolved;
}

/**
 * Looks up a string, substituting `{name}` placeholders.
 *
 * @param key - Which string to fetch.
 * @param params - Values for any `{...}` placeholders in it.
 * @returns The string in the current language.
 */
export function t(
	key: MessageKey,
	params?: Record<string, string | number>
): string {
	const text = TABLES[resolved][key] ?? zh[key] ?? key;
	if (!params) return text;
	let out = text;
	for (const name of Object.keys(params)) {
		out = out.split(`{${name}}`).join(String(params[name]));
	}
	return out;
}

/**
 * Checks whether a stored value is a usable language setting.
 *
 * @param value - Raw value from `loadData()`.
 * @returns True when it is `"auto"`, `"zh"` or `"en"`.
 */
export function isLanguageSetting(value: unknown): value is LanguageSetting {
	return value === "auto" || value === "zh" || value === "en";
}
