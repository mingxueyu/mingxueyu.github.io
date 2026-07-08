---
title: "如何使用 Astro 搭建个人博客"
description: "从零开始，一步步搭建一个支持分类、标签、搜索、评论的现代个人博客。"
date: 2026-07-09
tags: ["Astro", "博客", "教程"]
categories: ["技术", "前端", "Astro"]
---

## 为什么选择 Astro

Astro 是一个现代静态站点生成器，专为内容型网站设计。相比传统框架：

- **零 JavaScript 输出** — 页面纯 HTML，加载极快
- **Markdown 原生支持** — 写文章就像写笔记
- **组件系统** — 支持 React / Vue / Svelte 混用
- **Content Collections** — 类型安全的内容管理

## 搭建步骤

### 1. 创建项目

```bash
npm create astro@latest my-blog
cd my-blog
npm install
```

### 2. 写第一篇文章

在 `src/content/blog/` 下创建 `.md` 文件：

```markdown
---
title: "文章标题"
date: 2026-07-09
tags: ["标签1"]
categories: ["技术", "前端"]
---

正文内容...
```

### 3. 部署到 GitHub Pages

推送代码到 `用户名.github.io` 仓库，GitHub Actions 自动构建部署。

## 本站功能清单

| 功能 | 说明 |
|------|------|
| 📝 Markdown 写作 | 支持代码高亮、图片、表格 |
| 🏷️ 标签系统 | 多标签交叉检索 |
| 📁 多级分类 | 无限层级嵌套 |
| 🔍 全文搜索 | Pagefind 引擎，模糊匹配 |
| 💬 评论区 | 基于 Supabase，支持 GitHub 登录 |
| 📮 RSS 订阅 | 自动生成 |
| 🚀 自动部署 | push 即上线 |

## 总结

Astro 是目前（2026 年）搭建个人博客的最佳选择。生态成熟、文档完善、社区活跃。
