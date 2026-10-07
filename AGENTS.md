# my-blog — treefish 的个人博客

Astro 静态博客，发布在 **https://treefish.top**（GitHub Pages，仓库 `mingxueyu/mingxueyu.github.io`，分支 `main`）。
日常操作是"写文章 → 发布"，不是常规的 Web 应用开发。

## 发布流程（最常用的操作）

```bash
python publish.py "提交说明"
```

`publish.py` 依次完成：解析 `posts/*.md` 的 frontmatter → 自动补全缺失字段 →
**段落归一化** → 写入 `src/content/blog/<slug>.md` → `npm run build`（astro + pagefind）
→ `git add . && git commit && git push`。推送到 `main` 后 GitHub Actions 自动部署
（`.github/workflows/deploy.yml`），1–2 分钟后 `treefish.top` 更新。

- 文章源文件放 `posts/`，**没有** frontmatter 也能发（文件名当标题、当天当日期）
- 构建产物 `dist/`、`.astro/`、`node_modules/`、`.env` 均已 gitignore
- 本地预览：`npm run dev`（**只在用户明确要求时启动**）

### 段落归一化（重要）

作者用 Obsidian 写中文，习惯**一行一段、行间只敲一个回车**。CommonMark 会把连续行
合并进同一个 `<p>`，于是整篇被塞进一个段落，`global.css` 里的 `text-indent: 2em`
首行缩进和段间距全部失效。`normalize_paragraphs()` 在发布时自动把段落边界的单换行
转成空行，规则（见 `publish.py` 注释）：

- **A**：上一行以句末标点（`。！？…`）结尾 → 下一行另起一段
- **B**：上一行以 CJK 文字/标点（非句末标点）结尾 → 仅当下一行以 CJK 文字/标点开头才另起一段

规则 B 的限定条件是关键：它让"长句在中间被换行折断"的情况（下一行以 ASCII 单词
或数字开头）保持为同一段，避免把一句话切碎。列表、引用、表格、代码块都以 ASCII
开头，因此不会被误改。函数是幂等的，可安全重复执行。

**已知边界**：若某段是长段落被 Obsidian 自动折行，且折行处恰好在句末标点之后，
规则 A 会把它误判为段落边界。人工核对文章成稿仍是最可靠的一步。

## 内容与 frontmatter

`src/content.config.ts` 定义了 blog collection 的 schema：

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | 是 | 标题 |
| `description` | 否 | 摘要 |
| `date` | 是 | `YYYY-MM-DD` |
| `updated` | 否 | 最后更新日期 |
| `tags` | 否 | 字符串数组，默认 `[]` |
| `categories` | 否 | 分类路径数组，默认 `[]`；**留空则文章不进分类树** |
| `draft` | 否 | 默认 `false` |

`categories: ["技术","前端"]` 表示 技术 › 前端。**引号必须用英文半角 `""`**，中文
全角引号会导致 YAML 解析问题和 URL 乱码（历史上踩过，见提交 61c707f）。

给作者看的完整写作规范在 `博客写作语法规则.md`（配套 PDF 同目录）。

## 架构要点

- `src/layouts/BaseLayout.astro` — 全站外壳。**手写的极简客户端路由**：拦截站内链接
  点击，只替换 `<main>` 内容，让侧边栏（含 `AudioPlayer`）不被销毁，实现切页时音乐
  不中断。改导航或布局时要意识到这个 SPA 行为。需要强制整页加载的链接加
  `data-full-reload` 属性。
- `src/components/` — `Sidebar`、`TreeItem`/`CategoryTree`（递归分类树）、`AudioPlayer`、
  `AuthWidget`/`CommentWidget`/`GuestbookWidget`（基于 Supabase）。
- `src/lib/supabase.ts` — 读 `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY`。
  这两个值在 `.env`（本地）和 GitHub Actions secrets（部署）里，**均不入库**。
- 全站样式 `src/styles/global.css`，极简黑白风格，CSS 变量定义在 `:root`：
  `--bg` `--text` `--muted` `--accent` `--border` `--hover` `--radius` `--width`。
- 全文搜索用 Pagefind 1.5，`npm run build` 里 `npx pagefind --site dist` 生成索引；
  搜索页 `src/pages/search.astro` 用默认 UI。
- 背景图取 `public/gallery/` 随机一张，音频取 `public/audio/`。

## 开发

Dev server 用后台模式：

```bash
npm run dev
```

构建与预览：`npm run build`、`npm run preview`。

## 文档

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## 交接记录

从 Claude Code 接管的过程、现场盘点与待决事项见 `CLAUDE-交接记录.md`。
