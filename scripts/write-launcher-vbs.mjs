/**
 * 生成/修复 启动文章管理.vbs —— 必须写成 UTF-16LE + BOM。
 *
 * 背景：WSH 读取 .vbs 的编码规则很挑。存成 ANSI/UTF-8 时，脚本里的中文
 * 字面量（"启动文章管理.cmd"）会变成乱码，FileExists 返回 False，
 * 结果就是**静默什么也不做** —— 双击快捷方式毫无反应，极难排查。
 * UTF-16LE + BOM 是 WSH 唯一稳定支持非 ASCII 的编码。
 *
 * 用法：node scripts/write-launcher-vbs.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '启动文章管理.vbs');

const vbs = `' ============================================================
'  Silent launcher for the my-blog article manager.
'
'  Double-clicking this behaves like an app shortcut: no console
'  window, the server starts in the background, the browser opens
'  by itself. It simply runs the .cmd next to it, hidden.
'
'  ENCODING: must stay UTF-16LE with BOM. WSH resolves non-ASCII
'  literals reliably only in that encoding; as ANSI/UTF-8 the
'  filename below turns to garbage, FileExists returns False and
'  this script silently does nothing.
'  Regenerate with: node scripts/write-launcher-vbs.mjs
' ============================================================
Option Explicit

Dim fso, shell, here, cmdPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
cmdPath = fso.BuildPath(here, "启动文章管理.cmd")

If Not fso.FileExists(cmdPath) Then
  MsgBox "Launcher not found:" & vbCrLf & cmdPath, 16, "my-blog admin"
  WScript.Quit 1
End If

' 0 = hidden window, False = return immediately
shell.Run """" & cmdPath & """", 0, False
`;

// UTF-16LE + BOM（FF FE）；行尾统一 CRLF（WSH 的传统要求）
const normalized = vbs.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
const bom = Buffer.from([0xff, 0xfe]);
const body = Buffer.from(normalized, 'utf16le');
writeFileSync(OUT, Buffer.concat([bom, body]));

// 自检：按 UTF-16LE 解码读回，确认 BOM、中文字面量、行尾都正确
const { readFileSync } = await import('node:fs');
const back = readFileSync(OUT);
const okBom = back[0] === 0xff && back[1] === 0xfe;
const decoded = back.subarray(2).toString('utf16le');
const hasLiteral = decoded.includes('启动文章管理.cmd');
const crlf = (decoded.match(/\r\n/g) || []).length;
const bareLf = (decoded.match(/(?<!\r)\n/g) || []).length;

console.log('  BOM        : ' + (okBom ? '✓ UTF-16LE' : '✗ 缺失'));
console.log('  中文字面量 : ' + (hasLiteral ? '✓ 完好' : '✗ 损坏'));
console.log('  行尾       : CRLF=' + crlf + ' 裸LF=' + bareLf + (bareLf === 0 ? ' ✓' : ' ✗'));
console.log('  输出       : ' + OUT);

if (!okBom || !hasLiteral || bareLf !== 0) process.exit(1);
