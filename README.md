# Link Quick Actions

在**实时预览**里右键链接或嵌入内容，切换它是否带叹号，或整段删除。

Right-click a link in **Live Preview** to toggle its embed bang, or delete it.

---

## 中文

### 功能

在实时预览里右键，菜单里会多出两项：

| 菜单项 | 作用 |
|---|---|
| **加上/去掉叹号** | `[[链接]]` ⇄ `![[嵌入]]` |
| **删除这个链接** | 整段删除（含叹号） |

适用于：

- 普通笔记链接 `[[笔记]]`
- 图片 `![[图.png]]` —— **包括图片已经渲染出来、链接文字看不见的时候**
- 嵌入的笔记内容 `![[笔记]]` —— 右键嵌入区域内部的任意位置

改动通过 Obsidian 的编辑器接口写入，所以**撤销历史正常**（`Ctrl+Z` 可回退）。

### 依赖

**没有额外依赖。** 只需要 Obsidian ≥ 1.8.7，不需要画布也不需要 Excalidraw。

### 安装

放进 `<仓库>/.obsidian/plugins/link-quick-actions/`，重载后在「设置 → 第三方插件」启用。

文件夹名必须与 `manifest.json` 里的 `id` 完全一致。

### 设置

| 设置 | 默认 | 说明 |
|---|---|---|
| 界面语言 | 中文 | 「自动（跟随 Obsidian）」/ 中文 / English |
| 显示「切换叹号」 | 开 | 关掉后菜单里不再出现这一项 |
| 显示「删除链接」 | 开 | 同上 |

### 只支持实时预览

阅读视图没有编辑器，无法精确改写源码。本插件只处理**实时预览和源码模式**。

### 实现说明（给改代码的人）

两个 Obsidian 事件配合使用：

| 事件 | 用途 |
|---|---|
| `file-menu` | **主力**。右键编辑器里的链接或嵌入时触发（`source` 为 `"link-context-menu"`），**直接给出解析后的 `TFile` 和所属 `leaf`** |
| `editor-menu` | 兜底，覆盖只触发编辑器菜单的情况；用 `WeakSet<Menu>` 去重，避免同一菜单被加两次 |

因为 `file-menu` 给的是**真实文件路径**（`Z附件库/图.png`），而正文里写的是**链接短名**（`图`），两者不能用字符串比较。所以匹配时会把正文里每个候选链接**按 Obsidian 自己的规则解析一遍**再比对文件身份。

指针位置的定位用 CM6 的 `posAtDOM`（`editor.cm` 不在公开类型里，但运行时存在），失败时退回光标位置。

---

## English

### What it does

Adds two entries to Obsidian's context menu in **Live Preview**:

- **toggle the `!`** — `[[link]]` ⇄ `![[embed]]`
- **delete the link** — removes the whole construct, bang included

It works on a plain note link, a rendered image (`![[图.png]]`), and anywhere inside an embedded note — including when the image has replaced the link text entirely.

Edits go through Obsidian's editor API, so **undo works**.

### Requirements

None beyond Obsidian ≥ 1.8.7. No Canvas, no Excalidraw.

### Language

The interface is available in Chinese and English. The setting has three values — **Automatic** (follow Obsidian's own language), **中文**, and **English** — and ships defaulting to Chinese.

Detection reads `localStorage["language"]` (the key Obsidian itself uses) and falls back to `window.moment.locale()`, then to the OS locale. Any non-Chinese language resolves to English.

### Live Preview only

Reading view has no editor, so the source cannot be rewritten exactly. This plugin deliberately does not attempt it.

### How it finds the link

`file-menu` is the primary hook: Obsidian raises it for a right-click on a link or embed inside an editor (its `source` is `"link-context-menu"`) and hands over the resolved `TFile` plus the owning leaf. `editor-menu` is kept as a fallback, deduplicated with a `WeakSet<Menu>` so the two handlers never add the same items twice.

Because the menu supplies a **real path** while the source holds a **linktext**, matching resolves each candidate link the way Obsidian would and compares file identity rather than strings.

---

## 开发 / Development

```bash
npm install
npm run build && npm run deploy
```

## 许可 / License

MIT
