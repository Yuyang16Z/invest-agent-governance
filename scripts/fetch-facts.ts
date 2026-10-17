// 从扶摇（同花顺金融数据 API）抓取核验用事实快照。每条事实保留 endpoint、参数、request_id 与抓取时间。
// 用法：npm run fetch:facts   （需要 .env 中的 FUYAO_API_KEY；Key 只从环境变量读取，不写入任何输出文件）
import fs from 'node:fs';
import path from 'node:path';
import type { Entity, Fact, HotItem, MetricId, SourceRef, Unit } from '../src/core/types';
import { factKey } from '../src/core/verify';
import { FUND_MASTER, STOCK_UNIVERSE } from '../src/seed/universe';

const BASE = 'https://fuyao.aicubes.cn';
const KEY = process.env.FUYAO_API_KEY;
if (!KEY) throw new Error('缺少 FUYAO_API_KEY（写在 .env）');

const OUT = path.resolve('data/facts');
const RAW = path.resolve('data/raw');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

interface CallLog {
  endpoint: string;
  params: Record<string, string | number>;
  http: number;
  code: number | null;
  message: string;
  request_id: string | null;
  ms: number;
  fetched_at: string;
  items: number | null;
  retries: number;
}
const calls: CallLog[] = [];
const anomalies: { kind: string; detail: string; endpoint?: string; request_id?: string | null }[] = [];

async function call(endpoint: string, params: Record<string, string | number>): Promise<{ data: any; src: SourceRef } | null> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  let retries = 0;
  for (;;) {
    const t0 = Date.now();
    let http = 0;
    let j: any = null;
    try {
      const r = await fetch(`${BASE}${endpoint}${qs ? `?${qs}` : ''}`, { headers: { 'X-api-key': KEY! } });
      http = r.status;
      j = await r.json().catch(() => null);
    } catch (e) {
      j = { code: -1, message: String(e) };
    }
    const fetched_at = new Date().toISOString();
    const items = Array.isArray(j?.data?.item) ? j.data.item.length : Array.isArray(j?.data?.items) ? j.data.items.length : null;
    const log: CallLog = { endpoint, params, http, code: j?.code ?? null, message: j?.message ?? '', request_id: j?.request_id ?? null, ms: Date.now() - t0, fetched_at, items, retries };
    // 限流（HTTP 429 / code=4001）与上游超时（5002）退避重试，最多 3 次
    if ((http === 429 || j?.code === 4001 || j?.code === 5002) && retries < 3) {
      retries++;
      anomalies.push({ kind: '限流/超时重试', detail: `${endpoint} 第 ${retries} 次重试（http=${http}, code=${j?.code}）`, endpoint, request_id: j?.request_id });
      await sleep(800 * retries);
      continue;
    }
    calls.push(log);
    const tag = `${endpoint.replace(/\//g, '_')}_${Object.values(params).join('_')}`.slice(0, 120);
    fs.writeFileSync(path.join(RAW, `${tag}.json`), JSON.stringify(j, null, 1));
    if (j?.code !== 0) {
      anomalies.push({ kind: '接口返回错误', detail: `${endpoint} ${JSON.stringify(params)} → code=${j?.code} ${j?.message}`, endpoint, request_id: j?.request_id });
      return null;
    }
    await sleep(120);
    return { data: j.data, src: { provider: 'fuyao', endpoint, params, request_id: j.request_id, fetched_at } };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const facts: Fact[] = [];
function addFact(entity: string, metric: MetricId, period: string, value: number | string | null, unit: Unit, as_of: string, source: SourceRef, extra: Partial<Fact> = {}) {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return;
  const key = factKey(entity, metric, period);
  const i = facts.findIndex((f) => f.key === key);
  const f: Fact = { key, entity, metric, period, value, unit, as_of, source, ...extra };
  if (i >= 0) facts[i] = f;
  else facts.push(f);
}

const day = (ms: number) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10); // Asia/Shanghai 日期
const round = (v: number, d = 4) => Number(v.toFixed(d));

async function main() {
  const evalDate = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);

  // 交易日历：最近交易日 T 与 T-5
  const cal = await call('/api/a-share/calendar/trading-days', {});
  const days: string[] = (cal?.data.item ?? []).map((d: any) => `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`).filter((d: string) => d <= evalDate);
  const T = days.at(-1)!;
  const T5 = days.at(-6)!;
  console.log('latest trading day', T, 'T-5', T5);

  // 标的名称（用于别名表）
  const entities: Entity[] = [];
  for (const s of [...STOCK_UNIVERSE, ...FUND_MASTER]) {
    const r = await call('/api/meta/tickers/search', { q: s.thscode, limit: 3 });
    const hit = r?.data.item?.find((i: any) => i.thscode === s.thscode);
    if (!hit) anomalies.push({ kind: '标的未解析', detail: `${s.thscode} 检索无结果` });
    entities.push({ ...s, aliases: [...new Set([...(s.aliases ?? []), hit?.name].filter(Boolean))] as string[] });
  }

  const stocks = STOCK_UNIVERSE.map((s) => s.thscode);

  // 行情快照（T 日）
  const snap = await call('/api/a-share/prices/snapshot', { thscodes: stocks.join(',') });
  for (const it of snap?.data.item ?? []) {
    const src = snap!.src;
    addFact(it.thscode, 'price', T, it.last_price, 'CNY', T, src);
    addFact(it.thscode, 'change_pct', T, round(it.price_change_ratio_pct), 'pct', T, src);
    addFact(it.thscode, 'change', T, it.price_change, 'CNY', T, src);
    addFact(it.thscode, 'open', T, it.open_price, 'CNY', T, src);
    addFact(it.thscode, 'high', T, it.high_price, 'CNY', T, src);
    addFact(it.thscode, 'low', T, it.low_price, 'CNY', T, src);
    addFact(it.thscode, 'prev_close', T, it.prev_price, 'CNY', T, src);
    addFact(it.thscode, 'volume', T, it.volume, 'shares', T, src);
    addFact(it.thscode, 'turnover', T, it.turnover, 'CNY', T, src);
  }

  // 估值快照（T 日）
  const val = await call('/api/a-share/valuations/snapshot', { thscodes: stocks.join(',') });
  const peNow: Record<string, number> = {};
  const pbNow: Record<string, number> = {};
  for (const it of val?.data.item ?? []) {
    addFact(it.thscode, 'pe_ttm', T, round(it.pe_ttm, 2), 'x', T, val!.src);
    addFact(it.thscode, 'pb_mrq', T, round(it.pb_mrq, 2), 'x', T, val!.src);
    peNow[it.thscode] = it.pe_ttm;
    pbNow[it.thscode] = it.pb_mrq;
  }

  // 历史 K 线（不复权），用于近 5 日涨跌幅、T-5 旧数据、与快照交叉核对
  const start = Date.parse(`${days.at(-25)}T00:00:00+08:00`);
  const end = Date.parse(`${T}T23:59:59+08:00`);
  for (const code of stocks) {
    const k = await call('/api/a-share/prices/historical', { thscode: code, interval: '1d', start, end, adjust: 'none' });
    const bars = (k?.data.item ?? []).map((b: any) => ({ d: day(b.date_ms), c: b.close_price, v: b.volume, t: b.turnover })).sort((a: any, b: any) => (a.d < b.d ? -1 : 1));
    const byDay = new Map<string, any>(bars.map((b: any) => [b.d, b]));
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i];
      if (b.d === T) continue; // T 日以快照为准
      const prev = bars[i - 1];
      addFact(code, 'price', b.d, b.c, 'CNY', b.d, k!.src);
      addFact(code, 'change_pct', b.d, round((b.c / prev.c - 1) * 100), 'pct', b.d, { ...k!.src, provider: 'derived', note: '由相邻两日收盘价计算' });
      addFact(code, 'turnover', b.d, b.t, 'CNY', b.d, k!.src);
      addFact(code, 'volume', b.d, b.v, 'shares', b.d, k!.src);
    }
    const kT = byDay.get(T);
    const snapT = facts.find((f) => f.key === factKey(code, 'price', T));
    if (kT && snapT && Math.abs(kT.c - Number(snapT.value)) > 0.005) {
      anomalies.push({ kind: '数据冲突', detail: `${code} ${T} 快照最新价 ${snapT.value} 与 K 线收盘 ${kT.c} 不一致（以快照为准，记入复核）`, endpoint: '/api/a-share/prices/historical', request_id: k?.src.request_id });
    }
    // 近 5 日涨跌幅（T 与 T-5 两个时点）
    const idx = (d: string) => bars.findIndex((b: any) => b.d === d);
    for (const d of [T, T5]) {
      const i = idx(d);
      if (i >= 5) {
        const v = round((bars[i].c / bars[i - 5].c - 1) * 100);
        addFact(code, 'return_5d', d, v, 'pct', d, { ...k!.src, provider: 'derived', note: `(${bars[i].d} 收盘 / ${bars[i - 5].d} 收盘 - 1)` }, { derived_from: [factKey(code, 'price', bars[i].d), factKey(code, 'price', bars[i - 5].d)] });
      }
    }
    // T-5 的估值：假设 TTM 盈利不变，按价格比例推算（D1 旧缓存使用，标注为推算）
    const c5 = byDay.get(T5)?.c;
    if (c5 && peNow[code] && kT) {
      addFact(code, 'pe_ttm', T5, round((peNow[code] * c5) / kT.c, 2), 'x', T5, { provider: 'derived', note: `T 日 PE(TTM) × ${T5} 收盘 / ${T} 收盘，假设 TTM 盈利不变` });
      addFact(code, 'pb_mrq', T5, round((pbNow[code] * c5) / kT.c, 2), 'x', T5, { provider: 'derived', note: `T 日 PB(MRQ) × ${T5} 收盘 / ${T} 收盘` });
    }
  }

  // 财务：季度利润表（累计口径）+ 财务指标
  for (const code of stocks) {
    const inc = await call('/api/a-share/financials/income-statements', { thscode: code, period: 'quarterly', limit: 8 });
    const rows = (inc?.data.item ?? []).map((r: any) => ({ ...r, key: `${r.fiscal_year}-${r.fiscal_period === 'FY' ? 'Q4' : r.fiscal_period}` }));
    const byKey = new Map<string, any>(rows.map((r: any) => [r.key, r]));
    for (const r of rows) {
      const asOf = r.key;
      addFact(code, 'revenue', r.key, r.operating_income, 'CNY', asOf, inc!.src, { note: `报告期累计口径，披露日 ${day(r.report_date_ms)}` });
      addFact(code, 'net_profit', r.key, r.net_profit, 'CNY', asOf, inc!.src, { note: '累计口径，全口径净利润' });
      addFact(code, 'parent_net_profit', r.key, r.parent_holder_net_profit, 'CNY', asOf, inc!.src, { note: '累计口径，归属于母公司股东' });
      addFact(code, 'eps', r.key, r.basic_eps, 'CNY_per_share', asOf, inc!.src);
      const [y, q] = r.key.split('-');
      const ly = byKey.get(`${Number(y) - 1}-${q}`);
      if (ly) {
        if (ly.operating_income) addFact(code, 'revenue_yoy', r.key, round((r.operating_income / ly.operating_income - 1) * 100, 2), 'pct', asOf, { provider: 'derived', note: `营业收入同比：${r.key} / ${ly.key} - 1（累计口径）` }, { derived_from: [factKey(code, 'revenue', r.key), factKey(code, 'revenue', ly.key)] });
        if (ly.parent_holder_net_profit) addFact(code, 'net_profit_yoy', r.key, round((r.parent_holder_net_profit / Math.abs(ly.parent_holder_net_profit) - 1) * 100, 2), 'pct', asOf, { provider: 'derived', note: `归母净利润同比：${r.key} / ${ly.key} - 1（累计口径）` }, { derived_from: [factKey(code, 'parent_net_profit', r.key), factKey(code, 'parent_net_profit', ly.key)] });
      }
      // 单季（Qn - Qn-1），供“第二季度单季”类表述核验
      const qn = Number(q.slice(1));
      if (qn > 1) {
        const prev = byKey.get(`${y}-Q${qn - 1}`);
        if (prev) {
          addFact(code, 'revenue', `${r.key}S`, r.operating_income - prev.operating_income, 'CNY', `${r.key}S`, { provider: 'derived', note: `单季：${r.key} 累计 - ${prev.key} 累计` });
          addFact(code, 'parent_net_profit', `${r.key}S`, r.parent_holder_net_profit - prev.parent_holder_net_profit, 'CNY', `${r.key}S`, { provider: 'derived', note: `单季：${r.key} 累计 - ${prev.key} 累计` });
        }
      }
    }
    const latestTwo = rows.slice(0, 2).map((r: any) => r.key);
    for (const rk of latestTwo) {
      const report = rk.replace('-Q', '-');
      const ind = await call('/api/a-share/financials/indicators', { thscode: code, report });
      const all = (ind?.data.abilities ?? []).flatMap((a: any) => a.indicators);
      const g = (id: string) => {
        const x = all.find((i: any) => i.index_id === id)?.value;
        return x === null || x === undefined ? null : Number(x);
      };
      if (g('sale_gross_margin') !== null) addFact(code, 'gross_margin', rk, round(g('sale_gross_margin')!, 2), 'pct', rk, ind!.src);
      if (g('index_weighted_avg_roe') !== null) addFact(code, 'roe', rk, round(g('index_weighted_avg_roe')!, 2), 'pct', rk, ind!.src, { note: '加权平均净资产收益率（报告期累计，未年化）' });
      const ry = g('operating_income_yoy_growth_ratio');
      const dy = facts.find((f) => f.key === factKey(code, 'revenue_yoy', rk));
      if (ry !== null && dy && Math.abs(ry - Number(dy.value)) > 0.5) {
        anomalies.push({ kind: '口径差异', detail: `${code} ${rk} 营收同比：指标接口 ${ry.toFixed(2)}% vs 利润表推算 ${dy.value}%（以利润表推算为准）`, endpoint: '/api/a-share/financials/indicators', request_id: ind?.src.request_id });
      }
    }
  }

  // 基金：基本资料、净值序列、区间收益、最大回撤
  const navLatest: Record<string, string> = {};
  for (const f of FUND_MASTER) {
    const code = f.thscode;
    const prof = await call('/api/fund/profile/detail', { thscode: code });
    const p = prof?.data.item?.[0];
    const nav = await call('/api/fund/performance/nav', { thscode: code, range: 'month', nav_type: 'unit' });
    const navs = (nav?.data.item ?? []).map((x: any) => ({ d: day(x.nav_date), v: x.unit_nav })).sort((a: any, b: any) => (a.d < b.d ? -1 : 1));
    for (const n of navs) addFact(code, 'nav', n.d, n.v, 'CNY', n.d, nav!.src);
    const last = navs.at(-1)?.d ?? T;
    navLatest[code] = last;
    if (p) {
      if (p.fund_scale) addFact(code, 'fund_scale', 'latest', p.fund_scale, 'CNY', last, prof!.src, { note: '基金规模（接口未给出规模截止日，按最新净值日期标注）' });
      if (p.manager_name) addFact(code, 'fund_manager', 'latest', p.manager_name, 'text', last, prof!.src);
    }
    const ret = await call('/api/fund/performance/returns', { thscode: code });
    const r = ret?.data.item?.[0];
    if (ret && !ret.data.timestamp) anomalies.push({ kind: '缺少数据时点', detail: `${code} 区间收益接口 timestamp=${ret.data.timestamp}，按最新净值日期 ${last} 标注 as_of`, endpoint: '/api/fund/performance/returns', request_id: ret.src.request_id });
    const map: Record<string, string> = { '1m': 'return_month', '3m': 'return_tmonth', '6m': 'return_hyear', '1y': 'return_year', '3y': 'return_tyear', ytd: 'return_nowyear', inception: 'return_now' };
    for (const [rg, fld] of Object.entries(map)) if (r && typeof r[fld] === 'number') addFact(code, `fund_return_${rg}` as MetricId, 'latest', r[fld], 'pct', last, ret!.src);
    const dd = await call('/api/fund/performance/drawdowns', { thscode: code });
    const d = dd?.data.item?.[0];
    const dmap: Record<string, string> = { '1m': 'month', '3m': 'tmonth', '6m': 'hyear', '1y': 'year', '3y': 'tyear', ytd: 'nowyear', inception: 'now' };
    const allZero = d && Object.values(dmap).every((fld) => d[fld] === 0);
    if (allZero) {
      // 回撤接口返回全 0：判为数据未就绪，不入库为事实；改用复权净值序列推算近一年 / 今年以来最大回撤
      anomalies.push({ kind: '数据未就绪（全 0）', detail: `${code} 最大回撤接口各区间均为 0，不作为事实；改用近一年复权净值推算`, endpoint: '/api/fund/performance/drawdowns', request_id: dd?.src.request_id });
      const adj = await call('/api/fund/performance/nav', { thscode: code, range: 'year', nav_type: 'adj' });
      const series = (adj?.data.item ?? []).map((x: any) => ({ d: day(x.nav_date), v: x.adj_nav })).filter((x: any) => typeof x.v === 'number').sort((a: any, b: any) => (a.d < b.d ? -1 : 1));
      const mdd = (arr: { d: string; v: number }[]) => {
        let peak = -Infinity;
        let worst = 0;
        for (const x of arr) {
          peak = Math.max(peak, x.v);
          worst = Math.min(worst, (x.v / peak - 1) * 100);
        }
        return round(worst, 2);
      };
      if (series.length > 20) {
        const note = `由复权净值序列推算：max(1 - 净值/前高)，区间 ${series[0].d}–${series.at(-1)!.d}，共 ${series.length} 个净值日`;
        addFact(code, 'fund_mdd_1y', 'latest', mdd(series), 'pct', series.at(-1)!.d, { ...adj!.src, provider: 'derived', note });
        const ytd = series.filter((x: any) => x.d >= `${evalDate.slice(0, 4)}-01-01`);
        if (ytd.length > 5) addFact(code, 'fund_mdd_ytd', 'latest', mdd(ytd), 'pct', series.at(-1)!.d, { ...adj!.src, provider: 'derived', note: note.replace('区间', '今年以来，区间') });
      }
    } else {
      for (const [rg, fld] of Object.entries(dmap)) if (d && typeof d[fld] === 'number') addFact(code, `fund_mdd_${rg}` as MetricId, 'latest', d[fld], 'pct', last, dd!.src);
    }
    // 产品风险等级：适当性主数据（构造样例）
    addFact(code, 'risk_level', 'latest', `R${f.risk_level}`, 'R', evalDate, { provider: 'master_data', note: '演示用构造的销售机构产品风险评级' });
  }

  // 个股资讯（分时新闻）
  const news: Record<string, { title: string; published_at: string; source: string; request_id: string | null }[]> = {};
  for (const code of stocks) {
    const n = await call('/api/news/stock/timeline-list', { thscode: code, offset: 'first', size: 10 });
    news[code] = (n?.data.items ?? []).map((x: any) => ({
      title: x.title,
      published_at: x.publish_time_ms ? new Date(x.publish_time_ms + 8 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '',
      source: x.source ?? '',
      request_id: n?.src.request_id ?? null,
    }));
  }

  // 热榜：最新 + T-5 历史（D1 旧缓存用）
  const hotNow = await call('/api/a-share/special-data/hot-stock-list', { period: 'day', limit: 20 });
  const hotOld = await call('/api/a-share/special-data/hot-stock-list-history', { date: T5 });
  const toHot = (res: typeof hotNow, date: string): HotItem[] =>
    (res?.data.item ?? []).slice(0, 20).map((x: any) => ({
      kind: 'hot_stock',
      title: `热股榜第${x.rank}名：${x.name}（热度 ${x.heat}${x.rank_trend ? `，${x.rank_trend === 'up' ? '上升' : x.rank_trend === 'down' ? '下降' : '持平'}` : ''}）`,
      thscode: x.thscode,
      name: x.name,
      published_at: date,
      source: res!.src,
    }));
  const hotNowDate = hotNow?.data.timestamp ? day(hotNow.data.timestamp) : T;
  const hot = { latest: toHot(hotNow, hotNowDate), stale: toHot(hotOld, T5) };
  if (!hot.stale.length) anomalies.push({ kind: '历史热榜缺失', detail: `${T5} 历史热榜无数据，D1 热点改为空` });

  fs.writeFileSync(path.join(OUT, 'facts.json'), JSON.stringify(facts, null, 1));
  fs.writeFileSync(path.join(OUT, 'entities.json'), JSON.stringify(entities, null, 1));
  fs.writeFileSync(path.join(OUT, 'news.json'), JSON.stringify(news, null, 1));
  fs.writeFileSync(path.join(OUT, 'hot.json'), JSON.stringify(hot, null, 1));
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ eval_date: evalDate, latest_trading_day: T, t5_trading_day: T5, recent_trading_days: days.slice(-12), nav_latest: navLatest, fetched_at: new Date().toISOString() }, null, 1));
  fs.writeFileSync(path.join(OUT, 'fetch_log.json'), JSON.stringify({ calls, anomalies }, null, 1));
  console.log(`facts=${facts.length} calls=${calls.length} anomalies=${anomalies.length}`);
  for (const a of anomalies) console.log(' -', a.kind, a.detail);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
