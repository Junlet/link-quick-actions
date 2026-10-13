/**
 * Plugin settings.
 *
 * The two menu entries can each be switched off, so a user who only ever wants
 * one of them never sees the other cluttering the context menu.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type LinkQuickActionsPlugin from "./main";

/** Persisted plugin settings. */
export interface LinkQuickActionsSettings {
	/** Show "toggle the link's `!`" in the editor context menu. */
	enableBangToggle: boolean;
	/** Show "delete this link" in the editor context menu. */
	enableDeleteLink: boolean;
}

/** Settings used on first install and for any missing key. */
export const DEFAULT_SETTINGS: LinkQuickActionsSettings = {
	enableBangToggle: true,
	enableDeleteLink: true,
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

		new Setting(containerEl)
			.setName("显示「切换叹号」")
			.setDesc(
				"在实时预览里右键链接或嵌入内容时，菜单里出现一项，用来在" +
					"`[[链接]]` 与 `![[嵌入]]` 之间切换。关闭后这一项不再出现。"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableBangToggle)
					.onChange(async (value) => {
						this.plugin.settings.enableBangToggle = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("显示「删除链接」")
			.setDesc(
				"在实时预览里右键链接或嵌入内容时，菜单里出现一项，用来整段删除该链接" +
					"（含叹号）。关闭后这一项不再出现。"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableDeleteLink)
					.onChange(async (value) => {
						this.plugin.settings.enableDeleteLink = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("适用范围")
			.setDesc(
				"目前只在**实时预览**（含源码模式）里生效——这两种模式都有编辑器，" +
					"可以精确地改写源码。阅读视图没有编辑器，暂不支持。"
			);
	}
}
