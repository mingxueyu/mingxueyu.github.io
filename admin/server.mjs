/**
 * my-blog 本地可视化管理界面 —— 零运行时依赖（只用 node: 内置模块）。
 *
 *   npm run admin            # http://127.0.0.1:4322
 *   npm run admin -- --port 4400
 *
 * 设计取舍：
 * - 文章直接读写 src/content/blog/（与 Astro content collection 同一事实来源），
 *   不经过 posts/ 中转，避免两处状态不一致。
 * - Windows 上 npm 是 .ps1/.cmd，不能直接 spawn；这里显式解析 npm.cmd。
 * - git 推送时清空 http.proxy：本机配的 V2Ray 代理(127.0.0.1:10808)未运行时
 *   会导致 "Connection was reset"（见 CLAUDE-交接记录.md 第五节）。
 * - 服务只监听 127.0.0.1，并且校验 Origin，避免浏览器里的其它页面调用本接口。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROOT,
  listPosts,
  listTaxonomy,
  readPost,
  savePost,
  deletePost,
  listTrash,
  today,
  HttpError,
} from './lib/store.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(HERE, 'public');
const HOST = '127.0.0.1';

// ---------------------------------------------------------------- 参数
const argv = process.argv.slice(2);
const portArg = argv.indexOf('--port');
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : Number(process.env.ADMIN_PORT || 4322);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('端口无效。用法：npm run admin -- --port 4322');
  process.exit(1);
}

// ------------------------------------------------- 可执行文件解析（跨平台）
const isWin = process.platform === 'win32';
const nodeDir = resolve(process.execPath, '..');

/**
 * 解析 npm 的调用方式。
 *
 * 注意：Windows 上 npm 是 npm.cmd / npm.ps1。Node 24 加固后，直接 spawn
 * npm.cmd 会抛 `spawn EINVAL`（即使用 shell:true 也不稳）。最可靠的做法是
 * 绕过 shim，用当前 node 直接执行 npm 的 JS 入口 npm-cli.js。
 *
 * @returns {{cmd:string, baseArgs:string[]}}
 */
function npmCommand() {
  if (isWin) {
    const cli = join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (existsSync(cli)) return { cmd: process.execPath, baseArgs: [cli] };
    // 兜底：非标准安装布局时退回 npm.cmd（需要 shell）
    return { cmd: 'npm.cmd', baseArgs: [], shell: true };
  }
  return { cmd: 'npm', baseArgs: [] };
}

const NPM = npmCommand();

/** 拼出 npm 子命令的 spawn 参数 */
function npmArgs(sub, extra = []) {
  return [...NPM.baseArgs, sub, ...extra];
}

function vendorDir() {
  return join(ROOT, 'node_modules', 'vditor', 'dist');
}

// ---------------------------------------------------------------- 工具
function sendJson(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  });
  res.end(buf);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((res, rej) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        rej(new HttpError(413, '内容太大（上限 4MB）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return res({});
      try {
        res(JSON.parse(raw));
      } catch {
        rej(new HttpError(400, '请求体不是合法 JSON'));
      }
    });
    req.on('error', rej);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** 目录内安全取文件，阻止 ../ 穿越 */
function resolveInside(baseDir, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  const full = resolve(baseDir, rel);
  if (!full.startsWith(resolve(baseDir))) return null;
  return full;
}

function serveFile(res, full, { cache = false } = {}) {
  let st;
  try {
    st = statSync(full);
  } catch {
    return false;
  }
  if (!st.isFile()) return false;
  res.writeHead(200, {
    'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': cache ? 'public, max-age=86400' : 'no-store',
  });
  createReadStream(full).pipe(res);
  return true;
}

// ------------------------------------------------------------ 命令执行
/** 顺序执行命令，逐行把输出推给订阅者；任一步失败即停止 */
function runSequence(steps, emit) {
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (i >= steps.length) return resolve({ ok: true });
      const step = steps[i++];
      emit(`\n$ ${step.label || [step.cmd, ...(step.args || [])].join(' ')}\n`);
      let child;
      try {
        child = spawn(step.cmd, step.args || [], {
          cwd: step.cwd || ROOT,
          env: { ...process.env, ...(step.env || {}) },
          windowsHide: true,
          shell: step.shell === true,
        });
      } catch (e) {
        emit(`\n✗ 无法启动命令：${e.message}\n`);
        return resolve({ ok: false, failedAt: step.label });
      }
      const onData = (buf) => emit(buf.toString('utf8'));
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', (e) => {
        emit(`\n✗ ${e.message}\n`);
        resolve({ ok: false, failedAt: step.label });
      });
      child.on('close', (code) => {
        if (code === 0) return next();
        emit(`\n✗ 失败（退出码 ${code}）：${step.label || step.cmd}\n`);
        resolve({ ok: false, failedAt: step.label, code });
      });
    };
    next();
  });
}

// 清空代理：本机 V2Ray 未运行时 git 会 Connection was reset
const NO_PROXY_GIT = ['-c', 'http.proxy=', '-c', 'https.proxy='];

/** npm 子命令 → 可直接 spawn 的步骤 */
function npmStep(label, sub, extra = []) {
  return { label, cmd: NPM.cmd, args: npmArgs(sub, extra), shell: NPM.shell === true };
}

/** 执行单条命令并收集输出，返回 {code, out} */
function runCapture(cmd, args, cwd = ROOT, shell = false) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true, shell });
    } catch (e) {
      return resolve({ code: -1, out: e.message });
    }
    child.stdout.on('data', (b) => (out += b.toString('utf8')));
    child.stderr.on('data', (b) => (out += b.toString('utf8')));
    child.on('error', (e) => resolve({ code: -1, out: e.message }));
    child.on('close', (code) => resolve({ code, out }));
  });
}

// ------------------------------------------------------------------ 发布任务
let publishing = false;
const publishLog = [];

function startPublish(message) {
  publishing = true;
  publishLog.length = 0;
  const started = Date.now();
  const emit = (s) => {
    publishLog.push(s);
    if (publishLog.length > 4000) publishLog.splice(0, 1000);
    process.stdout.write(s);
  };
  const msg = String(message || '').trim() || '更新文章';

  /**
   * @param ok    是否成功
   * @param note  追加说明
   * @param live  本次是否真的改动了线上内容（决定要不要提示刷新站点）
   */
  const finish = (ok, note, live = false) => {
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (ok) {
      const tail = live ? '。1–2 分钟后刷新 treefish.top 即可看到' : '';
      emit(`\n✅ ${note || '发布完成'}，用时 ${secs}s${tail}\n`);
    } else {
      emit(`\n❌ 发布中断：${note}（用时 ${secs}s）\n`);
    }
    publishing = false;
  };

  (async () => {
    // 1) 暂存改动，并先判断是否真的有东西要提交
    emit('\n$ git add -A\n');
    let r = await runCapture('git', ['add', '-A']);
    if (r.out.trim()) emit(r.out);
    if (r.code !== 0) return finish(false, 'git add 失败');

    const staged = await runCapture('git', [...NO_PROXY_GIT, 'diff', '--cached', '--quiet']);
    const hasChanges = staged.code !== 0; // --quiet 有差异时返回 1
    let pushedOnly = false;
    if (!hasChanges) {
      emit('  没有需要提交的改动（文章内容与上次发布一致）。\n');
      const ahead = await runCapture('git', [...NO_PROXY_GIT, 'rev-list', '--count', 'origin/main..HEAD']);
      if (Number(ahead.out.trim()) === 0) {
        return finish(true, '没有改动，且远端已是最新，无需发布（未做任何变更）', false);
      }
      emit(`  但有 ${ahead.out.trim()} 个尚未推送的提交，继续推送。\n`);
      pushedOnly = true;
    } else {
      // 2) 提交
      emit('\n$ git commit\n');
      r = await runCapture('git', ['commit', '-m', msg]);
      if (r.out.trim()) emit(r.out);
      if (r.code !== 0) return finish(false, 'git commit 失败（可能是 git 身份未配置）');
    }

    // 3) 构建
    emit('\n$ npm run build\n');
    const built = await runSequence(
      [npmStep('构建（astro + pagefind）', 'run', ['build'])],
      emit
    );
    if (!built.ok) return finish(false, '构建失败，未推送（线上仍是上一版，可放心修正后重试）');

    // 4) 推送
    emit('\n$ git push origin HEAD:main   （已清空失效代理）\n');
    const pushed = await runSequence(
      [{ label: 'git push', cmd: 'git', args: [...NO_PROXY_GIT, 'push', 'origin', 'HEAD:main'] }],
      emit
    );
    if (!pushed.ok) return finish(false, '推送失败（检查网络/代理）');

    finish(true, pushedOnly ? '已把待推送的提交推送上线' : '发布完成', true);
  })().catch((e) => finish(false, e.message));
}

// ------------------------------------------------------------ 开发服务器
let devServer = null;
function startDev() {
  if (devServer) return { already: true };
  devServer = spawn(NPM.cmd, npmArgs('run', ['dev']), {
    cwd: ROOT,
    env: process.env,
    windowsHide: true,
    shell: NPM.shell === true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  devServer.stdout.on('data', (b) => process.stdout.write('[dev] ' + b.toString('utf8')));
  devServer.stderr.on('data', (b) => process.stdout.write('[dev] ' + b.toString('utf8')));
  devServer.on('close', () => {
    devServer = null;
  });
  return { started: true, url: 'http://localhost:4321' };
}

function stopDev() {
  if (!devServer) return { already: true };
  const pid = devServer.pid;
  try {
    if (isWin) spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    else devServer.kill('SIGTERM');
  } catch {}
  devServer = null;
  return { stopped: true };
}

// ---------------------------------------------------------------- 路由
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl / 直接访问
  try {
    const u = new URL(origin);
    return u.hostname === HOST || u.hostname === 'localhost';
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const path = url.pathname;

  try {
    // ---- 静态：界面 ----
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      if (serveFile(res, join(PUBLIC_DIR, 'index.html'))) return;
    }

    // ---- 静态：Vditor（从 node_modules 本地提供，离线可用） ----
    //
    // URL 结构说明（踩过坑）：Vditor 在代码里把资源拼成
    //   "<cdn>/dist/js/lute/lute.min.js"、"<cdn>/dist/js/i18n/zh_CN.js"
    // 而我们为了拿到未被改写的 index.min.js，必须把 cdn 指到 dist 目录本身。
    // 于是真实文件位于 <dist>/js/...，但浏览器请求的是 /vendor/vditor/dist/js/...。
    // 所以这里把 "/vendor/vditor/" 之后的 "dist/" 前缀剥掉再解析文件。
    if (req.method === 'GET' && path.startsWith('/vendor/vditor/')) {
      const dir = vendorDir();
      if (!existsSync(dir)) {
        return sendJson(res, 500, {
          error: '未安装 vditor。请先运行：npm install',
        });
      }
      const rel = path.slice('/vendor/vditor/'.length).replace(/^dist\//, '');
      const full = resolveInside(dir, rel);
      if (full && serveFile(res, full, { cache: true })) return;
      res.writeHead(404).end('vendor asset not found');
      return;
    }

    // ---- 写操作校验同源 ----
    if (req.method !== 'GET' && !sameOrigin(req)) {
      return sendJson(res, 403, { error: '跨站请求被拒绝' });
    }

    // ---- API ----
    if (path === '/api/posts' && req.method === 'GET') {
      return sendJson(res, 200, {
        posts: listPosts(),
        taxonomy: listTaxonomy(),
        trash: listTrash().length,
        today: today(),
      });
    }

    if (path === '/api/post' && req.method === 'GET') {
      const slug = url.searchParams.get('slug');
      return sendJson(res, 200, readPost(slug));
    }

    if (path === '/api/post' && req.method === 'POST') {
      const body = await readBody(req);
      const result = savePost(body);
      return sendJson(res, 200, result);
    }

    if (path === '/api/post' && req.method === 'DELETE') {
      const slug = url.searchParams.get('slug');
      return sendJson(res, 200, deletePost(slug));
    }

    if (path === '/api/trash' && req.method === 'GET') {
      return sendJson(res, 200, { items: listTrash() });
    }

    if (path === '/api/publish' && req.method === 'POST') {
      if (publishing) return sendJson(res, 409, { error: '已经有一个发布任务在进行中' });
      const body = await readBody(req);
      startPublish(body.message);
      return sendJson(res, 200, { started: true });
    }

    if (path === '/api/publish' && req.method === 'GET') {
      return sendJson(res, 200, {
        publishing,
        log: publishLog.join(''),
      });
    }

    if (path === '/api/dev' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, body.action === 'stop' ? stopDev() : startDev());
    }

    if (path === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, root: ROOT, node: process.version });
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    sendJson(res, status, { error: e.message || '服务器内部错误' });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log('');
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log('  │  my-blog 文章管理                           │');
  console.log('  └─────────────────────────────────────────────┘');
  console.log(`  界面：      ${url}`);
  console.log(`  本地预览：  ${url}/api/dev（点界面上的“本地预览”）`);
  console.log(`  文章目录：  ${join('src', 'content', 'blog')}`);
  console.log('');
  console.log('  停止：Ctrl+C');
  console.log('');
});

function shutdown() {
  stopDev();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
