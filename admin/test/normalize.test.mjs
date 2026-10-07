/**
 * 差分测试：证明 admin/lib/normalize.mjs 与 publish.py 的 normalize_paragraphs()
 * 输出完全一致。两边行为漂移会导致"界面里保存好好的，发布后段落又坏了"。
 *
 * 运行：npm test
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeParagraphs } from '../lib/normalize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---- 构造用例：含真实文章正文 + 各类边界 ----
const cases = [];

// 1. 全部真实文章（已发布的）正文
const blogDir = join(ROOT, 'src', 'content', 'blog');
for (const f of readdirSync(blogDir).filter((x) => x.endsWith('.md'))) {
  const text = readFileSync(join(blogDir, f), 'utf8');
  const m = text.match(/^---\n[\s\S]*?\n---\n/);
  cases.push({ name: 'real:' + f, body: m ? text.slice(m[0].length).trim() : text });
}

// 2. posts/ 里的原始稿件
const postsDir = join(ROOT, 'posts');
for (const f of readdirSync(postsDir).filter((x) => x.endsWith('.md'))) {
  const text = readFileSync(join(postsDir, f), 'utf8');
  const m = text.match(/^---\n[\s\S]*?\n---\n/);
  cases.push({ name: 'posts:' + f, body: m ? text.slice(m[0].length).trim() : text });
}

// 3. 人工边界用例
cases.push(
  { name: 'cjk-single-newline', body: '第一段内容。\n第二段内容。\n第三段内容。' },
  { name: 'already-blank', body: '第一段。\n\n第二段。' },
  { name: 'md-list', body: '- 项目一\n- 项目二\n- 项目三' },
  { name: 'code-fence', body: '```python\nprint(1)\nprint(2)\n```' },
  { name: 'heading-then-text', body: '## 标题\n正文内容在这里。' },
  { name: 'english-softwrap', body: 'line one\nline two\nline three' },
  { name: 'quote-start', body: '他说：\n“于是我们奋力向前划。”' },
  {
    name: 'sentence-wrap-not-split',
    body: '我说ai太好用了有没有懂的。不过感觉最近deepseek有点失智，大抵是算力不够吧。',
  },
  {
    name: 'closing-quote-after-ender',
    body: '他说完了。”\n下一段开始了。',
  },
  { name: 'table', body: '| a | b |\n| - | - |\n| 1 | 2 |' },
  { name: 'indented-list', body: '  - 缩进列表一\n  - 缩进列表二' },
  { name: 'crlf', body: '第一段。\r\n第二段。' },
  { name: 'empty', body: '' },
  { name: 'only-newlines', body: '\n\n\n' },
  { name: 'trailing-spaces', body: '第一段。   \n第二段。  ' }
);

// ---- Python 侧：一次性把所有用例交给 Python ----
const pyScript = `
import io, json, sys, importlib.util
spec = importlib.util.spec_from_file_location("pub", r"${join(ROOT, 'publish.py')}")
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)
data = json.load(io.open(sys.argv[1], encoding="utf-8"))
out = [pub.normalize_paragraphs(c["body"]) for c in data]
io.open(sys.argv[2], "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False))
`;

const tmpIn = join(ROOT, 'admin', '.cases.json');
const tmpOut = join(ROOT, 'admin', '.py-out.json');
const { writeFileSync, unlinkSync } = await import('node:fs');
writeFileSync(tmpIn, JSON.stringify(cases.map((c) => ({ body: c.body }))), 'utf8');

let passed = 0;
const failures = [];
try {
  execFileSync('python', ['-c', pyScript, tmpIn, tmpOut], {
    cwd: ROOT,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  });
  const pyOut = JSON.parse(readFileSync(tmpOut, 'utf8'));

  if (pyOut.length !== cases.length) {
    throw new Error(`用例数不一致：python=${pyOut.length} js=${cases.length}`);
  }

  cases.forEach((c, i) => {
    const js = normalizeParagraphs(c.body);
    const py = pyOut[i];
    if (js === py) {
      passed++;
    } else {
      failures.push({ name: c.name, js, py });
    }
  });
} finally {
  for (const f of [tmpIn, tmpOut]) {
    try {
      unlinkSync(f);
    } catch {}
  }
}

console.log(`\n差分测试：${passed}/${cases.length} 用例两侧输出一致\n`);
if (failures.length) {
  console.log('❌ 不一致的用例：');
  for (const f of failures) {
    console.log(`\n--- ${f.name} ---`);
    console.log('  python:', JSON.stringify(f.py));
    console.log('  js    :', JSON.stringify(f.js));
  }
  process.exit(1);
}
console.log('✅ JS 与 Python 的段落归一化行为完全一致');
