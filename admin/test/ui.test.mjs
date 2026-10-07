/**
 * 界面渲染冒烟测试（headless Chrome）。
 *
 * 为什么需要它：Vditor 的初始化是**异步**的——构造函数返回时内部实例还不存在，
 * 此时调用 setValue/getValue 会抛
 *   TypeError: Cannot read properties of undefined (reading 'currentMode')
 * 这类错误不会让页面白屏，只在界面右下角弹一个 toast，很容易被漏掉。
 * 所以这里用真实浏览器加载管理界面，断言"没有错误提示"且"正文确实写进了编辑器"。
 *
 * 用法：node admin/test/ui.test.mjs [baseUrl]
 * 需要本机有 Chrome 或 Edge；没有则跳过（不算失败）。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:4322';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) {
  console.log('\n未找到 Chrome/Edge，跳过界面渲染测试。\n');
  process.exit(0);
}

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log(`  ✗ ${name}${extra ? ' → ' + extra : ''}`); }
};

const profile = join(ROOT, 'admin', '.chrome-profile');
const dump = (url) =>
  execFileSync(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=10000',
      '--dump-dom',
      url,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
  );

console.log(`\n界面渲染测试（${browser.split('\\').pop()}）`);
console.log(`目标：${BASE}\n`);

try {
  const html = dump(BASE + '/');

  // 1) 编辑器结构渲染出来了
  check('工具栏已渲染', /vditor-toolbar/.test(html));
  check('IR 编辑区已渲染', /vditor-ir/.test(html));

  // 2) 关键：初始化不能报错（toast 里出现 TypeError 就是异步初始化被违反了）
  const toast = (html.match(/<div id="toast"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
  check('没有错误提示（toast 为空）', toast.trim() === '', JSON.stringify(toast.trim().slice(0, 160)));
  // 注意：不能直接搜 "currentMode" —— Vditor 自己的源码就内联在页面里，必然命中。
  // 必须限定在"报错语境"里搜。
  const errCtx = /(TypeError|Uncaught|Cannot read propert|reading 'currentMode')/;
  check('无 currentMode 类错误', !errCtx.test(toast), toast.trim().slice(0, 160));
  check('无未捕获异常', !/Uncaught|SyntaxError/.test(html));

  // 3) 正文真的被异步初始化后的队列写进了编辑器
  const post = await fetch(BASE + '/api/posts').then((r) => r.json());
  const first = post.posts[0];
  if (first) {
    const detail = await fetch(BASE + '/api/post?slug=' + encodeURIComponent(first.slug)).then((r) => r.json());
    const probe = (detail.body || '').split('\n').find((l) => l.trim().length > 6) || '';
    const probeText = probe.replace(/[#*`>\-]/g, '').trim().slice(0, 12);
    check(
      `第一篇文章正文已载入编辑器（探针「${probeText}」）`,
      probeText.length > 0 && html.includes(probeText),
      '正文未出现在渲染结果中'
    );
  } else {
    check('有文章可供测试', false, 'posts 为空');
  }
} catch (e) {
  check('浏览器执行成功', false, e.message);
} finally {
  try {
    execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', profile], { stdio: 'ignore' });
  } catch {}
  for (const f of ['_vdtest.html']) {
    try { unlinkSync(join(ROOT, 'admin', 'public', f)); } catch {}
  }
}

console.log(`\n${'─'.repeat(52)}`);
if (fails.length) {
  console.log(`❌ ${pass} 项通过，${fails.length} 项失败：`);
  fails.forEach((f) => console.log('   · ' + f));
  process.exit(1);
}
console.log(`✅ 界面渲染 ${pass} 项检查全部通过`);
