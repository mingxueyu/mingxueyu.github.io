/**
 * 生成「文章管理」快捷方式（桌面 + 开始菜单）。
 *
 * 设计变更（重要）：快捷方式**直接指向 node + scripts/launch-admin.mjs**，
 * 不再经过 .vbs。
 *
 * 为什么去掉 .vbs：它要求文件是 UTF-16LE + BOM，且 WshShell.Run 以隐藏窗口
 * 方式拉起 .cmd 的整条链路表现不稳定 —— 实测出现过"服务其实起来了，但双击
 * 没有任何可见反馈"，非常难排查。少一层中间件就少一类故障。
 *
 * 代价：会出现一个极短的控制台窗口（node 启动瞬间）。服务本身以
 * detached + windowsHide 运行，不会留下常驻窗口。
 *
 * 用法：npm run shortcut               创建/更新
 *       npm run shortcut -- --remove   删除
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REMOVE = process.argv.includes('--remove');

const nodeExe = process.execPath; // 当前跑 npm 的这个 node，最可靠
const launcher = join(ROOT, 'scripts', 'launch-admin.mjs');

if (!existsSync(launcher)) {
  console.error('✗ 找不到 ' + launcher);
  process.exit(1);
}

const userProfile = process.env.USERPROFILE || '';
const appData = process.env.APPDATA || '';

/** [快捷方式路径, 目标, 参数, 窗口样式(1=正常 7=最小化), 说明] */
// 窗口样式刻意用 1（正常）而不是 7（最小化）：
// 最小化窗口会让启动信息一闪而过，用户既看不到状态也看不到访问地址，
// 出问题时报不出任何线索。宁可留一个可读的小窗口。
const links = [
  [join(userProfile, 'Desktop', '文章管理.lnk'), nodeExe, `"${launcher}"`, 1, 'my-blog article manager'],
  [
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', '文章管理.lnk'),
    nodeExe,
    `"${launcher}"`,
    1,
    'my-blog article manager',
  ],
];

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const ps = REMOVE
  ? links
      .map(([p]) => `if (Test-Path -LiteralPath ${q(p)}) { Remove-Item -LiteralPath ${q(p)} -Force }`)
      .join('\n')
  : [
      '$ws = New-Object -ComObject WScript.Shell',
      ...links.map(([p, target, args, style, desc]) => {
        const dir = dirname(p);
        return [
          `$dir = ${q(dir)}`,
          'if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
          `$s = $ws.CreateShortcut(${q(p)})`,
          `$s.TargetPath = ${q(target)}`,
          `$s.Arguments = ${q(args)}`,
          `$s.WorkingDirectory = ${q(ROOT)}`,
          `$s.Description = ${q(desc)}`,
          `$s.WindowStyle = ${style}`,
          `$s.IconLocation = '%SystemRoot%\\System32\\shell32.dll,70'`,
          '$s.Save()',
        ].join('\n');
      }),
    ].join('\n');

try {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(ps, 'utf16le').toString('base64'),
    ],
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
  for (const [p] of links) {
    const exists = existsSync(p);
    if (exists) ok++;
    console.log('   ' + (exists ? '✓' : '✗') + ' ' + p);
  }
  if (!ok) {
    console.error('\n没有创建成功。');
    process.exit(1);
  }
  console.log('\n  目标 : ' + nodeExe);
  console.log('  参数 : "' + launcher + '"');
  console.log('  目录 : ' + ROOT);
  console.log('\n  双击桌面「文章管理」→ 启动服务并自动打开浏览器。');
  console.log('  停止服务：双击项目里的 停止文章管理.cmd');
}
console.log('');
