#!/usr/bin/env python3
"""
一键发布脚本
用法：把 .md 文件放到 posts/ 文件夹，然后运行：
  python publish.py "提交说明"
"""
import os, sys, shutil, re, subprocess
from datetime import date

# 确保 Node.js 在 PATH 中（Windows + Espressif Python 环境兼容）
NODEJS_DIR = r"C:\Program Files\nodejs"
if os.path.isdir(NODEJS_DIR) and NODEJS_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = NODEJS_DIR + os.pathsep + os.environ.get("PATH", "")

ROOT = os.path.dirname(os.path.abspath(__file__))
POSTS_DIR = os.path.join(ROOT, "posts")
CONTENT_DIR = os.path.join(ROOT, "src", "content", "blog")
TODAY = date.today().isoformat()


def extract_frontmatter(text):
    """解析已有的 frontmatter，返回 (frontmatter_dict, body)"""
    text = text.strip()
    if not text.startswith("---"):
        return None, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None, text
    fm = {}
    for line in parts[1].strip().split("\n"):
        line = line.strip()
        if ":" in line:
            key, _, val = line.partition(":")
            fm[key.strip()] = val.strip().strip("\"'")
    return fm, parts[2].strip()


def slugify(title):
    """标题 → 文件名"""
    s = title.lower().strip()
    s = re.sub(r"[^\w一-鿿\s-]", "", s)
    s = re.sub(r"\s+", "-", s)
    return s or f"post-{TODAY}"


def format_tags(tags):
    if not tags:
        return "[]"
    if isinstance(tags, str):
        tags = tags.strip()
        # 已经是 YAML 数组格式，直接返回
        if tags.startswith("["):
            return tags
        tags = [t.strip() for t in tags.split(",")]
    inner = ", ".join(f'"{t}"' for t in tags)
    return f"[{inner}]"


def publish(msg="更新文章"):
    if not os.path.exists(POSTS_DIR):
        os.makedirs(POSTS_DIR)
        print("📁 已创建 posts/ 文件夹，把 .md 文件放进去后重新运行。")
        return

    md_files = [f for f in os.listdir(POSTS_DIR) if f.endswith(".md")]
    if not md_files:
        print("⚠️  posts/ 文件夹里没有 .md 文件，请先放入文章。")
        return

    for filename in md_files:
        src = os.path.join(POSTS_DIR, filename)
        with open(src, "r", encoding="utf-8") as f:
            text = f.read()

        fm, body = extract_frontmatter(text)

        # 自动补全 frontmatter
        if fm is None:
            title = os.path.splitext(filename)[0]
            fm = {"title": title}
            body = text

        title = fm.get("title", os.path.splitext(filename)[0])
        description = fm.get("description", "")
        date_str = fm.get("date", TODAY)
        tags = fm.get("tags", [])
        categories = fm.get("categories", [])
        draft = fm.get("draft", "false")

        slug = slugify(title)
        dest_name = f"{slug}.md"
        dest = os.path.join(CONTENT_DIR, dest_name)

        frontmatter_block = f"""---
title: "{title}"
description: "{description}"
date: {date_str}
tags: {format_tags(tags)}
categories: {format_tags(categories)}
draft: {draft}
---"""

        with open(dest, "w", encoding="utf-8") as f:
            f.write(frontmatter_block + "\n\n" + body.strip() + "\n")

        print(f"✅ {filename} → src/content/blog/{dest_name}")

    # 构建
    print("\n📦 构建中…")
    result = subprocess.run("npx astro build", cwd=ROOT, capture_output=True, text=True, shell=True, encoding="utf-8")
    if result.returncode != 0:
        print("❌ 构建失败")
        print(result.stderr)
        return

    # Git
    print("📝 提交…")
    subprocess.run("git add .", cwd=ROOT, shell=True)
    subprocess.run(f'git commit -m "{msg}"', cwd=ROOT, shell=True)

    # 推送
    print("🚀 推送…")
    push = subprocess.run("git push", cwd=ROOT, capture_output=True, text=True, shell=True, encoding="utf-8")
    if push.returncode == 0:
        print("✅ 已发布！1-2 分钟后刷新 treefish.top")
    else:
        print(f"❌ 推送失败: {push.stderr}")


if __name__ == "__main__":
    msg = sys.argv[1] if len(sys.argv) > 1 else "更新文章"
    publish(msg)
