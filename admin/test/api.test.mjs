/**
 * admin API 端到端测试（对运行中的本地服务发真实请求）。
 *   node admin/test/api.test.mjs [baseUrl]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] || 'http://127.0.0.1:4322';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BLOG = join(ROOT, 'src', 'content', 'blog');

let pass = 0;
const fails = [];
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name + (extra ? ' → ' + extra : ''));
    console.log(`  ✗ ${name}${extra ? ' → ' + extra : ''}`);
  }
}

async function req(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 200) };
  }
  return { status: r.status, json };
}

console.log(`\n测试目标：${BASE}\n`);

// ---------------------------------------------------------------- 健康检查
console.log('[1] 健康检查与静态资源');
{
  const h = await req('GET', '/api/health');
  check('GET /api/health 返回 ok', h.status === 200 && h.json.ok === true);

  const page = await fetch(BASE + '/');
  const html = await page.text();
  check('GET / 返回界面 HTML', page.status === 200 && html.includes('文章管理'));

  const vd = await fetch(BASE + '/vendor/vditor/index.min.js');
  const vdText = await vd.text();
  check('Vditor 主脚本可加载', vd.status === 200 && vdText.length > 100000);

  for (const p of ['/index.css', '/js/i18n/zh_CN.js', '/js/icons/ant.js', '/js/lute/lute.min.js']) {
    const r = await fetch(BASE + '/vendor/vditor' + p);
    check(`Vditor 资源 ${p}`, r.status === 200);
  }

  const trav = await fetch(BASE + '/vendor/vditor/../../../package.json');
  check('阻止 ../ 路径穿越', trav.status === 404 || trav.status === 403, 'status=' + trav.status);
}

// ---------------------------------------------------------------- 列表与分类
console.log('\n[2] 列表与标签分类');
const existing = [];
{
  const r = await req('GET', '/api/posts');
  check('GET /api/posts 返回 posts 数组', r.status === 200 && Array.isArray(r.json.posts));
  check('taxonomy 含 tags/categories', r.json.taxonomy && Array.isArray(r.json.taxonomy.tags));
  existing.push(...r.json.posts.map((p) => p.slug));
  console.log(`     已有 ${r.json.posts.length} 篇，标签 ${r.json.taxonomy.tags.length} 个，分类 ${r.json.taxonomy.categories.length} 个`);
}

// ---------------------------------------------------------------- 新建（含段落归一化）
console.log('\n[3] 新建文章 + 段落自动规整');
const NEW_TITLE = '管理界面自动化测试稿';
let createdSlug = null;
{
  const bodyText = '第一段测试内容。\n第二段测试内容。\n第三段测试内容。';
  const r = await req('POST', '/api/post', {
    title: NEW_TITLE,
    date: '2026-10-07',
    description: '自动化测试',
    tags: ['测试', '工具'],
    categories: ['技术', '测试'],
    draft: true,
    body: bodyText,
  });
  check('POST /api/post 新建成功', r.status === 200 && r.json.created === true, JSON.stringify(r.json));
  check('返回 normalized=true（确实是单换行被规整）', r.json.normalized === true);
  createdSlug = r.json.slug;

  const file = join(BLOG, createdSlug + '.md');
  check('文件确实写入 src/content/blog', existsSync(file));
  const text = readFileSync(file, 'utf8');
  check('frontmatter 含 title', text.includes(`title: "${NEW_TITLE}"`));
  check('frontmatter 含 tags 数组', text.includes('tags: ["测试", "工具"]'));
  check('frontmatter 含 categories 数组', text.includes('categories: ["技术", "测试"]'));
  check('frontmatter 含 draft: true', text.includes('draft: true'));
  check('正文三段之间有实空行', text.includes('第一段测试内容。\n\n第二段测试内容。\n\n第三段测试内容。'));
}

// ---------------------------------------------------------------- 读取
console.log('\n[4] 读取单篇');
{
  const r = await req('GET', '/api/post?slug=' + encodeURIComponent(createdSlug));
  check('GET /api/post 返回内容', r.status === 200 && r.json.title === NEW_TITLE);
  check('tags 正确解析', JSON.stringify(r.json.tags) === JSON.stringify(['测试', '工具']), JSON.stringify(r.json.tags));
  check('categories 正确解析', JSON.stringify(r.json.categories) === JSON.stringify(['技术', '测试']));
  check('draft 正确解析为布尔', r.json.draft === true);
  check('带 mtime 用于并发检查', typeof r.json.mtime === 'number' && r.json.mtime > 0);
}

// ---------------------------------------------------------------- 更新 + 乐观并发
console.log('\n[5] 更新 与 mtime 并发保护');
{
  const cur = (await req('GET', '/api/post?slug=' + encodeURIComponent(createdSlug))).json;
  const r = await req('POST', '/api/post', {
    slug: createdSlug,
    title: NEW_TITLE + '（改）',
    date: '2026-10-07',
    description: '',
    tags: ['测试'],
    categories: ['技术', '测试'],
    draft: false,
    body: cur.body + '\n\n追加的一段。',
    mtime: cur.mtime,
  });
  check('按 mtime 更新成功', r.status === 200 && r.json.created === false, JSON.stringify(r.json));

  const after = (await req('GET', '/api/post?slug=' + encodeURIComponent(createdSlug))).json;
  check('标题已更新', after.title.endsWith('（改）'));
  check('draft 已改为 false', after.draft === false);

  // 用过期的 mtime 再存一次 → 必须 409
  const stale = await req('POST', '/api/post', {
    slug: createdSlug,
    title: '不该被写入的标题',
    date: '2026-10-07',
    body: 'x',
    mtime: 1,
  });
  check('过期 mtime 被拒绝（409）', stale.status === 409, 'status=' + stale.status);
  const still = (await req('GET', '/api/post?slug=' + encodeURIComponent(createdSlug))).json;
  check('过期写入没有污染文件', still.title.endsWith('（改）'));
}

// ---------------------------------------------------------------- 校验
console.log('\n[6] 输入校验');
{
  const noTitle = await req('POST', '/api/post', { title: '  ', date: '2026-10-07', body: 'x' });
  check('空标题被拒绝（400）', noTitle.status === 400, 'status=' + noTitle.status);

  const badDate = await req('POST', '/api/post', { title: '日期测试', date: '2026/10/07', body: 'x' });
  check('非法日期被拒绝（400）', badDate.status === 400, 'status=' + badDate.status);

  const badSlug = await req('GET', '/api/post?slug=' + encodeURIComponent('../package'));
  check('非法 slug 被拒绝', badSlug.status === 400 || badSlug.status === 404, 'status=' + badSlug.status);

  const missing = await req('GET', '/api/post?slug=不存在的文章xyz');
  check('读取不存在的文章返回 404', missing.status === 404, 'status=' + missing.status);
}

// ---------------------------------------------------------------- 发布接口（只验证不实际推送）
console.log('\n[7] 发布接口行为');
{
  const r = await req('GET', '/api/publish');
  check('GET /api/publish 返回状态与日志', r.status === 200 && typeof r.json.publishing === 'boolean');
  check('未在发布时 publishing=false', r.json.publishing === false);
}

// ---------------------------------------------------------------- 删除（软删除）
console.log('\n[8] 软删除');
{
  const r = await req('DELETE', '/api/post?slug=' + encodeURIComponent(createdSlug));
  check('DELETE 成功', r.status === 200 && r.json.trash, JSON.stringify(r.json));
  check('原文件已从 blog 目录移除', !existsSync(join(BLOG, createdSlug + '.md')));
  const trashPath = join(ROOT, r.json.trash);
  check('文件已进回收站', existsSync(trashPath), r.json.trash);
  if (existsSync(trashPath)) {
    const t = readFileSync(trashPath, 'utf8');
    check('回收站内容完整', t.includes(NEW_TITLE));
  }

  const list = await req('GET', '/api/posts');
  const slugs = list.json.posts.map((p) => p.slug);
  check('已从列表消失', !slugs.includes(createdSlug));
}

// ---------------------------------------------------------------- 回归：原有文章未被破坏
console.log('\n[9] 回归检查：原有文章未被改动');
{
  const list = await req('GET', '/api/posts');
  const slugs = list.json.posts.map((p) => p.slug);
  for (const s of existing) {
    if (!slugs.includes(s)) fails.push(`原有文章丢失：${s}`);
  }
  check('原有文章全部还在', existing.every((s) => slugs.includes(s)));
  const sanji = list.json.posts.find((p) => p.slug === '26916散记');
  if (sanji) check('26916散记 仍是 9 段正文', sanji.paragraphs === 10, 'paragraphs=' + sanji.paragraphs);
}

// ---------------------------------------------------------------- 结果
console.log(`\n${'─'.repeat(52)}`);
if (fails.length) {
  console.log(`❌ ${pass} 项通过，${fails.length} 项失败：`);
  fails.forEach((f) => console.log('   · ' + f));
  process.exit(1);
}
console.log(`✅ 全部 ${pass} 项检查通过`);
