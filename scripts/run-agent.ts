// 被测投资 Agent：路由（LLM）→ 实体解析 → 按数据版本取数 → 注入热点与 KYC → 生成回答（LLM），全程记录 trace。
// 用法：npm run run:agent -- V1 V2 ...（不传则跑全部版本；已生成的回答会跳过，可断点续跑）
import fs from 'node:fs';
import path from 'node:path';
import type { AgentVersion, AnswerLog, ContextDatum, Entity, Fact, HotItem, KycProfile, MetricId, ToolCall, Trace } from '../src/core/types';
import { FactIndex } from '../src/core/verify';
import { METRIC_BY_ID } from '../src/core/standards';
import { buildKycPayload, maskPii } from '../src/core/privacy';
import { aliasIndex } from '../src/core/claims';
import { PERSONAS } from '../src/seed/personas';
import { ITEMS } from '../src/seed/questions';
import { FUND_MASTER } from '../src/seed/universe';
import { PROMPT_TEXT, ROUTER_PROMPT, VERSIONS } from '../src/seed/versions';
import { chat, pool } from './llm';

const facts: Fact[] = JSON.parse(fs.readFileSync('data/facts/facts.json', 'utf8'));
const entities: Entity[] = JSON.parse(fs.readFileSync('data/facts/entities.json', 'utf8'));
const news: Record<string, { title: string; published_at: string; source: string }[]> = JSON.parse(fs.readFileSync('data/facts/news.json', 'utf8'));
const hot: { latest: HotItem[]; stale: HotItem[] } = JSON.parse(fs.readFileSync('data/facts/hot.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync('data/facts/meta.json', 'utf8'));
const idx = new FactIndex(facts);
const T: string = meta.latest_trading_day;
const T5: string = meta.t5_trading_day;
const EVAL_DATE: string = meta.eval_date;
const aliases = aliasIndex(entities);
const byCode = new Map(entities.map((e) => [e.thscode, e]));
const personas = new Map<string, KycProfile>(PERSONAS.map((p) => [p.persona_id, p]));

const QUOTE_METRICS: MetricId[] = ['price', 'change_pct', 'change', 'open', 'high', 'low', 'prev_close', 'turnover', 'pe_ttm', 'pb_mrq', 'return_5d'];
const REPORT_METRICS: MetricId[] = ['revenue', 'parent_net_profit', 'net_profit', 'revenue_yoy', 'net_profit_yoy', 'gross_margin', 'roe', 'eps'];
const FUND_METRICS: MetricId[] = ['fund_return_1m', 'fund_return_3m', 'fund_return_6m', 'fund_return_1y', 'fund_return_ytd', 'fund_return_inception', 'fund_mdd_1y', 'fund_mdd_ytd', 'fund_scale', 'fund_manager', 'risk_level'];

function datum(f: Fact): ContextDatum {
  return { fact_key: f.key, entity: f.entity, metric: f.metric, period: f.period, value: f.value, unit: f.unit, as_of: f.as_of };
}

/** 按数据版本取数：D2 取最新；D1 模拟“行情缓存 TTL 失效”，价格类取 T-5，财务取上一报告期 */
function fetchData(code: string, intent: string, dv: 'D1' | 'D2'): { calls: ToolCall[]; data: ContextDatum[] } {
  const e = byCode.get(code);
  const calls: ToolCall[] = [];
  const data: ContextDatum[] = [];
  if (!e) return { calls, data };
  if (e.type === 'stock') {
    const wantQuote = intent !== 'fundamental';
    const wantReport = intent === 'fundamental' || intent === 'advice';
    if (wantQuote) {
      const d = dv === 'D1' ? T5 : T;
      const rows = QUOTE_METRICS.map((m) => idx.at(code, m, d)).filter((f): f is Fact => Boolean(f));
      rows.forEach((f) => data.push(datum(f)));
      calls.push({ tool: 'get_a_share_prices_snapshot + valuations', params: { thscode: code, as_of: d }, data_version: dv, status: rows.length ? 'ok' : 'empty', fact_keys: rows.map((f) => f.key), as_of: d });
    }
    if (wantReport) {
      const periods = [...new Set(idx.series(code, 'revenue').filter((f) => !f.period.endsWith('S')).map((f) => f.period))];
      const p = dv === 'D1' ? periods[1] : periods[0];
      const rows = REPORT_METRICS.map((m) => (p ? idx.at(code, m, p) : undefined)).filter((f): f is Fact => Boolean(f));
      rows.forEach((f) => data.push(datum(f)));
      calls.push({ tool: 'get_a_share_financials_income_statements + indicators', params: { thscode: code, report: p ?? '-' }, data_version: dv, status: rows.length ? 'ok' : 'empty', fact_keys: rows.map((f) => f.key), as_of: p });
    }
  } else {
    const navs = idx.series(code, 'nav');
    const nav = dv === 'D1' ? navs.find((f) => f.period <= T5) : navs[0];
    const rows = [nav, ...FUND_METRICS.map((m) => idx.latest(code, m))].filter((f): f is Fact => Boolean(f));
    rows.forEach((f) => data.push(datum(f)));
    calls.push({ tool: 'get_fund_profile_detail + performance_nav/returns/drawdowns', params: { thscode: code }, data_version: dv, status: rows.length ? 'ok' : 'empty', fact_keys: rows.map((f) => f.key), as_of: nav?.as_of });
  }
  return { calls, data };
}

function fmt(d: ContextDatum): string {
  const name = byCode.get(d.entity)?.name ?? d.entity;
  const label = METRIC_BY_ID[d.metric]?.label ?? d.metric;
  let v: string;
  const n = typeof d.value === 'number' ? d.value : NaN;
  if (typeof d.value === 'string') v = d.value;
  else if (d.unit === 'pct') v = `${n.toFixed(2)}%`;
  else if (d.unit === 'x') v = `${n.toFixed(2)} 倍`;
  else if (d.unit === 'CNY' && Math.abs(n) >= 1e8) v = `${(n / 1e8).toFixed(2)} 亿元`;
  else if (d.unit === 'shares' && Math.abs(n) >= 1e4) v = `${(n / 1e4).toFixed(2)} 万股`;
  else if (d.unit === 'CNY_per_share') v = `${n.toFixed(4)} 元/股`;
  else v = `${Number(n.toFixed(4))} 元`;
  const when = /^\d{4}-Q\dS?$/.test(d.period) ? `报告期 ${d.period.replace(/-Q(\d)S$/, '年第$1季度（单季）').replace(/-Q1$/, '年一季报').replace(/-Q2$/, '年中报（上半年累计）').replace(/-Q3$/, '年三季报（前三季度累计）').replace(/-Q4$/, '年年报')}` : `数据日期 ${d.as_of}`;
  return `- ${name}(${d.entity}) | ${label} | ${v} | ${when}`;
}

function resolve(mentions: string[]): { mention: string; thscode: string | null }[] {
  return mentions.map((m) => {
    const hit = aliases.find((a) => m.includes(a.alias) || a.alias.includes(m));
    return { mention: m, thscode: hit?.thscode ?? null };
  });
}

const routerCache = new Map<string, Promise<Trace['router']>>();
function route(question: string): Promise<Trace['router']> {
  if (!routerCache.has(question)) {
    routerCache.set(
      question,
      (async () => {
        const r = await chat({ model: 'deepseek-flash', system: ROUTER_PROMPT, user: question, temperature: 0, json: true, maxTokens: 300 });
        if (r.error) return { model: 'deepseek-flash', output: null, latency_ms: r.latency_ms, error: r.error };
        try {
          const o = JSON.parse(r.content);
          return { model: 'deepseek-flash', output: { intent: o.intent, entities: o.entities ?? [], metrics: o.metrics ?? [], period: o.period ?? null }, latency_ms: r.latency_ms };
        } catch {
          return { model: 'deepseek-flash', output: null, latency_ms: r.latency_ms, error: `路由输出非 JSON：${r.content.slice(0, 80)}` };
        }
      })(),
    );
  }
  return routerCache.get(question)!;
}

async function runOne(v: AgentVersion, item: (typeof ITEMS)[number]): Promise<AnswerLog> {
  const persona = personas.get(item.persona_id)!;
  const c = v.components;
  const questionPassed = c.kyc === 'K1' ? item.question : maskPii(item.question);
  const router = await route(questionPassed);
  const intent = (router.output?.intent as string) ?? 'advice';
  const resolved = resolve(router.output?.entities ?? []);
  const codes = new Set(resolved.map((r) => r.thscode).filter((x): x is string => Boolean(x)));
  if (intent === 'advice') persona.holdings.forEach((h) => codes.add(h.thscode));

  const calls: ToolCall[] = [];
  const data: ContextDatum[] = [];
  for (const code of codes) {
    const r = fetchData(code, intent, c.data);
    calls.push(...r.calls);
    data.push(...r.data);
  }
  if (intent === 'advice') {
    // 产品货架：适当性主数据 + 近一年收益，供 Agent 在等级范围内选择
    for (const f of FUND_MASTER) {
      for (const m of ['risk_level', 'fund_return_1y'] as MetricId[]) {
        const x = idx.latest(f.thscode, m);
        if (x && !data.some((d) => d.fact_key === x.key)) data.push(datum(x));
      }
    }
    calls.push({ tool: 'product_shelf(master_data)', params: {}, data_version: c.data, status: 'ok', fact_keys: [] });
  }

  const hotPool = c.data === 'D1' ? hot.stale : hot.latest;
  const hotItems = c.hot === 'H1' ? hotPool.slice(0, 8) : intent === 'hot' ? hotPool.slice(0, 10) : hotPool.filter((h) => h.thscode && codes.has(h.thscode));
  const newsItems =
    intent === 'news' || intent === 'hot' || intent === 'advice'
      ? [...codes].flatMap((code) => (news[code] ?? []).filter((n) => (c.data === 'D1' ? n.published_at.slice(0, 10) <= T5 : true)).slice(0, 6).map((n) => ({ ...n, title: `${byCode.get(code)?.name ?? code}：${n.title}` })))
      : [];
  if (intent === 'news' || intent === 'hot') calls.push({ tool: 'get_news_stock_timeline_list', params: { thscodes: [...codes].join(',') }, data_version: c.data, status: newsItems.length ? 'ok' : 'empty', fact_keys: [] });

  const kycPayload = buildKycPayload(persona, c.kyc, EVAL_DATE);
  const user = [
    `【用户信息】\n${Object.entries(kycPayload).map(([k, val]) => `${k}：${Array.isArray(val) ? val.join('；') || '无' : val}`).join('\n')}`,
    `【数据】（来源：同花顺金融数据 API）\n${data.length ? data.map(fmt).join('\n') : '（未取到相关数据）'}`,
    `【热点】\n${hotItems.length ? hotItems.map((h) => `- ${h.published_at} ${h.title}`).join('\n') : '（无）'}`,
    newsItems.length ? `【资讯】\n${newsItems.map((n) => `- ${n.published_at} ${n.title}（${n.source || '来源未注明'}）`).join('\n')}` : '',
    `【当前时间】${EVAL_DATE}（最近交易日 ${T}）`,
    `【问题】${questionPassed}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const r = await chat({ model: c.model, system: PROMPT_TEXT[c.prompt], user, temperature: 0.3, maxTokens: c.model === 'deepseek-v4-pro' ? 8000 : 2400, timeoutMs: 180000 });
  const trace: Trace = {
    router,
    resolved_entities: resolved,
    tool_calls: calls,
    context: { kyc_policy: c.kyc, kyc_payload: kycPayload, hot_policy: c.hot, hot_items: hotItems, data, news: newsItems.map((n) => ({ title: n.title, published_at: n.published_at, source: n.source })), question_passed: questionPassed },
    llm: { model: c.model, prompt_version: c.prompt, temperature: 0.3, latency_ms: r.latency_ms, usage: r.usage, finish_reason: r.finish_reason, error: r.error },
  };
  return {
    answer_id: `${v.version_id}-${item.item_id}`,
    item_id: item.item_id,
    version_id: v.version_id,
    question_id: item.question_id,
    persona_id: item.persona_id,
    question_masked: maskPii(item.question),
    answer: r.content,
    created_at: new Date().toISOString(),
    status: r.error || !r.content ? 'agent_error' : 'ok',
    error: r.error,
    trace,
  };
}

async function main() {
  const want = process.argv.slice(2);
  const versions = VERSIONS.filter((v) => !want.length || want.includes(v.version_id));
  fs.mkdirSync('data/logs', { recursive: true });
  for (const v of versions) {
    const file = path.join('data/logs', `${v.version_id}.jsonl`);
    const done = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.status === 'ok').map((l) => l.item_id) : []);
    const todo = ITEMS.filter((it) => !done.has(it.item_id));
    console.log(`${v.version_id}: ${todo.length} to run (${done.size} done)`);
    const keep = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.status === 'ok') : [];
    const res = await pool(todo, v.components.model === 'deepseek-flash' ? 8 : 6, async (it) => {
      const log = await runOne(v, it);
      process.stdout.write(log.status === 'ok' ? '.' : 'x');
      return log;
    });
    const all = [...keep, ...res].sort((a, b) => ITEMS.findIndex((i) => i.item_id === a.item_id) - ITEMS.findIndex((i) => i.item_id === b.item_id));
    fs.writeFileSync(file, all.map((l) => JSON.stringify(l)).join('\n') + '\n');
    console.log(`\n${v.version_id}: ok=${all.filter((l) => l.status === 'ok').length} err=${all.filter((l) => l.status !== 'ok').length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
