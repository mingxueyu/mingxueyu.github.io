/**
 * 生成"文章管理"桌面快捷方式（以及开始菜单项）。
 *
 * 双击桌面图标 = 启动服务 + 自动打开浏览器，全程无黑窗口。
 * 用 WScript.Shell COM 创建 .lnk；通过 powershell -EncodedCommand 传递
 * UTF-16LE 脚本，避免中文路径在命令行上被代码页搞坏。
 *
 * 用法：npm run shortcut              创建/更新
 *       npm run shortcut -- --remove  删除
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REMOVE = process.argv.includes('--remove');

const vbsTarget = join(ROOT, '启动文章管理.vbs'); // 无窗口启动
if (!existsSync(vbsTarget)) {
  console.error('✗ 找不到 ' + vbsTarget);
  process.exit(1);
}

const userProfile = process.env.USERPROFILE || '';
const appData = process.env.APPDATA || '';

const links = [
  join(userProfile, 'Desktop', '文章管理.lnk'),
  join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', '文章管理.lnk'),
].filter(Boolean);

const psQuote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

let ps;
if (REMOVE) {
  ps = links.map((l) => `if (Test-Path ${psQuote(l)}) { Remove-Item -LiteralPath ${psQuote(l)} -Force }`).join('\n');
} else {
  ps = [
    '$ws = New-Object -ComObject WScript.Shell',
    ...links.map((l) => {
      const dir = dirname(l);
      return [
        `$dir = ${psQuote(dir)}`,
        'if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
        `$s = $ws.CreateShortcut(${psQuote(l)})`,
        `$s.TargetPath = ${psQuote(vbsTarget)}`,
        `$s.WorkingDirectory = ${psQuote(ROOT)}`,
        `$s.Description = 'my-blog article manager'`,
        `$s.IconLocation = '%SystemRoot%\\System32\\shell32.dll,70'`,
        '$s.Save()',
      ].join('\n');
    }),
  ].join('\n');
}

// -EncodedCommand 接受 UTF-16LE 的 base64，中文路径不会被代码页破坏
const encoded = Buffer.from(ps, 'utf16le').toString('base64');

try {
  execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
} catch (e) {
  console.error('✗ 操作失败：' + (e.stderr ? e.stderr.toString() : e.message));
  process.exit(1);
}

if (REMOVE) {
  console.log('\n✓ 已删除快捷方式');
} else {
  console.log('\n✓ 快捷方式：');
  let ok = 0;
  for (const l of links) {
    const exists = existsSync(l);
    if (exists) ok++;
    console.log('   ' + (exists ? '✓' : '✗') + ' ' + l);
  }
  if (ok === 0) {
    console.error('\n没有创建成功，请检查上面的错误信息。');
    process.exit(1);
  }
  console.log('\n  双击桌面上的「文章管理」即可启动并自动打开浏览器。');
  console.log('  停止服务：双击项目里的 停止文章管理.cmd');
}
console.log('');
