/**
 * Plugin settings.
 *
 * The two menu entries can each be switched off, so a user who only ever wants
 * one of them never sees the other cluttering the context menu. A third setting
 * picks the interface language.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import {
	isLanguageSetting,
	setLanguage,
	t,
	type LanguageSetting,
	type MessageKey,
} from "./i18n";
import type LinkQuickActionsPlugin from "./main";

/**
 * The language dropdown rows, in display order.
 *
 * Written out rather than derived from the setting values so the keys stay
 * checked: a typo here is a compile error, not a missing string at runtime.
 */
const LANGUAGE_ROWS: ReadonlyArray<{
	value: LanguageSetting;
	key: MessageKey;
}> = [
	{ value: "auto", key: "settings.language.auto" },
	{ value: "zh", key: "settings.language.zh" },
	{ value: "en", key: "settings.language.en" },
];

/** Persisted plugin settings. */
export interface LinkQuickActionsSettings {
	/** Show "toggle the link's `!`" in the editor context menu. */
	enableBangToggle: boolean;
	/** Show "delete this link" in the editor context menu. */
	enableDeleteLink: boolean;
	/** Interface language: follow Obsidian, or pin Chinese / English. */
	language: LanguageSetting;
}

/**
 * Settings used on first install and for any missing key.
 *
 * `language` defaults to `"zh"` rather than `"auto"` on purpose: it keeps the
 * wording of an existing install byte-for-byte what it was before the language
 * setting existed.
 */
export const DEFAULT_SETTINGS: LinkQuickActionsSettings = {
	enableBangToggle: true,
	enableDeleteLink: true,
	language: "zh",
};

/**
 * Merges stored data over the defaults, rejecting unusable values.
 *
 * @param stored - Raw value from `loadData()`.
 * @returns Valid settings.
 */
export function normalizeSettings(
	stored: Partial<LinkQuickActionsSettings> | null
): LinkQuickActionsSettings {
	const merged = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
	if (typeof merged.enableBangToggle !== "boolean") {
		merged.enableBangToggle = DEFAULT_SETTINGS.enableBangToggle;
	}
	if (typeof merged.enableDeleteLink !== "boolean") {
		merged.enableDeleteLink = DEFAULT_SETTINGS.enableDeleteLink;
	}
	if (!isLanguageSetting(merged.language)) {
		merged.language = DEFAULT_SETTINGS.language;
	}
	return merged;
}

/** Settings tab shown under Settings -> Community plugins -> this plugin. */
export class LinkQuickActionsSettingTab extends PluginSettingTab {
	private readonly plugin: LinkQuickActionsPlugin;

	constructor(app: App, plugin: LinkQuickActionsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// The language row comes first so it is reachable even when the rest of
		// the pane is in a language the user cannot read.
		new Setting(containerEl)
			.setName(t("settings.language.name"))
			.setDesc(t("settings.language.desc"))
			.addDropdown((dropdown) => {
				for (const row of LANGUAGE_ROWS) {
					dropdown.addOption(row.value, t(row.key));
				}
				dropdown
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = isLanguageSetting(value)
							? value
							: DEFAULT_SETTINGS.language;
						await this.plugin.saveSettings();
						setLanguage(this.plugin.settings.language);
						// Re-render so the rest of the pane follows immediately.
						this.display();
					});
			});

		new Setting(containerEl)
			.setName(t("settings.bangToggle.name"))
			.setDesc(t("settings.bangToggle.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableBangToggle)
					.onChange(async (value) => {
						this.plugin.settings.enableBangToggle = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.deleteLink.name"))
			.setDesc(t("settings.deleteLink.desc"))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableDeleteLink)
					.onChange(async (value) => {
						this.plugin.settings.enableDeleteLink = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("settings.scope.name"))
			.setDesc(t("settings.scope.desc"));
	}
}
