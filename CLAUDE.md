# CLAUDE.md

本项目的完整说明（发布流程、内容规范、架构要点、已知坑）统一维护在 **`AGENTS.md`**，
请直接阅读该文件，不要在此重复。

从 Claude Code 交接给 DSH 的现场盘点见 `CLAUDE-交接记录.md`。

## 关于 `.claude/`

- `.claude/settings.json` — recall 插件的 `PreCompact` / `SessionStart` 钩子。这些是
  Claude Code 专属机制，DSH 不读取。
- `.claude/recall-context.md` — 由上述钩子生成，且已 gitignore。历史上一直是空的
  （`<!-- No recall context available. -->`），因此**没有可继承的压缩摘要**；
  项目状态以 git 历史 + `CLAUDE-交接记录.md` 为准。
- 本文件原先顶部的 `@.claude/recall-context.md` 导入已移除：它引用的是一个空的、
  不入库的文件，留着只会造成"有记忆其实没有"的错觉。

## Development

When starting the dev server, use background mode:

```
npm run dev
```

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
