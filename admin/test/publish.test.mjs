/**
 * 发布流程端到端测试。会对真实的 git 仓库做一次提交与推送，因此：
 *  - 用 draft:true 的文章，绝不污染线上站点（index.astro 过滤 draft）
 *  - 场景跑完后把文章移入回收站，并 git reset 掉自己制造的提交
 *  - 结束后远端会比本地多出测试提交，需手动 force push 恢复（脚本会打印命令）
 *
 * ⚠️ 本脚本会操作真实仓库。历史上曾因误用 `git clean -fdx` 删掉 .env 与
 *    node_modules；任何清理都必须显式指定路径，禁止无参数 -x 清理。
 *
 * ⚠️ 本脚本会操作真实仓库：提交、推送、reset --hard。
 *    默认**不执行**，需要显式加 --real 才运行；且脚本会先确认 .env 存在，
 *    任何清理都必须显式指定路径（禁止无参数 `git clean -x`）。
 *
 * 用法：node admin/test/publish.test.mjs [baseUrl] --real
 */
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:4322';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REAL = process.argv.includes('--real');

if (!REAL) {
  console.log('\n这是一个会提交并推送真实仓库的破坏性测试，默认不执行。');
  console.log('确认要跑请加 --real：');
  console.log('   node admin/test/publish.test.mjs --real\n');
  process.exit(0);
}
if (!existsSync(join(ROOT, '.env'))) {
  console.error('\n✗ 未找到 .env。本测试历史上曾误删过它，因此现在拒绝在缺少 .env 时运行。');
  console.error('  请先恢复 .env（见 CLAUDE-交接记录.md）再重试。\n');
  process.exit(1);
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();

const post = (p, body) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then((r) => r.json());

const waitDone = async (timeoutMs = 300000) => {
  const t0 = Date.now();
  for (;;) {
    const d = await fetch(BASE + '/api/publish').then((r) => r.json());
    if (!d.publishing) return d.log;
    if (Date.now() - t0 > timeoutMs) return d.log + '\n[TIMEOUT]';
    await new Promise((r) => setTimeout(r, 800));
  }
};

const head = () => git('rev-parse', 'HEAD');
const localMain = () => git('rev-parse', 'main');

let pass = 0;
const fails = [];
const check = async (name, cond, extra) => {
  const ok = await cond;
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log(`  ✗ ${name}${extra ? ' → ' + extra : ''}`); }
};

const TITLE = '管理界面发布链路自检';
let slug = null;

// 前置：把未被忽略的残留清掉，否则「无改动」场景会被待提交文件干扰。
// ⚠️ 绝对不要用 `git clean -fdx` —— 那会连 .env 和 node_modules 一起删掉。
if (git('status', '--porcelain')) {
  git('add', '-A');
  git('commit', '-m', '自检前置：提交待处理改动');
}
for (const d of ['__pycache__', 'admin/.trash']) {
  rmSync(join(ROOT, d), { recursive: true, force: true });
}

const before = head();

try {
  console.log('\n[场景 1] 连续两次发布 —— 第二次应当识别为"没有改动"');
  // 预热：把任何残留改动（含前置提交产生的未推送提交）处理掉
  await post('/api/publish', { message: '自检：预热' });
  const warm = await waitDone();
  await check('预热发布成功', /✅/.test(warm) && !/❌/.test(warm), warm.trim().split('\n').slice(-2).join(' | '));

  const headAfterWarm = head();
  await post('/api/publish', { message: '自检：无改动' });
  const log1 = await waitDone();
  console.log('  ' + log1.trim().split('\n').filter(Boolean).slice(-2).join('\n  '));
  await check('无改动时报告"无需发布"而不是失败', /无需发布|没有改动/.test(log1) && !/❌/.test(log1));
  await check('无改动时没有产生新提交', head() === headAfterWarm, `before=${headAfterWarm.slice(0,7)} now=${head().slice(0,7)}`);

  console.log('\n[场景 2] 新建草稿文章 → 保存并发布（完整链路）');
  const c = await post('/api/post', {
    title: TITLE,
    date: new Date().toISOString().slice(0, 10),
    description: '发布链路自检用，可删除',
    tags: ['自检'],
    categories: ['技术'],
    draft: true,
    body: '第一段自检内容。\n第二段自检内容，验证段落归一化。',
  });
  slug = c.slug;
  await check('草稿创建成功', !!slug, JSON.stringify(c));

  await post('/api/publish', { message: '自检：发布链路' });
  const log2 = await waitDone();
  console.log(log2.trim().split('\n').slice(-4).join('\n'));
  await check('发布报告完成', /✅/.test(log2) && !/❌/.test(log2));
  await check('产生了新提交', head() !== before);
  await check('已推送到远端（本地 main 与 HEAD 一致）', localMain() === head());
  await check('提交信息正确', git('log', '-1', '--pretty=%s').includes('发布链路'));

  const staged = git('status', '--porcelain');
  await check('发布后工作区干净', staged === '', staged.slice(0, 120));

  console.log('\n[场景 3] 删除草稿并清理');
  const del = await fetch(BASE + '/api/post?slug=' + encodeURIComponent(slug), { method: 'DELETE' })
    .then((r) => r.json());
  await check('删除成功', !!del.trash, JSON.stringify(del));
} finally {
  // 还原：把本次测试制造的提交全部撤掉，回到测试前状态
  try {
    git('reset', '--hard', before);
    git('clean', '-fd', '--', 'src/content/blog');
    console.log(`\n[清理] 已 git reset --hard 回到 ${before.slice(0, 7)}`);
    if (slug) {
      console.log(`[清理] 已移除测试文章 ${slug}.md`);
    }
    const stillDirty = git('status', '--porcelain');
    if (stillDirty) {
      console.log('[注意] 工作区仍有未提交内容：');
      console.log('       ' + stillDirty.split('\n').slice(0, 8).join('\n       '));
    }
    console.log(`\n[重要] 本测试会向远端推送提交。远端当前比本地多出测试提交，`);
    console.log(`       请手动恢复远端：git push --force origin ${before.slice(0, 7)}:main`);
  } catch (e) {
    console.log('清理失败：' + e.message);
  }
}

console.log(`\n${'─'.repeat(52)}`);
if (fails.length) {
  console.log(`❌ ${pass} 项通过，${fails.length} 项失败：`);
  fails.forEach((f) => console.log('   · ' + f));
  process.exit(1);
}
console.log(`✅ 发布链路 ${pass} 项检查全部通过`);
