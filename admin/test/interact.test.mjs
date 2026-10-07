/**
 * 管理界面的交互测试（CDP 驱动真实浏览器）。
 * 目前覆盖：发布日志面板能否收起 —— 曾经只有开没有关，面板会一直挡住编辑器。
 *
 * 用法：node admin/test/interact.test.mjs [baseUrl]
 * 需要本机有 Chrome/Edge；没有则跳过（不算失败）。
 */
import { openPage, findBrowser } from './cdp.mjs';

const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:4322';

if (!findBrowser()) {
  console.log('\n未找到 Chrome/Edge，跳过交互测试。\n');
  process.exit(0);
}

let pass = 0;
const fails = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push(name + (extra ? ' → ' + extra : '')); console.log(`  ✗ ${name}${extra ? ' → ' + extra : ''}`); }
};

console.log('\n界面交互测试');
console.log(`目标：${BASE}\n`);

let page;
try {
  page = await openPage(BASE + '/');

  const hasEls = await page.eval(
    `!!(document.getElementById('console') && document.getElementById('consoleHead') && document.getElementById('consoleClose'))`
  );
  check('控制台元素齐全（面板/标题栏/关闭按钮）', hasEls === true);
  if (!hasEls) throw new Error('控制台元素缺失');

  const isOpen = () => page.eval(`document.getElementById('console').classList.contains('open')`);
  const click = (id) => page.eval(`(document.getElementById('${id}').click(), true)`);

  // 1) 初始收起，不能一上来就挡住内容
  check('初始状态为收起', (await isOpen()) === false);

  // 2) 点标题栏 → 展开
  await click('consoleHead');
  check('点标题栏可展开', (await isOpen()) === true);
  const labelOpen = await page.eval(`document.getElementById('consoleClose').textContent`);
  check('展开时按钮显示"关闭"', /关闭/.test(labelOpen), JSON.stringify(labelOpen));

  // 3) 点关闭按钮 → 收起（这是本次修复的核心）
  await click('consoleClose');
  check('点"关闭"按钮可收起', (await isOpen()) === false);

  // 4) 关闭按钮的事件不能冒泡到标题栏（否则会立刻又被展开）
  await click('consoleHead');
  await click('consoleClose');
  check('关闭按钮不会因冒泡重新展开', (await isOpen()) === false);

  // 5) 标题栏再次点击 → 收起
  await click('consoleHead');
  const o1 = await isOpen();
  await click('consoleHead');
  check('标题栏可反复切换', o1 === true && (await isOpen()) === false);

  // 6) Esc 收起
  await click('consoleHead');
  await page.eval(
    `(document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})), true)`
  );
  check('按 Esc 可收起', (await isOpen()) === false);

  // 7) 收起时按钮提示应变成"展开"
  const labelClosed = await page.eval(`document.getElementById('consoleClose').textContent`);
  check('收起时按钮提示为"展开"', /展开/.test(labelClosed), JSON.stringify(labelClosed));

  // 8) 收起后不占据可视空间（用户真正关心的：不挡编辑器）
  //    注意要等 CSS 过渡（0.25s）走完再量，否则量到的是动画中间值。
  await click('consoleHead');
  await page.sleepInPage(500);
  const hOpen = await page.eval(`document.getElementById('console').getBoundingClientRect().height`);
  await click('consoleClose');
  await page.sleepInPage(500);
  const hClosed = await page.eval(`document.getElementById('console').getBoundingClientRect().height`);
  check(
    '收起后高度归零（不挡编辑器）',
    hClosed === 0 && hOpen > 0,
    `展开=${hOpen}px 收起=${hClosed}px`
  );
} catch (e) {
  check('交互测试执行成功', false, e.message);
} finally {
  if (page) await page.close();
}

console.log(`\n${'─'.repeat(52)}`);
if (fails.length) {
  console.log(`❌ ${pass} 项通过，${fails.length} 项失败：`);
  fails.forEach((f) => console.log('   · ' + f));
  process.exit(1);
}
console.log(`✅ 交互测试 ${pass} 项全部通过`);
