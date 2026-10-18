// 自动录制演示视频：Playwright 驱动线上产品走完主链路，字幕直接叠在页面上，ffmpeg 转为 mp4。
// 用法：npm run video [-- <站点地址>]   默认录线上 GitHub Pages
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, type Page } from 'playwright';

const BASE = process.argv[2] ?? 'https://yuyang16z.github.io/invest-agent-governance/';
const RAW = path.resolve('video/raw');
const OUT = path.resolve('video/demo.mp4');
fs.rmSync(RAW, { recursive: true, force: true });
fs.mkdirSync(RAW, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function caption(page: Page, text: string, big = false) {
  await page.evaluate(
    ([t, b]) => {
      let el = document.getElementById('__cap');
      if (!el) {
        el = document.createElement('div');
        el.id = '__cap';
        document.body.appendChild(el);
      }
      Object.assign(el.style, {
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '99999',
        textAlign: 'center',
        color: '#fff',
        background: 'rgba(17,24,39,.88)',
        borderRadius: '12px',
        boxShadow: '0 6px 24px rgba(0,0,0,.25)',
        lineHeight: '1.55',
        fontFamily: '-apple-system, "PingFang SC", sans-serif',
        ...(b
          ? { top: '34%', bottom: 'auto', maxWidth: '1000px', padding: '28px 40px', fontSize: '30px', fontWeight: '700' }
          : { top: 'auto', bottom: '26px', maxWidth: '1180px', padding: '12px 22px', fontSize: '21px', fontWeight: '600' }),
      });
      el.innerHTML = String(t);
      el.style.display = t ? 'block' : 'none';
    },
    [text, big] as const,
  );
}

async function go(page: Page, hash: string) {
  await caption(page, '');
  await page.goto(`${BASE}#${hash}`);
  await page.waitForSelector('main .page', { timeout: 60000 });
  await page.evaluate(() => window.scrollTo(0, 0)); // 单页应用切换路由会保留滚动位置，统一回到顶部
  await sleep(600);
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: RAW, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  const t0 = Date.now();
  const mark = (s: string) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);

  await page.goto(BASE);
  await page.waitForSelector('.metrics');
  await caption(page, '投资 Agent 回答质量治理平台<br/><span style="font-size:22px;font-weight:500">帮你发现 AI 投资助手哪里答错了、为什么错、改完有没有变好</span>', true);
  await sleep(5000);
  mark('title');

  await caption(page, '这是总览页。最上面四张卡片，是这次评测得出的四个主要结论。');
  await sleep(5500);
  await caption(page, '右边是“发布闸门”：新版本能不能上线，由它按规则自动判断。');
  await sleep(5000);
  await page.locator('section:has-text("评测链路与分工")').scrollIntoViewIfNeeded();
  await sleep(400);
  await caption(page, '这一排是检查流程：机器先自动查，查不准的交给人工，用户反馈帮我们找漏掉的问题。');
  await sleep(6500);
  await page.locator('section:has-text("版本演进")').scrollIntoViewIfNeeded();
  await sleep(400);
  const box = await page.locator('.chart svg').boundingBox();
  if (box) await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await caption(page, '这张图是每个版本的成绩变化，鼠标放上去能看到具体数字。');
  await sleep(5000);
  mark('overview');

  await go(page, '/cases/V1-QT01-U03');
  await caption(page, '点开一条有问题的回答。用户问茅台现在多少钱，AI 回答 1263 元。');
  await sleep(6000);
  await caption(page, '平台拿真实行情一对：1263 元其实是一周前的价格，最新是 1329 元，所以判它“数据过时”。');
  await sleep(6500);
  await page.locator('section:has-text("数字声明与数据核验")').scrollIntoViewIfNeeded();
  await sleep(400);
  await caption(page, '回答里的每个数字都会这样逐个核对，对的、错的、过时的都标出来。');
  await sleep(5500);
  mark('case stale');

  await go(page, '/cases/V3-AD07-U04');
  await caption(page, '这条的问题更隐蔽：AI 话没说完就被截断了，最后那句风险提示也跟着没了。');
  await sleep(7000);
  mark('case trunc');

  await go(page, '/compare?a=V3&b=V6');
  await caption(page, '怎么改？这是版本对比页。新版本 V6 只改了一处：允许 AI 把回答写完整。');
  await sleep(6500);
  await caption(page, '改完以后，合格的回答从 18 条涨到 28 条，闸门显示“通过”，可以上线。');
  await sleep(6000);
  mark('compare v6');

  await go(page, '/compare?a=V3&b=V4');
  await caption(page, '再看另一个候选版本 V4：换了更强的模型，成绩也提高了，但被闸门拦了下来。');
  await sleep(6000);
  await caption(page, '原因是它对不同用户说法不一样：有的用户拿到了风险提示，有的没有。');
  await sleep(5500);
  mark('compare v4');

  await go(page, '/invariance');
  await caption(page, '这是“画像一致性”页：同一个问题，让保守型、新手、专业投资者分别来问。');
  await sleep(6000);
  await page.locator('section:has-text("G-FD01")').scrollIntoViewIfNeeded();
  await sleep(400);
  await caption(page, '收益、回撤这些事实对谁都必须一样；这里保守型用户少了风险提示，就被标红了。');
  await sleep(6500);
  await page.locator('section:has-text("不能因用户画像而改变的事实")').scrollIntoViewIfNeeded();
  await sleep(400);
  await caption(page, '这张表列出了不能因为用户不同而改变的事实，比如价格、业绩、产品风险等级。');
  await sleep(6000);
  mark('invariance');

  await go(page, '/review?version=V4&open=V4-FD01-U01');
  await caption(page, '这是人工复核页。只有机器拿不准、或者风险高的回答，才会进这个队列。');
  await sleep(5500);
  await page.locator('input[name="personalization"]').nth(0).check();
  await page.locator('input[name="compliance"]').nth(0).check();
  await page.locator('textarea').fill('确认：保守型用户的回答缺少风险提示。');
  await sleep(400);
  await page.getByRole('button', { name: '保存复核' }).click();
  await caption(page, '复核员逐项点“同意”或“改判”，保存后可以导出，用来改进自动检查。');
  await sleep(5000);
  mark('review');

  await go(page, '/sandbox');
  await caption(page, '这是在线评测：随便粘贴一段 AI 的回答，马上就能检查。');
  await sleep(4500);
  await caption(page, '比如这段说“必涨、稳赚不赔”，平台直接把这些违规的话标出来。');
  await page.getByRole('button', { name: '合规越界 + 适当性' }).click();
  await page.getByRole('button', { name: '运行评测' }).click();
  await sleep(5500);
  await caption(page, '如果说的是“不保证收益”，平台分得清这是在提醒风险，不会误报。');
  await page.getByRole('button', { name: '否定语境（不应误报）' }).click();
  await page.getByRole('button', { name: '运行评测' }).click();
  await sleep(5500);
  await caption(page, '要是查行情的接口出了故障，平台会标“无法核验”交给人工，而不是假装没问题。');
  await page.getByRole('button', { name: '接口异常（模拟行情超时）' }).click();
  await page.getByRole('button', { name: '运行评测' }).click();
  await sleep(6000);
  mark('sandbox');

  await go(page, '/standards');
  await caption(page, '最后是质量标准页：写清楚每类问题怎么算合格、由谁来检查。');
  await sleep(5000);
  await page.locator('section:has-text("数据来源与接口记录")').scrollIntoViewIfNeeded();
  await sleep(400);
  await caption(page, '这里还记录了数据从哪来、哪次调用出了问题，出了错能一路查回去。');
  await sleep(5500);
  mark('standards');

  await go(page, '/');
  await caption(page, '在线体验：yuyang16z.github.io/invest-agent-governance<br/><span style="font-size:22px;font-weight:500">代码与文档：github.com/Yuyang16Z/invest-agent-governance</span>', true);
  await sleep(4500);
  mark('end');

  const video = page.video();
  await context.close();
  await browser.close();
  const src = await video!.path();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'veryfast', '-movflags', '+faststart', OUT]);
  console.log(`saved ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
