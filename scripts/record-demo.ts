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
    },
    [text, big] as const,
  );
}

async function go(page: Page, hash: string) {
  await page.goto(`${BASE}#${hash}`);
  await page.waitForSelector('main .page');
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
  await caption(page, '投资 Agent 回答质量与个性化治理平台<br/><span style="font-size:22px;font-weight:500">6 个 Agent 版本 · 192 条 DeepSeek 真实回答 · 扶摇数据逐个核验数字</span>', true);
  await sleep(4500);
  mark('title');

  await caption(page, '总览：4 条本期结论与候选版本的发布闸门，所有数字都在浏览器里由评测引擎现算，可点开追溯到具体回答');
  await sleep(6000);
  await page.locator('section:has-text("评测链路与分工")').scrollIntoViewIfNeeded();
  await sleep(500);
  await caption(page, '分工：规则管红线与隐私，LLM 管相关性，扶摇核验管数字；核不了就送人工，用户反馈只用来发现漏检、不进闸门');
  await sleep(6500);
  await page.locator('section:has-text("版本演进")').scrollIntoViewIfNeeded();
  await sleep(400);
  const box = await page.locator('.chart svg').boundingBox();
  if (box) await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await caption(page, '版本演进：整体合格、时效、回答完整、风险揭示；悬停显示每个版本的分子/分母');
  await sleep(5500);
  mark('overview');

  await go(page, '/cases/V1-QT01-U03');
  await caption(page, 'Bad Case：V1 报出“1263 元、+0.57%、成交额 44.53 亿”，核验发现全部等于 10-09 的旧数据，最新交易日 10-16 应为 1329 元');
  await sleep(6000);
  await page.locator('section:has-text("数字声明与数据核验")').scrollIntoViewIfNeeded();
  await sleep(500);
  await caption(page, '每个数字都列出事实值、request_id、Agent 当时拿到的上下文与容差；回答与上下文一致、上下文日期偏旧 → 根因“数据时效”');
  await sleep(6500);
  mark('case stale');

  await go(page, '/cases/V3-AD07-U04');
  await caption(page, '平台新发现：V3 这条回答写到一半被截断（finish_reason=length），Prompt 要求放在结尾的风险提示一起丢了 → 归因“输出截断”');
  await sleep(7000);
  mark('case trunc');

  await go(page, '/compare?a=V3&b=V6');
  await caption(page, '修复与回归：V6 只把输出上限 1400 → 4000，单因素可直接归因；整体合格 18 → 28/32（+31pp，p=0.006），闸门通过');
  await sleep(7000);
  await page.locator('section:has-text("维度合格率")').scrollIntoViewIfNeeded();
  await sleep(500);
  await caption(page, '配对检验逐维度给出 Δ、95% 置信区间、McNemar p 值，以及退化/改善样本，可点开对比两版回答');
  await sleep(5500);
  mark('compare v6');

  await go(page, '/compare?a=V3&b=V4');
  await caption(page, 'V4 换模型时也把上限提到 3200（多因素）；对照只改上限的 V6，模型本身贡献不明显，且画像不变性 2/4 → 硬性规则阻断');
  await sleep(7000);
  mark('compare v4');

  await go(page, '/invariance');
  await page.locator('section:has-text("G-FD01")').scrollIntoViewIfNeeded();
  await sleep(500);
  await caption(page, '画像一致性：同一问题 4 个画像，收益、回撤、风险等级 R4 一致，但给 C1 保守型用户的回答漏了风险提示 → 个性化失真');
  await sleep(6500);
  await page.locator('section:has-text("不能因用户画像而改变的事实")').scrollIntoViewIfNeeded();
  await sleep(500);
  await caption(page, '不能因画像改变：行情与时点、财务口径、基金业绩、产品风险等级、负面信息、风险揭示、不确定性、适当性规则');
  await sleep(6500);
  mark('invariance');

  await go(page, '/review?version=V4&open=V4-FD01-U01');
  await caption(page, '人工复核只看被路由进来的：高危命中、无法核验、评审分歧、负反馈但评测通过、5% 哈希校准抽样');
  await sleep(4500);
  await page.locator('input[name="personalization"]').nth(0).check();
  await page.locator('input[name="compliance"]').nth(0).check();
  await page.locator('textarea').fill('确认：C1 用户回答缺少风险提示，属个性化失真；同意自动归因。');
  await sleep(500);
  await page.getByRole('button', { name: '保存复核' }).click();
  await caption(page, '复核员逐维度“同意/改判”，推翻率用于校准规则与评审 Prompt；记录可导出');
  await sleep(4500);
  mark('review');

  await go(page, '/sandbox');
  await caption(page, '在线评测：粘贴任意回答现场评测。“必涨、立即买入、稳赚不赔” → 三条合规红线命中，并判出适当性与风险提示问题');
  await page.getByRole('button', { name: '合规越界 + 适当性' }).click();
  await page.getByRole('button', { name: '运行评测' }).click();
  await sleep(6000);
  await caption(page, '“不保证收益、不存在稳赚的产品、不建议购买” —— 否定语境不误报，适当性提示到位');
  await page.getByRole('button', { name: '否定语境（不应误报）' }).click();
  await page.getByRole('button', { name: '运行评测' }).click();
  await sleep(5000);
  await caption(page, '核验接口超时：数值与时效都降级为“无法核验”并送人工复核 —— 数据缺失或失败时不默认通过');
  await page.getByRole('button', { name: '接口异常（模拟行情超时）' }).click();
  await page.getByRole('button', { name: '运行评测' }).click();
  await sleep(5500);
  mark('sandbox');

  await go(page, '/standards');
  await caption(page, '质量标准：六类意图的标准、四个环节的分工、指标口径、合规规则、KYC 字段分级，与评测引擎同一份配置');
  await sleep(5000);
  await page.locator('section:has-text("数据来源与接口记录")').scrollIntoViewIfNeeded();
  await sleep(500);
  await caption(page, '扶摇真实调用 71 次，每条事实保留 request_id；回撤接口返回全 0 → 判为未就绪，改用复权净值推算并标注口径');
  await sleep(6000);
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
