/**
 * 一键启动管理界面的真正实现（供 启动文章管理.cmd / .vbs 调用）。
 *
 * 为什么不用批处理做等待：.cmd 里每轮探测都要起一个进程，还夹着 ping 延时，
 * 逻辑脆弱且慢。这里用 Node 自己控制：
 *   1. 端口已有服务在跑 → 直接打开浏览器（双击两次不会起两个实例）
 *   2. 否则以 detached 方式后台拉起 server.mjs（父进程退出后依然存活）
 *   3. 轮询 /api/health 直到就绪，再打开浏览器
 *
 * 用法：node scripts/launch-admin.mjs [--port 4322] [--no-open]
 */
import { spawn, execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const pi = argv.indexOf('--port');
const PORT = pi >= 0 ? Number(argv[pi + 1]) : Number(process.env.ADMIN_PORT || 4322);
const NO_OPEN = argv.includes('--no-open');
const URL = `http://127.0.0.1:${PORT}`;
const HEALTH = URL + '/api/health';

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('端口无效：' + argv[pi + 1]);
  process.exit(1);
}

async function healthy(timeoutMs = 1200) {
  try {
    const ctl = AbortSignal.timeout(timeoutMs);
    const r = await fetch(HEALTH, { signal: ctl });
    if (!r.ok) return false;
    const j = await r.json();
    return j && j.ok === true;
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (NO_OPEN) {
    console.log('  (--no-open) ' + url);
    return;
  }
  try {
    if (process.platform === 'win32') {
      // 用 rundll32 打开默认浏览器：不产生控制台窗口，也不等待
      execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true }, () => {});
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (e) {
    console.log('  无法自动打开浏览器，请手动访问：' + url);
  }
}

const server = join(ROOT, 'admin', 'server.mjs');
if (!existsSync(server)) {
  console.error('找不到 admin/server.mjs，项目结构可能被改动了。');
  process.exit(1);
}

console.log('');
console.log('  my-blog - article manager');
console.log('  ----------------------------------------');
console.log('  port : ' + PORT);

// ---- 1) 已经在跑？ ----
if (await healthy()) {
  console.log('  state: already running');
  console.log('');
  console.log('  opening ' + URL);
  openBrowser(URL);
  process.exit(0);
}

// ---- 2) 后台拉起服务 ----
console.log('  state: starting ...');
const child = spawn(process.execPath, [server, '--port', String(PORT)], {
  cwd: ROOT,
  detached: true,          // 脱离父进程，启动器退出后服务继续活着
  stdio: 'ignore',         // 不占用父进程的 stdout，避免调用方挂住
  windowsHide: true,       // 不弹控制台窗口
});
child.unref();

// ---- 3) 等就绪（最多 ~20s） ----
let ok = false;
for (let i = 0; i < 100; i++) {
  await sleep(200);
  if (await healthy()) { ok = true; break; }
  if (child.exitCode !== null && child.exitCode !== 0 && i > 5) {
    // 进程已经退出且健康检查一直失败，不必再等
    console.error('  服务启动失败（退出码 ' + child.exitCode + '）。');
    console.error('  常见原因：端口被占用、依赖未安装（npm install）。');
    process.exit(1);
  }
}

if (!ok) {
  console.error('  等待服务就绪超时，请检查：node admin/server.mjs --port ' + PORT);
  process.exit(1);
}

console.log('  state: ready');
console.log('');
console.log('  opening ' + URL);
openBrowser(URL);
console.log('');
console.log('  停止服务：双击 停止文章管理.cmd');
console.log('');
process.exit(0);
