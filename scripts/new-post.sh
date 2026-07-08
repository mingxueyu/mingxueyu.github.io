#!/bin/bash
# 快捷创建新文章
# 用法: bash scripts/new-post.sh "文章标题" "标签1,标签2"

TITLE="${1:-新文章}"
TAGS="${2:-}"

# 生成文件名（中文转拼音或直接用日期）
TODAY=$(date +%Y-%m-%d)
SLUG=$(echo "$TITLE" | sed 's/[[:space:]]\+/-/g' | sed 's/[^a-zA-Z0-9一-鿿-]//g')
if [ -z "$SLUG" ]; then
  SLUG="post-$TODAY"
fi

FILE="src/content/blog/${SLUG}.md"

# 格式化标签
if [ -n "$TAGS" ]; then
  TAG_LIST=$(echo "$TAGS" | sed 's/, */", "/g')
  TAG_YAML="[\"$TAG_LIST\"]"
else
  TAG_YAML="[]"
fi

cat > "$FILE" << EOF
---
title: "$TITLE"
description: ""
date: $TODAY
tags: $TAG_YAML
---

开始写你的内容 ✍️
EOF

echo "✅ 文章已创建: $FILE"
echo "   编辑后运行: npm run publish"
