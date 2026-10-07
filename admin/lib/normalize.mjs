/**
 * 段落归一化 —— 与 publish.py 的 normalize_paragraphs() 保持行为一致。
 *
 * 背景：用 Obsidian / Vditor 写中文时习惯"一行一段、行间只敲一个回车"。
 * CommonMark 会把连续行并入同一个 <p>（连 <br> 都不生成），于是整篇被塞进
 * 一个段落，global.css 的 text-indent: 2em 首行缩进与段间距全部失效。
 *
 * 判定规则（两条），只在明确是"段落边界"时插入空行：
 *   A. 上一行以句末标点（。！？…）结尾 —— 下一行无论以什么字符开头，都另起一段；
 *   B. 上一行以 CJK 文字/标点（非句末标点）结尾 —— 仅当下一行以 CJK 文字/标点
 *      开头时另起一段。
 *
 * 规则 B 的限定条件很关键：它让"上一行在句子中间被换行折断"的情况
 * （下一行以 ASCII 单词或数字开头）保持为同一段，避免把一句话切碎。
 * 列表、引用、表格、代码块均以 ASCII 字符开头，因此不会被改动。
 *
 * ⚠️ 改动本文件时必须同步修改 publish.py，并跑 `npm test` 校验两侧一致。
 */

// 与 Python 端逐字对应（注意：Python 的 \u 转义与这里一致）
const CJK = '\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff';
const PUNCT = '\uff0c\u3002\uff01\uff1f\uff1b\uff1a\u3001\u2026\u2014\u00b7';
const CLOSER = '\u300d\u300f\u3011\u300b\uff09\u3009\u201d\u2019"\']';
const ENDER = '\u3002\uff01\uff1f\u2026';
// 行尾：CJK 文字 + CJK 标点（含成对引号、书名号、半角引号）
const TAIL_CJK =
  '[' + CJK + PUNCT + '\u300c\u300e\u3010\u300a\uff08\u3008\u201c\u2018]';
// 行首：CJK 文字 + CJK 标点 + 开引号开括号
const HEAD_CJK =
  '[' + CJK + PUNCT + '\u300c\u300e\u3010\u300a\uff08\u3008\u201c\u2018]';

const RE_ENDER = new RegExp('(' + ENDER + '[' + CLOSER + ']{0,3})([ \\t]*)\\n(?!\\n)', 'g');
const RE_CJK = new RegExp(
  '(' + TAIL_CJK + ')([ \\t]*)\\n(?!\\n)(?=[ \\t]*' + HEAD_CJK + ')',
  'g'
);

export function normalizeParagraphs(body) {
  if (typeof body !== 'string' || body === '') return body ?? '';
  let out = body.replace(RE_ENDER, '$1$2\n\n');
  out = out.replace(RE_CJK, '$1$2\n\n');
  return out;
}

/** 统计段落块数量，用于界面提示 */
export function countParagraphs(body) {
  return body.split(/\n{2,}/).filter((b) => b.trim() !== '').length;
}
