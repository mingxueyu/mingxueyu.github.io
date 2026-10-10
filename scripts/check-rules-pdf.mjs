/**
 * 导出后的完整性检查。
 *
 * 分两层，各查各能查准的东西：
 *
 * 1) **内容层（精确）**：检查 博客写作语法规则.md 的每个章节标题、代码块、
 *    表格行是否都进了生成的 HTML。这一层是精确字符串比对，可靠。
 *
 * 2) **PDF 层（结构性）**：PDF 的文字是多个字体子集混排，用 ToUnicode CMap
 *    反查时个别字会不准（同一行切换字体处），所以**不适合做逐字校验**。
 *    这一层只断言结构性事实：页数 > 0、确实有文本与内嵌字体、
 *    反查出的字符数与 HTML 正文规模相当。
 *
 * 视觉排版无法自动断言，用 HTML 截图人工确认（见 AGENTS.md）。
 *
 * 用法：npm run pdf:check
 */
import { readFileSync, existsSync } from 'node:fs';
import zlib from 'node:zlib';

const MD = '博客写作语法规则.md';
const HTML = '博客写作语法规则.html';
const PDF = '博客写作语法规则.pdf';

let fail = 0;
const ok = (name, cond, extra) => {
  if (!cond) fail++;
  console.log('  ' + (cond ? '✓' : '✗') + ' ' + name + (extra ? '  ' + extra : ''));
};

// ---------------- 1) 内容层：md → html ----------------
console.log('\n[内容] ' + MD + ' → ' + HTML);

const md = readFileSync(MD, 'utf8');
const htmlRaw = readFileSync(HTML, 'utf8');

// 把 HTML 摊平成纯文本再比对：markdown 的行内代码/粗体/链接会被渲染成
// 标签（`x` → <code>x</code>），直接拿 md 原文去 includes 必然失配。
const html = htmlRaw
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

/** markdown 行内标记 → 纯文本 */
const plainify = (s) =>
  String(s)
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/~~/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// 章节标题（md 的 ## 与 ###）
const heads = [...md.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => plainify(m[1]));
let headMiss = 0;
for (const h of heads) {
  if (!html.includes(h)) {
    headMiss++;
    console.log('     缺失标题: ' + h);
  }
}
ok(`全部 ${heads.length} 个标题都在 HTML 中`, headMiss === 0);

// 表格行
const cells = [...md.matchAll(/^\|(.+)\|\s*$/gm)]
  .flatMap((m) => m[1].split('|').map((c) => plainify(c)))
  .filter((c) => c && !/^:?-{2,}:?$/.test(c));
let cellMiss = 0;
for (const c of cells) {
  if (!html.includes(c)) {
    cellMiss++;
    if (cellMiss <= 3) console.log('     缺失单元格: ' + c);
  }
}
ok(`全部 ${cells.length} 个表格单元格都在 HTML 中`, cellMiss === 0);

// 代码块：块内内容按原样出现在 <pre><code> 里。
// ⚠️ 不要 trim 代码行 —— 文档里正有一段是**故意**演示"行尾双空格"的示例，
// trim 掉就永远匹配不上（这里踩过一次）。
const fences = [...md.matchAll(/^```[a-z]*\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
let fenceMiss = 0;
for (const f of fences) {
  const lines = f
    .split('\n')
    .map((l) => l.replace(/^>\s?/, '')) // 块引用行会去掉 "> " 前缀
    .filter((l) => l.trim() !== '');
  for (const line of lines) {
    // 空白折叠比对：HTML 里换行会变成 "\n"，连续空格也可能被原样保留，
    // 因此两边都折叠空白再比，避免因空格数量差异误判。
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    if (!norm(html).includes(norm(line))) {
      fenceMiss++;
      if (fenceMiss <= 3) console.log('     缺失代码行: ' + JSON.stringify(line.slice(0, 50)));
      break;
    }
  }
}
ok(`全部 ${fences.length} 个代码块都在 HTML 中`, fenceMiss === 0);

// ---------------- 2) PDF 层：结构 ----------------
console.log('\n[结构] ' + PDF);

if (!existsSync(PDF)) {
  ok('PDF 文件存在', false);
} else {
  const buf = readFileSync(PDF);
  const raw = buf.toString('latin1');
  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const fonts = (raw.match(/\/FontFile\d?\s+\d+\s+\d+\s+R/g) || []).length;

  ok('页数 > 0', pages > 0, `(${pages} 页)`);
  ok('有内嵌字体（换机器不会变方块）', fonts > 0, `(${fonts} 个)`);

  // 粗略反查字符规模，确认不是空文档
  const chunks = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const s = m.index + m[0].length;
    const e = raw.indexOf('endstream', s);
    if (e < 0) continue;
    try {
      chunks.push(zlib.inflateSync(buf.subarray(s, e)));
    } catch {}
  }
  const text = Buffer.concat(chunks).toString('latin1');
  const map = new Map();
  for (const b of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      let s = '';
      for (let i = 0; i + 4 <= p[2].length; i += 4) s += String.fromCodePoint(parseInt(p[2].slice(i, i + 4), 16));
      map.set(p[1].toLowerCase(), s);
    }
  }
  let out = '';
  for (const c of chunks) {
    for (const h of c.toString('latin1').matchAll(/<([0-9A-Fa-f]{4,})>\s*(?:Tj|TJ)/g)) {
      const hex = h[1];
      for (let i = 0; i + 4 <= hex.length; i += 4) {
        const k = hex.slice(i, i + 4).toLowerCase();
        if (map.has(k)) out += map.get(k);
      }
    }
  }
  const mdChars = md.replace(/\s/g, '').length;
  ok(
    '反查字符数与正文规模相当（非空文档）',
    out.length > mdChars * 0.5,
    `(反查 ${out.length} / 正文 ${mdChars})`
  );
}

console.log('\n' + (fail === 0 ? '✅ 导出检查通过' : `❌ ${fail} 项未通过`));
console.log('   视觉排版请用 HTML 截图人工确认（做法见 AGENTS.md）\n');
process.exit(fail === 0 ? 0 : 1);
