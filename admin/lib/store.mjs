/**
 * 文章读写层：frontmatter 解析/序列化、slug、软删除。
 *
 * 唯一事实来源是 src/content/blog/ —— 与 Astro content collection 一致。
 * 界面直接写这里，因此不依赖 posts/ 中转。注意 publish.py 的流程是
 * posts/ → src/content/blog/，两边并存的文章内容一致，重复发布不会冲突。
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeParagraphs, countParagraphs } from './normalize.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BLOG_DIR = join(ROOT, 'src', 'content', 'blog');
const TRASH_DIR = join(ROOT, 'admin', '.trash');

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** 去掉包裹的引号；仅当首尾是成对同种引号时 */
function unquote(v) {
  const s = String(v).trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }
  return s;
}

/** 解析 YAML 数组：["a","b"] 或 [a, b] */
function parseArray(v) {
  const s = String(v).trim();
  if (s === '' || s === '[]') return [];
  const inner = s.startsWith('[') ? s.slice(1, s.lastIndexOf(']')) : s;
  const out = [];
  // 按逗号切分，但尊重引号
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^,]+)/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    const val = m[1] ?? m[2] ?? m[3] ?? '';
    const s2 = (m[1] !== undefined || m[2] !== undefined ? val : unquote(val)).trim();
    if (s2) out.push(s2);
  }
  return out;
}

/** 把 frontmatter 文本解析为对象 */
export function parseFrontmatter(text) {
  const m = text.match(FM_RE);
  const fm = {};
  if (!m) return { fm, body: text.replace(/^\uFEFF/, '') };

  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key === 'tags' || key === 'categories') fm[key] = parseArray(val);
    else if (key === 'draft') fm[key] = val === 'true';
    else fm[key] = unquote(val);
  }
  return { fm, body: text.slice(m[0].length) };
}

/** YAML 双引号字符串转义 */
function yamlStr(v) {
  const s = String(v ?? '');
  // 换行会破坏单行 frontmatter；控制字符一并处理
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** 数组 → YAML 行内数组（始终半角双引号，避免历史踩过的全角引号问题） */
function yamlArray(arr) {
  const items = (arr || []).map((x) => String(x).trim()).filter(Boolean);
  return `[${items.map((x) => yamlStr(x)).join(', ')}]`;
}

/** 组装完整文件内容 */
export function serializePost(fm, body) {
  const lines = ['---', `title: ${yamlStr(fm.title)}`];
  if (fm.description) lines.push(`description: ${yamlStr(fm.description)}`);
  lines.push(`date: ${fm.date}`);
  if (fm.updated) lines.push(`updated: ${fm.updated}`);
  lines.push(`tags: ${yamlArray(fm.tags)}`);
  lines.push(`categories: ${yamlArray(fm.categories)}`);
  lines.push(`draft: ${fm.draft === true ? 'true' : 'false'}`);
  lines.push('---', '');
  return lines.join('\n') + '\n' + String(body).replace(/\r\n/g, '\n').trim() + '\n';
}

/** 标题 → 文件名（与 publish.py 的 slugify 保持一致） */
export function slugify(title) {
  const s = String(title ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'post-' + today();
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 防御路径穿越：slug 只允许字词、连字符、下划线、CJK */
export function safeSlug(slug) {
  const s = String(slug ?? '');
  if (!s || s.includes('/') || s.includes('\\') || s.includes('..')) {
    throw new HttpError(400, '非法文件名');
  }
  if (!/^[\p{L}\p{N}._-]+$/u.test(s)) throw new HttpError(400, '非法文件名');
  return s;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fileOf = (slug) => join(BLOG_DIR, safeSlug(slug) + '.md');

/** 列出全部文章（含草稿） */
export function listPosts() {
  if (!existsSync(BLOG_DIR)) return [];
  const posts = [];
  for (const name of readdirSync(BLOG_DIR)) {
    if (!name.endsWith('.md')) continue;
    const slug = name.slice(0, -3);
    const full = join(BLOG_DIR, name);
    let text, st;
    try {
      text = readFileSync(full, 'utf8');
      st = statSync(full);
    } catch {
      continue;
    }
    const { fm, body } = parseFrontmatter(text);
    posts.push({
      slug,
      title: fm.title || slug,
      description: fm.description || '',
      date: fm.date || '',
      updated: fm.updated || '',
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      categories: Array.isArray(fm.categories) ? fm.categories : [],
      draft: fm.draft === true,
      paragraphs: countParagraphs(body),
      chars: body.replace(/\s/g, '').length,
      mtime: Math.round(st.mtimeMs),
    });
  }
  // 按日期倒序，其次是标题
  posts.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title));
  return posts;
}

/** 收集现有标签与分类（用于界面点选），分类含各级前缀 */
export function listTaxonomy() {
  const tags = new Set();
  const categories = new Set();
  for (const p of listPosts()) {
    p.tags.forEach((t) => tags.add(t));
    p.categories.forEach((_, i, arr) => {
      // 逐级前缀：["技术","前端"] → "技术"、"技术/前端"
      categories.add(arr.slice(0, i + 1).join('/'));
    });
  }
  return {
    tags: [...tags].sort((a, b) => a.localeCompare(b, 'zh')),
    categories: [...categories].sort((a, b) => a.localeCompare(b, 'zh')),
  };
}

/** 读单篇 */
export function readPost(slug) {
  const full = fileOf(slug);
  if (!existsSync(full)) throw new HttpError(404, `找不到文章：${slug}`);
  const text = readFileSync(full, 'utf8');
  const st = statSync(full);
  const { fm, body } = parseFrontmatter(text);
  return {
    slug: safeSlug(slug),
    title: fm.title || slug,
    description: fm.description || '',
    date: fm.date || today(),
    updated: fm.updated || '',
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    categories: Array.isArray(fm.categories) ? fm.categories : [],
    draft: fm.draft === true,
    body: body.replace(/\r\n/g, '\n').trim(),
    mtime: Math.round(st.mtimeMs),
  };
}

/**
 * 保存：新建或更新。
 * @param {object} input  {slug?, title, description, date, updated, tags, categories, draft, body, mtime?}
 * @returns {{slug:string, created:boolean, normalized:boolean}}
 */
export function savePost(input) {
  const title = String(input.title ?? '').trim();
  if (!title) throw new HttpError(400, '标题不能为空');

  const date = String(input.date ?? '').trim() || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, '日期格式必须是 YYYY-MM-DD');
  const updated = String(input.updated ?? '').trim();
  if (updated && !/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
    throw new HttpError(400, '更新日期格式必须是 YYYY-MM-DD');
  }

  const rawBody = String(input.body ?? '').replace(/\r\n/g, '\n').trim();
  const body = normalizeParagraphs(rawBody);
  const normalized = body !== rawBody;

  const fm = {
    title,
    description: String(input.description ?? '').trim(),
    date,
    updated,
    tags: Array.isArray(input.tags) ? input.tags : [],
    categories: Array.isArray(input.categories) ? input.categories : [],
    draft: input.draft === true,
  };

  // 已有 slug 且文件存在 → 更新；否则新建（新建时保证不覆盖同名文章）
  const wantSlug = input.slug ? safeSlug(input.slug) : null;
  let slug;
  let created;
  if (wantSlug && existsSync(fileOf(wantSlug))) {
    slug = wantSlug;
    created = false;
  } else if (wantSlug) {
    // 带 slug 但文件不存在（改名场景）：沿用该 slug 新建
    slug = wantSlug;
    created = true;
  } else {
    const base = slugify(title);
    let candidate = base;
    let n = 2;
    while (existsSync(fileOf(candidate))) candidate = `${base}-${n++}`;
    slug = candidate;
    created = true;
  }

  // 乐观并发：更新已存在的文章时校验 mtime，避免覆盖别处的改动
  if (!created && input.mtime) {
    const cur = Math.round(statSync(fileOf(slug)).mtimeMs);
    if (cur !== Number(input.mtime)) {
      throw new HttpError(
        409,
        '这篇文章在别处被修改过（可能是编辑器或 git 操作）。请重新载入后再保存。'
      );
    }
  }

  if (!existsSync(BLOG_DIR)) mkdirSync(BLOG_DIR, { recursive: true });
  writeFileSync(fileOf(slug), serializePost(fm, body), 'utf8');

  const st = statSync(fileOf(slug));
  return { slug, created, normalized, mtime: Math.round(st.mtimeMs) };
}

/** 软删除：移动到 admin/.trash/<时间戳>/ */
export function deletePost(slug) {
  const full = fileOf(slug);
  if (!existsSync(full)) throw new HttpError(404, `找不到文章：${slug}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(TRASH_DIR, stamp);
  mkdirSync(dir, { recursive: true });
  renameSync(full, join(dir, safeSlug(slug) + '.md'));
  return { slug: safeSlug(slug), trash: `admin/.trash/${stamp}/${slug}.md` };
}

/** 回收站内容（便于恢复） */
export function listTrash() {
  if (!existsSync(TRASH_DIR)) return [];
  const out = [];
  for (const dir of readdirSync(TRASH_DIR)) {
    const d = join(TRASH_DIR, dir);
    try {
      for (const f of readdirSync(d)) {
        out.push({ when: dir, file: f, path: `admin/.trash/${dir}/${f}` });
      }
    } catch {}
  }
  return out.sort((a, b) => b.when.localeCompare(a.when));
}
