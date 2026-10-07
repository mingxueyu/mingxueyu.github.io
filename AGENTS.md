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

## 本地可视化管理界面

```bash
npm start         # 推荐：启动服务 + 自动打开浏览器（已在跑则直接开浏览器）
npm run admin     # 只启动服务，不自动开浏览器
npm run shortcut  # 在桌面和开始菜单创建「文章管理」快捷方式
```

给作者用的增删改界面，避免手写 frontmatter / 记标签数组语法。零运行时依赖
（只用 `node:` 内置模块），Vditor 编辑器作为 devDependency 从
`node_modules/vditor/dist` 本地提供（**离线可用，且不进入部署产物**）。

### 一键启动的入口（给作者双击用）

| 文件 | 作用 |
|------|------|
| `启动文章管理.vbs` | **双击这个**：无黑窗口，后台起服务并自动开浏览器 |
| `启动文章管理.cmd` | 同上但会显示控制台窗口（排查问题用） |
| `停止文章管理.cmd` | 按端口找到进程并结束 |
| `scripts/launch-admin.mjs` | 真正的启动逻辑（定位 node → 复用/拉起 → 等 health → 开浏览器）|
| `scripts/make-shortcut.mjs` | 生成桌面 / 开始菜单 `.lnk` |

启动逻辑刻意放在 Node 里而不是批处理：.cmd 做轮询等待时每轮都要起一个进程，
还夹着 ping 延时，又慢又脆弱。Node 侧用 `spawn(detached:true, stdio:'ignore')`
拉起服务，父进程退出后服务继续存活，然后轮询 `/api/health` 直到就绪。

**三个必须知道的编码 / 路径坑（都踩过）**：

1. **`.vbs` 必须是 UTF-16LE + BOM**。WSH 只有在 UTF-16 下才可靠解析非 ASCII
   字面量；存成 ANSI/UTF-8 时脚本里的 `"启动文章管理.cmd"` 变乱码，
   `FileExists` 返回 False，于是**静默什么都不做** —— 双击快捷方式毫无反应，
   极难排查。用 `node scripts/write-launcher-vbs.mjs` 重新生成（带自检）。
2. **`.cmd` 必须是纯 ASCII + CRLF**。cmd.exe 按当前代码页解析文件，
   非 ASCII 注释可能直接把语法搞坏（见过 `was unexpected at this time`）。
   所以这些脚本里的提示信息一律用英文。
3. **`start` 不会可靠继承当前目录**。用相对路径 `admin\server.mjs` 时，
   实际会去 `D:\admin\server.mjs` 找（真实报错：`Cannot find module`）。
   必须传绝对路径 + `/d "%ROOT%"`；`server.mjs` 自身也已改成基于
   `import.meta.url` 定位（不依赖 cwd）。

### 服务端要点

- `admin/server.mjs` — HTTP 服务，只监听 `127.0.0.1`，默认端口 4322（`--port` 可改）
- `admin/lib/store.mjs` — 文章读写（frontmatter 解析/序列化、slug、回收站）
- `admin/lib/normalize.mjs` — 段落归一化的 JS 版，**必须与 `publish.py` 保持同步**
- `admin/public/index.html` — 界面（Vditor 即时渲染模式）
- 文章直接读写 `src/content/blog/`（与 Astro 同一事实来源），不经过 `posts/` 中转
- 删除是**软删除**：移到 `admin/.trash/<时间戳>/`，可在界面点「回收站」恢复
- 保存用 `mtime` 做乐观并发检查，冲突返回 409
- 发布 = `git add -A` → 判断有无改动 → `git commit` → `npm run build` → `git push`，
  日志实时显示在可折叠的面板里；**无改动时不会误报失败**

### 另外三个必须知道的坑（Windows / Vditor）

1. **不要 spawn `npm.cmd`**。Node 24 加固后直接 spawn `.cmd` 会抛 `spawn EINVAL`
   （`shell: true` 也不稳）。必须用当前 node 执行 npm 的 JS 入口：
   `process.execPath` + `<nodeDir>/node_modules/npm/bin/npm-cli.js`。
   见 `npmCommand()`。
2. **git 推送要清空代理**。本机 V2Ray 代理未运行时 `git push` 会
   `Connection was reset`。代码里统一用 `-c http.proxy= -c https.proxy=`，
   详见 `CLAUDE-交接记录.md` 第六节。
3. **Vditor 静态资源的 URL 形状**（踩过，表现为浏览器 404
   `vendor/vditor/dist/js/i18n/zh_CN.js`，界面语言/图标失效）。
   Vditor 内部把子资源拼成 `<cdn>/dist/js/lute/lute.min.js`、
   `<cdn>/dist/js/i18n/<lang>.js`；而为了拿到**未被改写的 UMD** `index.min.js`，
   `cdn` 必须指到 dist 目录本身（指到 vditor 包根会拿到 ESM 版，浏览器里直接白屏）。
   两者叠加意味着：真实文件在 `<dist>/js/...`，浏览器却请求
   `/vendor/vditor/dist/js/...`。因此 `admin/server.mjs` 的 vendor 路由会
   **剥掉 `dist/` 前缀**再解析文件。改这里必须跑 `api.test.mjs` 第 1 步 ——
   它会遍历 dist 下全部 `js/**` 子资源逐个验证（当前 391 个），
   并检查 zh_CN 语言包与 Lute 引擎的内容正确性。

### 第 4 个坑：Vditor 是异步初始化的

`new Vditor(...)` 返回时**内部实例还没建好**（`options.after` 的类型注释就是
"编辑器异步渲染完成后的回调方法"）。在 `after` 触发前调用 `setValue` / `getValue`
会抛：

```
TypeError: Cannot read properties of undefined (reading 'currentMode')
```

因为 `currentMode` 只在内部 `setIR`/`setWYSIWYG`/`setSV` 里才被赋值
（`index.min.js`）。**这个错误不会白屏**，只在界面右下角弹一个 toast，极易漏掉。

所以 `admin/public/index.html` 用 `vdReady` + `vdPendingValue` 队列：
初始化完成前先排队，`after` 回调里再补写内容；`getBody()` 在未就绪时返回排队值。

`npm run test:ui` 就是为这类"页面能显示但功能是坏的"问题准备的 ——
它用 headless Chrome 加载真实界面，断言无错误提示、且第一篇文章的正文
确实出现在渲染结果里。已用变异测试确认：把 `setBody()` 退回旧写法，
该测试会以同样的 currentMode 报错失败。

### 测试

```bash
npm test                              # 差分测试：JS 与 Python 段落归一化逐字节一致
npm run test:api                      # 42 项接口/校验/软删除/并发 + Vditor 资源全量校验（需服务在跑）
npm run test:ui                       # headless Chrome 渲染监管界面（抓异步初始化类错误，需服务在跑）
npm run test:interact                 # CDP 驱动真实浏览器测交互（如发布日志面板开合，需服务在跑）
node admin/test/publish.test.mjs --real   # 完整发布链路；默认不跑，会真实提交+推送
```

**改动任一侧的归一化规则后必须跑 `npm test`。**

### 用 CDP 测交互（而不是 --dump-dom）

`--dump-dom` 只能看首屏静态 DOM，**无法测点击后的行为**；headless 模式又不支持
多 target，用 iframe 会报 "Multiple targets are not supported"。
所以 `admin/test/cdp.mjs` 用 `--remote-debugging-port` + DevTools Protocol
（Node 24 自带 WebSocket，零依赖）连到真实页面，可以 `Runtime.evaluate`
执行 JS 并读回结果 —— 交互类 bug 只能这样测。

`interact.test.mjs` 就是用它验证发布日志面板的开合。注意测 **CSS 过渡**
要等动画走完（该面板 0.25s）再量尺寸，否则量到的是中间值。

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
