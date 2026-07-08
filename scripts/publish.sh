#!/bin/bash
# 一键发布：构建 + 提交 + 推送
# 用法: bash scripts/publish.sh "提交信息"

MSG="${1:-更新文章}"

echo "📦 构建中..."
npx astro build || { echo "❌ 构建失败"; exit 1; }

echo "📝 提交: $MSG"
git add .
git commit -m "$MSG" || echo "⚠️ 没有新更改"

echo "🚀 推送到 GitHub..."
git push && echo "✅ 已发布！等 1-2 分钟后刷新 treefish.top"
