/**
 * 极简 CDP 驱动（Chrome DevTools Protocol），零依赖。
 *
 * 为什么需要它：--dump-dom 只能看首屏静态结果，无法测"点击后行为"；
 * 而 headless 模式不支持多 target，用 iframe 也不行。CDP 可以连到真实页面，
 * 在页面里执行 JS、读回结果，因此能对交互做真正的断言。
 *
 * 用法：
 *   const page = await openPage(url);
 *   const v = await page.eval('document.title');
 *   await page.close();
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export function findBrowser() {
  return BROWSERS.find((p) => existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('无法连接 Chrome 调试端口：' + url);
}

/**
 * 启动 headless 浏览器并打开一个页面。
 * @param {string} url
 * @param {{port?:number}} [opts]
 */
export async function openPage(url, opts = {}) {
  const browser = findBrowser();
  if (!browser) throw new Error('未找到 Chrome/Edge');

  const port = opts.port || 9333 + Math.floor(Math.random() * 200);
  const profile = join(tmpdir(), 'dsh-cdp-' + port + '-' + Date.now());

  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  const cleanup = () => {
    try { child.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };

  let ws;
  try {
    await getJson(`http://127.0.0.1:${port}/json/version`);
    const target = await getJson(`http://127.0.0.1:${port}/json/new?` + encodeURIComponent(url), 20).catch(
      async () => {
        // 某些版本不接受 /json/new?url，退回默认 target
        const list = await getJson(`http://127.0.0.1:${port}/json/list`);
        return list.find((t) => t.type === 'page');
      }
    );
    if (!target || !target.webSocketDebuggerUrl) throw new Error('拿不到页面调试地址');

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')), { once: true });
    });

    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params }));
        setTimeout(() => {
          if (pending.has(n)) { pending.delete(n); reject(new Error(method + ' 超时')); }
        }, 20000);
      });

    await send('Page.enable');
    await send('Runtime.enable');
    // 等待页面导航与首屏脚本执行
    await send('Page.navigate', { url });
    await sleep(3500);

    return {
      /**
       * 在页面里求值，返回 JSON 化结果。
       * 用 async IIFE 包住，这样表达式返回 Promise 时也会被正确 await，
       * 且 JSON.stringify 作用在最终值上（这一点踩过坑：直接 stringify
       * 一个 Promise 会得到 "{}"，于是"等待动画"的辅助函数形同虚设）。
       */
      async eval(expr) {
        const r = await send('Runtime.evaluate', {
          expression: `(async () => { try { return JSON.stringify(await (${expr})); } catch (e) { return JSON.stringify({__err: e.message}); } })()`,
          awaitPromise: true,
          returnByValue: true,
        });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || '页面求值异常');
        return r.result && r.result.value !== undefined ? JSON.parse(r.result.value) : null;
      },
      /** 页面内等待若干毫秒（用于等 CSS 过渡走完） */
      sleepInPage(ms) {
        return this.eval(`new Promise(r => setTimeout(() => r(true), ${Number(ms) || 0}))`);
      },
      async close() {
        try { ws.close(); } catch {}
        cleanup();
      },
    };
  } catch (e) {
    try { ws && ws.close(); } catch {}
    cleanup();
    throw e;
  }
}
