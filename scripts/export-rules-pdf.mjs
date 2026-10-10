/**
 * 把 博客写作语法规则.md 导出为 PDF（并顺带产出 HTML 预览）。
 *
 * 为什么用 Chrome 而不是 PDF 库：这台机器上没有任何 PDF 工具链
 * （无 pandoc / wkhtmltopdf / weasyprint / reportlab），而 Chrome 的
 * --print-to-pdf 对中文支持最好 —— 会把 Microsoft YaHei 子集嵌进 PDF，
 * 换机器也不会变成方块。已验证（scripts/verify-pdf.mjs）。
 *
 * 单一事实来源是 .md：改内容只改 md，再跑本脚本重新导出，避免两份文档漂移。
 *
 * 用法：npm run pdf
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { marked } = require('marked');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '博客写作语法规则.md');
const OUT_PDF = join(ROOT, '博客写作语法规则.pdf');
const OUT_HTML = join(ROOT, '博客写作语法规则.html');

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('✗ 未找到 Chrome/Edge，无法导出 PDF。');
  process.exit(1);
}

const md = readFileSync(SRC, 'utf8');
const body = marked.parse(md, { gfm: true, breaks: false });

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>博客写作规范</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }

  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: "Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif;
    font-size: 10.5pt;
    line-height: 1.75;
    color: #1a1a1a;
    margin: 0;
    max-width: 100%;
  }

  h1 {
    font-size: 19pt; font-weight: 600; letter-spacing: -.01em;
    margin: 0 0 1.2em; padding-bottom: .5em;
    border-bottom: 2px solid #000;
    page-break-after: avoid;
  }
  h2 {
    font-size: 13.5pt; font-weight: 600;
    margin: 1.8em 0 .7em; padding-left: .5em;
    border-left: 3px solid #000;
    page-break-after: avoid;
  }
  h3 {
    font-size: 11.5pt; font-weight: 600;
    margin: 1.3em 0 .5em;
    page-break-after: avoid;
  }

  p { margin: .6em 0; text-indent: 0; }
  strong { font-weight: 600; }

  ul, ol { margin: .6em 0; padding-left: 1.8em; }
  li { margin: .25em 0; }
  li > p { margin: .2em 0; }

  code {
    font-family: Consolas, "Cascadia Mono", monospace;
    font-size: .9em;
    background: #f4f4f4;
    padding: .1em .35em;
    border-radius: 3px;
  }
  pre {
    background: #f7f7f7;
    border: 1px solid #e6e6e6;
    border-radius: 5px;
    padding: .7em .9em;
    margin: .8em 0;
    overflow: visible;
    white-space: pre-wrap;
    word-break: break-all;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; font-size: 9.5pt; }

  blockquote {
    margin: .8em 0; padding: .5em .9em;
    border-left: 3px solid #bbb; background: #fafafa; color: #333;
  }
  blockquote p { margin: .2em 0; }

  table {
    width: 100%; border-collapse: collapse;
    margin: .9em 0; font-size: 10pt;
    page-break-inside: avoid;
  }
  th, td { border: 1px solid #ddd; padding: .4em .6em; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; }

  hr { border: none; border-top: 1px solid #e0e0e0; margin: 1.6em 0; }

  a { color: #1a1a1a; text-decoration: none; border-bottom: 1px solid #bbb; }

  /* 检查清单：保持方框可见 */
  input[type=checkbox] { margin-right: .4em; }

  /* 避免标题或表格被切在页边界 */
  h1, h2, h3 { break-after: avoid-page; }
</style>
</head>
<body>
${body}
</body>
</html>`;

writeFileSync(OUT_HTML, html, 'utf8');

const tmpHtml = join(tmpdir(), 'blog-rules-' + Date.now() + '.html');
writeFileSync(tmpHtml, html, 'utf8');

console.log('\n导出中 …');
execFileSync(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    '--print-to-pdf=' + OUT_PDF,
    'file:///' + tmpHtml.replace(/\\/g, '/'),
  ],
  { stdio: 'ignore' }
);

console.log('  ✓ HTML : ' + OUT_HTML.replace(ROOT + '\\', ''));
console.log('  ✓ PDF  : ' + OUT_PDF.replace(ROOT + '\\', ''));
console.log('');
console.log('  校验内容：node scripts/verify-pdf.mjs "' + OUT_PDF + '"');
console.log('');
