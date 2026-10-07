#!/usr/bin/env node
/**
 * 网络恢复后把本地提交同步到 GitHub 用。
 *
 * 本机两个网络坑（详见 AGENTS.md）：
 *  1. V2Ray 代理(127.0.0.1:10808)未运行时，git 走全局代理配置会
 *     "Connection was reset"，所以这里统一清空代理。
 *  2. 直连 github.com:443 会间歇性被重置/超时，需要重试。
 *
 * 关键点：**不能用 git rev-parse origin/main 判断是否成功**。
 * 那个引用的更新时间取决于 fetch 是否成功；离线时 fetch 静默失败，
 * 该引用仍停在旧值，会误报"已同步"。所以这里用 git ls-remote 直接
 * 向远端询问当前 main 指向哪里。
 *
 * 用法：npm run sync
 */
import { execFileSync } from 'node:child_process';

const TRIES = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (args) =>
  execFileSync('git', ['-c', 'http.proxy=', '-c', 'https.proxy=', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const head = () => git(['rev-parse', 'HEAD']);

/** 直接问远端 main 的 sha；连不上会抛错 */
function remoteHead() {
  const out = git(['ls-remote', 'origin', 'refs/heads/main']);
  const line = out.split('\n').find((l) => l.trim());
  return line ? line.split(/\s+/)[0] : null;
}

console.log('\n正在同步到 GitHub…\n');

let pending = '';
try {
  pending = git(['log', '--oneline', 'origin/main..HEAD']);
} catch {
  // origin/main 不存在也没关系，下面以 ls-remote 结果为准
}
if (!pending) {
  // 本地可能没有"领先 origin/main 的提交"，但仍可能没推送成功，继续校验
  console.log('  本地没有领先 origin/main 的提交（仍会核对远端实际状态）\n');
} else {
  console.log('  待推送：');
  pending.split('\n').forEach((l) => console.log('    ' + l));
  console.log('');
}

const mine = head();

for (let i = 1; i <= TRIES; i++) {
  try {
    const remote = remoteHead();
    if (remote === mine) {
      console.log(`✅ 远端已是最新：${mine.slice(0, 7)}`);
      console.log('   GitHub Actions 会自动部署，1–2 分钟后刷新 treefish.top。\n');
      process.exit(0);
    }
    process.stdout.write(`  第 ${i}/${TRIES} 次尝试推送… `);
    git(['push', 'origin', 'HEAD:main']);
    // 推送成功后再问一次远端，确认真落地了
    const after = remoteHead();
    if (after === mine) {
      console.log('成功\n');
      console.log(`✅ 已同步：${mine.slice(0, 7)}`);
      console.log('   GitHub Actions 会自动部署，1–2 分钟后刷新 treefish.top。\n');
      process.exit(0);
    }
    console.log(`推送返回成功但远端仍是 ${String(after).slice(0, 7)}，重试`);
  } catch (e) {
    const msg = String(e.stderr || e.message || '')
      .split('\n')
      .filter(Boolean)
      .slice(-1)[0];
    console.log(`失败\n     ${msg}`);
  }
  if (i < TRIES) await sleep(6000);
}

console.log('\n❌ 仍然连不上 GitHub。');
console.log('   你的 V2Ray 代理(127.0.0.1:10808)当前没有运行；');
console.log('   如果直连不通，启动代理后重跑：npm run sync\n');
process.exit(1);
