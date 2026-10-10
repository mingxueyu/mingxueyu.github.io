/**
 * 最小 PDF 校验器（零依赖）：确认 PDF 里真的嵌入了中文文本与字体。
 *
 * 为什么需要：Chrome 生成 PDF 后无法用截图确认（PDF 查看器在 headless 下截出空白），
 * 而中文字体缺失时会渲染成方块/空白，肉眼在小图上也难分辨。
 * 这里直接解析 PDF 对象：解压内容流 + 解析 ToUnicode CMap，反查实际写入的字符。
 *
 * 用法：node scripts/verify-pdf.mjs <file.pdf>
 */
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];
if (!file) {
  console.error('用法：node scripts/verify-pdf.mjs <file.pdf>');
  process.exit(1);
}

const buf = readFileSync(file);
const raw = buf.toString('latin1');

// ---- 1) 基本结构 ----
const version = (raw.match(/^%PDF-(\d\.\d)/) || [])[1];
const objCount = (raw.match(/\d+\s+\d+\s+obj/g) || []).length;
const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;

// ---- 2) 字体：是否嵌入（FontFile 表示内嵌字体程序） ----
const fontNames = [...raw.matchAll(/\/BaseFont\s*\/([#\w+\-,.]+)/g)].map((m) => m[1]);
const embedded = [...raw.matchAll(/\/FontFile(\d?)\s+(\d+)\s+\d+\s+R/g)].map((m) => m[2]);
const subtype = [...new Set([...raw.matchAll(/\/Subtype\s*\/(Type0|TrueType|Type1|CIDFontType\d)/g)].map((m) => m[1]))];

// ---- 3) 解压内容流，统计绘制操作 ----
let streamCount = 0;
let textOps = 0;
const decodedChunks = [];
const streamRe = /stream\r?\n/g;
let m;
while ((m = streamRe.exec(raw)) !== null) {
  const start = m.index + m[0].length;
  const end = raw.indexOf('endstream', start);
  if (end < 0) continue;
  const bytes = buf.subarray(start, end);
  streamCount++;
  let out = null;
  try {
    out = zlib.inflateSync(bytes);
  } catch {
    try {
      out = zlib.inflateRawSync(bytes);
    } catch {
      out = null;
    }
  }
  if (out) {
    const s = out.toString('latin1');
    decodedChunks.push(out);
    textOps += (s.match(/\bTj\b|\bTJ\b/g) || []).length;
  }
}

// ---- 4) 解析 ToUnicode CMap，得到 code → 字符 的映射 ----
const cmapText = Buffer.concat(decodedChunks).toString('latin1');
const map = new Map();
// bfchar / bfrange
for (const b of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
  for (const pair of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
    map.set(pair[1].toLowerCase(), hexToStr(pair[2]));
  }
}
for (const b of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
  for (const r of b[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
    const lo = parseInt(r[1], 16);
    const hi = parseInt(r[2], 16);
    const dst = parseInt(r[3], 16);
    for (let i = 0; i <= hi - lo && i < 65536; i++) {
      map.set((lo + i).toString(16).padStart(r[1].length, '0'), String.fromCodePoint(dst + i));
    }
  }
}

function hexToStr(hex) {
  let s = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16);
    if (!Number.isNaN(code)) s += String.fromCodePoint(code);
  }
  return s;
}

// 从内容流里取出 <hex> 形式的字符串，经 CMap 反查
let decodedText = '';
for (const chunk of decodedChunks) {
  const s = chunk.toString('latin1');
  for (const h of s.matchAll(/<([0-9A-Fa-f]{4,})>\s*(?:Tj|TJ)/g)) {
    const hex = h[1];
    for (let i = 0; i + 4 <= hex.length; i += 4) {
      const code = hex.slice(i, i + 4).toLowerCase();
      if (map.has(code)) decodedText += map.get(code);
    }
  }
}

const cjk = [...decodedText].filter((c) => c.codePointAt(0) > 0x2e7f).length;

console.log('\n文件      : ' + file);
console.log('大小      : ' + buf.length.toLocaleString() + ' 字节');
console.log('PDF 版本  : ' + (version || '未知'));
console.log('对象数    : ' + objCount + '   页数: ' + pageCount);
console.log('内容流    : ' + streamCount + ' 个，文本操作 ' + textOps + ' 次');
console.log('字体      : ' + (fontNames.length ? [...new Set(fontNames)].join(', ') : '(未列出)'));
console.log('字体子类型: ' + (subtype.length ? subtype.join(', ') : '(未知)'));
console.log('内嵌字体  : ' + (embedded.length ? embedded.length + ' 个 FontFile 对象 ✓' : '无 —— 换机器可能显示为方块 ✗'));
console.log('ToUnicode : ' + (map.size ? map.size + ' 条映射' : '无 ✗'));
console.log('反查出字符: ' + decodedText.length + ' 个，其中中文 ' + cjk + ' 个');
console.log('文本预览  : ' + JSON.stringify(decodedText.slice(0, 60)));

const ok = pageCount > 0 && embedded.length > 0 && cjk > 20;
console.log('\n判定      : ' + (ok ? '✅ 中文文本与字体均已嵌入' : '❌ 校验未通过'));
process.exit(ok ? 0 : 1);
