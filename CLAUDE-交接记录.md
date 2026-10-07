# CLAUDE-交接记录.md

记录 **Claude Code → DSH** 的接管过程：可继承的资产、现场盘点结论、已修复内容、
待决事项。目的是让这次交接可追溯，不必重复考古。

交接时间：接管会话当日。接管前最后提交：`c53aefc 更新文章`（2026-09-18）。

---

## 一、可继承的资产（与"没有可继承的记忆"）

**结论：不存在 Claude 的压缩记忆摘要，项目状态只能从 git 历史还原。**

排查过程：

1. `CLAUDE.md` 顶部有 `@.claude/recall-context.md` 导入，但该文件内容是
   `<!-- No recall context available. This file is populated by the PreCompact hook. -->`，
   即从未被写入过。
2. `.claude/settings.json` 里的 recall 钩子（`PreCompact` / `SessionStart`）指向
   `~/.claude/plugins/cache/FlineDev/recall/.../pre-compact.sh`。本次接管时该路径
   **不存在** —— 插件未安装，钩子不可能产出内容。
3. 在 `~/.claude/projects/` 下查找本项目的会话记录：**`D--my-blog` 目录不存在**
   （`~/.claude/projects/` 下只有 10 个其他项目目录），也没有任何会话内容提到
   `my-blog` / `treefish`。唯一相关残留是 `D--my-blog-public-audio` 这个空目录名。
   即 Claude 的原始对话记录已被清理，无法还原它的思路。

因此本次接管**没有**继承到 Claude 的上下文，而是靠代码、git 历史和实测重新建立。
`.claude/recall-context.md` 保持 gitignore，钩子配置保留但不影响 DSH。

> 副作用提醒：既然 recall 钩子依赖的插件路径不存在，如果之后重新装回 Claude Code，
> 这两个钩子会静默失败。不影响本仓库构建与发布。

## 二、接管时的仓库状态

| 项目 | 状态 |
|------|------|
| 分支 / 远程 | `main` ↔ `origin/main`，**完全同步**（ahead 0 / behind 0） |
| 工作区 | 干净，无未提交改动 |
| 部署 | 每次 push 到 `main` 触发 GitHub Actions → GitHub Pages（treefish.top） |
| 构建 | `npm run build` 通过（astro build + pagefind，索引 21 页 785 词） |
| 遗留 | `main-switch` 分支停留在 `0b0a14a`（升级 Node 24），已被 main 取代，未清理 |

`posts/` 里的《26.9.16散记》已完成过一轮 `publish.py`，正文确实进了
`src/content/blog/26916散记.md`，所以"发布动作本身是成功的"——问题出在正文格式。

## 三、盘点发现的问题（按严重度）

### 1. 段落结构损坏 —— 已修复 【严重，线上可见】

**现象**：`26.9.16散记` 和 `这是一个标题` 两篇文章，整篇正文被渲染成**一个** `<p>`。

实测（修复前，从 `dist/` 里数标签）：

| 文章 | `<p>` | `<h1>` | `<h2>` |
|------|-------|--------|--------|
| 26.7.15散记 | 4 | 1 | 0 |
| **26.9.16散记** | **1** | 1 | 0 |
| hello-world | 3 | 1 | 1 |
| 如何使用-astro-搭建个人博客 | 6 | 1 | 4 |
| **这是一个标题** | 3 | **4** | 0 |

**根因**：Markdown 源码里段落之间只有**单换行**（作者用 Obsidian 写字，习惯一行一段）。
CommonMark 把连续行并入同一个段落，连 `<br>` 都不生成，于是 `/blog/26916散记`
整个正文只有一个 `<p>`，`global.css` 的 `text-indent: 2em` 首行缩进和段间距全部失效。
`这是一个标题` 另有 4 个 `<h1>`（frontmatter 标题已渲染一个 `<h1>`，正文又用了 `# `），
层级与 SEO 都不对。

**为什么之前没被发现**：同一问题在提交 `e786090`（"修复段落换行：行尾双空格改为空行
分隔"）修过一次，但那是**逐篇手工修**；作者下次用 Obsidian 写作又会产生同样的单换行。

**修复**（两处）：

- `publish.py` 新增 `normalize_paragraphs()`，发布时自动把段落边界的单换行转成空行，
  从源头掐掉这类损坏。规则与边界见 `AGENTS.md` 与函数注释。
- 修好两篇文章的正文，`这是一个标题` 的正文 `# ` 降为 `## `。

**验证**（修复后重跑构建，重新数标签）：

| 文章 | `<p>` | `<h1>` | `<h2>` |
|------|-------|--------|--------|
| 26.9.16散记 | **10**（1 个标题 + 9 段） | 1 | 0 |
| 这是一个标题 | 3 | **1** | **3** |

### 2. `publish.py` 的构建命令漏掉搜索索引 —— 已修复 【中】

原命令是 `npx astro build`，而 `package.json` 的 build 脚本是
`astro build && npx pagefind --site dist`。所以**本地发布产生的 `dist/` 没有 Pagefind
索引**（实测：`dist/pagefind` 不存在）。线上不受影响（GitHub Actions 跑 `npm run build`），
但如果本地用 `publish.py` 的产物做预览，搜索是坏的、且与线上不一致。
已改为 `npm run build`。

### 3. `publish.py` 丢字段 —— 已修复 【中】

脚本会重写 frontmatter，但白名单里没有 `updated`：作者写了 `updated` 会被静默丢弃
（`src/content.config.ts` 支持该字段，`博客写作语法规则.md` 也把它列为可用字段）。
已改为存在则原样保留。

### 4. `__pycache__/*.pyc` 被纳入版本控制 —— 已修复 【低】

`__pycache__/publish.cpython-311.pyc` 被 git 跟踪，而 `.gitignore` 没排除 `__pycache__/`。
已在 `.gitignore` 补上并移除该文件。

### 5. 未定义 CSS 变量 `--color-*` —— 已修复 【中，线上可见】

`global.css` 的 `:root` 定义的是**无前缀**变量：`--bg` `--text` `--muted` `--accent`
`--border` `--hover` `--radius` `--width`。

但 7 个文件里有 27 处引用的是**不存在的** `--color-*` 变量：

| 文件 | 引用 |
|------|------|
| `src/pages/blog/[slug].astro` | `--color-muted`、`--color-accent` |
| `src/pages/tags.astro` | `--color-muted` |
| `src/pages/categories/[...path].astro` | `--color-muted` ×3 |
| `src/pages/search.astro` | `--color-text`、`--color-bg`、`--color-border`、`--color-muted` |
| `src/components/AuthWidget.astro` | `--color-border`、`--color-text`、`--color-muted`、`--color-accent` |
| `src/components/CommentWidget.astro` | `--color-accent`、`--color-border`、`--color-muted` |
| `src/components/GuestbookWidget.astro`（同上系列） | 同上 |

已确认构建产物 CSS 里**没有**任何 `--color-*` 定义，这些 `var()` 全部退化为
initial/inherit。具体后果：`color: var(--color-muted)` 无颜色声明 → 继承正文色（次要文字
没有变灰）；`background: var(--color-accent)` 无效 → 按钮**背景透明**（白底黑字，
在毛玻璃背景上对比度不稳）；`background: var(--color-border)` 无效 → 次要按钮无底色。

**修复**（经作者确认）：在 `global.css` 的 `:root` 补一组别名
（`--color-muted: var(--muted)` 等，共 6 个），一处改动让 27 处引用全部生效，
且不改变现有黑白配色（`--accent` 本身就是 `#000`）。
已实测构建产物 CSS 中六个别名均已输出。

<!-- 历史备注：本项原记录为"待决"，修法曾在"补别名"与"改 27 处引用"之间取舍，
     作者选择补别名（改动最小、不动现有设计）。 -->

### 6. 新文章的分类与标签为空 —— 待作者决定 【低】

`26916散记` 与 `这是一个标题` 的 `tags` / `categories` 都是 `[]`。按 schema 默认值这是
合法的，但 `博客写作语法规则.md` 明确写了"缺少 `categories` 字段 → 文章不会出现在
分类树中"。两者现在确实不在分类页和标签页里。
**这是内容决定，不是技术问题**，需要作者给出分类/标签后再补。

## 四、这次接管做了什么 / 没做什么

已做：

1. 还原项目真实状态（git、构建、部署链路全部实测，非只读文档）。
2. 确认无 Claude 记忆可继承，并说明依据（见第一节）。
3. 适配记忆文件：把项目知识集中写进 `AGENTS.md`（DSH 读取的标准文件），
   `CLAUDE.md` 改为指向 `AGENTS.md` 并说明 `.claude/` 现状，去掉失效的 `@` 导入。
4. 修复第 1–5 项问题，重建并实测验证（数 `<p>` / `<h1>` / `<h2>` 标签、
   核对构建产物里的 CSS 变量）。

提交记录：

| 提交 | 内容 | 线上部署 |
|------|------|----------|
| `32500a4` | 段落归一化 + 修正两篇正文 + `publish.py` 三处修复 + 记忆文件适配 | run #41 ✅ |
| `ec9efab` | `global.css` 补 `--color-*` 别名 | run #42 ✅ |

两个 run 的 `conclusion` 均为 `success`（经 GitHub Actions API 核实）。

未做（等你决定）：

- 第 6 项补分类/标签：你选择自己来定。字段位置就是文章 frontmatter 的
  `tags: [...]` 与 `categories: [...]`（见 `AGENTS.md` 的字段表）；
  填好后跑一次 `python publish.py "更新文章"` 即可。
- 未清理 `main-switch` 遗留分支（停在 `0b0a14a`）。
- 未重新生成 `博客写作语法规则.pdf`：`.md` 里"发布流程"一节未提及新的自动
  段落归一化。需要同步时重新导出 PDF。
- 未启动 dev server（按约定只在明确要求时启动）。

## 五、本机环境问题：失效的代理（会挡住 git push）

**症状**：`git push` 报 `fatal: unable to access '...': Recv failure: Connection was reset`。

**根因**：本机配了一个 V2Ray 混合代理 `127.0.0.1:10808`，但**代理进程没在运行**
（实测该端口未监听）。它通过三处配置生效，互相独立：

| 位置 | 内容 | 影响 |
|------|------|------|
| `git config --global http.proxy` / `https.proxy` | `http://127.0.0.1:10808` | 挡住 `git push` / fetch |
| `~/.curlrc` | `proxy = "http://127.0.0.1:10808"` | 挡住 `curl` |
| 注册表 `HKCU:\...\Internet Settings` | `ProxyEnable=1`, `ProxyServer=127.0.0.1:10808` | 影响走系统代理的程序 |

**绕过办法**（不改动你的全局配置）：

```bash
# git：本次命令内清空代理
git -c http.proxy= -c https.proxy= push origin main

# curl：忽略 .curlrc
curl -q ...
```

**本次处理**：只做了绕过，**没有**改动上述三处配置 —— 因为如果你的代理软件之后
启动，这些配置是正常的，擅自删除反而会破坏你的正常用法。

> 补充：`curl` 即使绕过代理，访问 HTTPS 仍可能失败并报
> `schannel: CRYPT_E_REVOCATION_OFFLINE`（证书吊销列表服务器被墙）。
> 因此本环境**无法用 curl 直接核验线上页面**；线上验证改用
> GitHub Actions API 查部署结论（`conclusion: success`）配合本地 `dist/` 检查。

## 六、两个工具并存时的注意点

- **DSH 读 `AGENTS.md`**；Claude Code 读 `CLAUDE.md`。项目知识只维护在 `AGENTS.md`，
  `CLAUDE.md` 只保留指针，避免两边说法漂移。
- `.claude/settings.json` 的钩子是 Claude Code 专属的，DSH 不执行；不要指望
  `.claude/recall-context.md` 里会有内容。
- 发布只认 `publish.py`。无论用哪个工具写文章，都走它，才能享受段落归一化。
- `AGENTS.md` / `CLAUDE.md` 里"用 `astro dev --background`"是 Astro 脚手架的默认文案，
  与 `package.json` 的实际脚本（`npm run dev`）不符，已改正。
