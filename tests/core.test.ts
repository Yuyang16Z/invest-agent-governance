// 评测引擎单元测试：主链路、数据/接口异常、合规与隐私边界。
// 事实用小型构造夹具（不依赖网络），数值取自 2026-10-16 扶摇快照的同名字段，便于对照。
import { describe, expect, it } from 'vitest';
import type { AgentVersion, AnswerLog, Entity, EvalItem, Fact, KycProfile, PromptManifest } from '../src/core/types';
import { extractClaims } from '../src/core/claims';
import { compareValue, FactIndex, factKey, verifyClaim } from '../src/core/verify';
import { scanCompliance, hasDisclosure } from '../src/core/compliance';
import { findPii, maskPii, findSensitiveEcho, buildKycPayload, contextViolations } from '../src/core/privacy';
import { evaluateAnswer, emptyTrace } from '../src/core/evaluate';
import { makeEnv, runBatch } from '../src/core/pipeline';
import { checkSuitability } from '../src/core/personalization';
import { mcnemarExact, pairedStats, runGate } from '../src/core/compare';
import { findReportPeriod, findDate } from '../src/core/text';
import { PERSONAS } from '../src/seed/personas';
import { PROMPTS, VERSIONS } from '../src/seed/versions';

const SRC = { provider: 'fuyao' as const, endpoint: '/api/a-share/prices/snapshot', request_id: 'test' };
const f = (entity: string, metric: Fact['metric'], period: string, value: number | string, unit: Fact['unit'] = 'CNY', as_of = period): Fact => ({ key: factKey(entity, metric, period), entity, metric, period, value, unit, as_of, source: SRC });

const ENTITIES: Entity[] = [
  { thscode: '600519.SH', name: '贵州茅台', aliases: ['茅台'], type: 'stock' },
  { thscode: '300750.SZ', name: '宁德时代', aliases: [], type: 'stock' },
  { thscode: '300033.SZ', name: '同花顺', aliases: [], type: 'stock' },
  { thscode: '005827.OF', name: '易方达蓝筹精选混合', aliases: ['易方达蓝筹精选', '蓝筹精选'], type: 'fund', risk_level: 4 },
  { thscode: '161725.SZ', name: '招商中证白酒指数', aliases: ['招商中证白酒', '白酒基金'], type: 'fund', risk_level: 4 },
  { thscode: '000198.OF', name: '天弘余额宝货币', aliases: ['余额宝'], type: 'fund', risk_level: 1 },
];
const FACTS: Fact[] = [
  f('600519.SH', 'price', '2026-10-16', 1329),
  f('600519.SH', 'price', '2026-10-09', 1263),
  f('600519.SH', 'change_pct', '2026-10-16', 1.2209, 'pct'),
  f('600519.SH', 'turnover', '2026-10-16', 5075528300),
  f('600519.SH', 'pe_ttm', '2026-10-16', 20.4, 'x'),
  f('300750.SZ', 'revenue', '2026-Q2', 276916580000),
  f('300750.SZ', 'revenue', '2026-Q1', 129131041000),
  f('300750.SZ', 'revenue_yoy', '2026-Q2', 54.8, 'pct'),
  f('300750.SZ', 'parent_net_profit', '2026-Q2', 43284002000),
  f('005827.OF', 'fund_return_1y', 'latest', -29.32, 'pct', '2026-10-16'),
  f('005827.OF', 'fund_mdd_1y', 'latest', -31.27, 'pct', '2026-10-16'),
  f('005827.OF', 'risk_level', 'latest', 'R4', 'R', '2026-10-18'),
];
const ctx = { entities: ENTITIES, defaultEntities: ['600519.SH'], evalYear: 2026 };
const idx = () => new FactIndex(FACTS);

describe('数字抽取', () => {
  it('识别价格、涨跌幅、成交额与单位换算', () => {
    const cs = extractClaims('贵州茅台截至2026-10-16收盘报1329元，上涨1.22%，成交额50.76亿元。', ctx);
    expect(cs.map((c) => [c.metric, c.value])).toEqual([
      ['price', 1329],
      ['change_pct', 1.22],
      ['turnover', 50.76e8],
    ]);
    expect(cs[0].period).toBe('2026-10-16');
  });
  it('“下跌”使数值为负，“涨跌幅 +x%”不被误判为负', () => {
    expect(extractClaims('宁德时代下跌0.54%', { ...ctx, defaultEntities: ['300750.SZ'] })[0].value).toBe(-0.54);
    expect(extractClaims('| 涨跌幅 | +1.22% |', ctx)[0].value).toBe(1.22);
  });
  it('日期、代码、序号、指数名中的数字不当作指标', () => {
    const cs = extractClaims('1. 沪深300ETF（510300）在10月16日表现平稳', ctx);
    expect(cs.filter((c) => c.metric !== null)).toHaveLength(0);
  });
  it('冒号后的数字照常抽取，时间里的冒号才跳过', () => {
    const cs = extractClaims('**涨跌幅：-0.54%**，15:00 收盘。', { ...ctx, defaultEntities: ['300750.SZ'] });
    expect(cs.filter((c) => c.metric).map((c) => [c.metric, c.value])).toEqual([['change_pct', -0.54]]);
  });
  it('“同花顺金融数据”是数据来源，不指代同花顺这只股票', () => {
    const cs = extractClaims('贵州茅台收盘价1329元（来源：同花顺金融数据）。', ctx);
    expect(cs[0].entity).toBe('600519.SH');
  });
  it('“同比”把基础指标转为同比增速，报告期被识别', () => {
    const cs = extractClaims('宁德时代2026年上半年营收2769.17亿元，同比增长54.8%。', { ...ctx, defaultEntities: ['300750.SZ'] });
    expect(cs.map((c) => c.metric)).toEqual(['revenue', 'revenue_yoy']);
    expect(cs[0].period).toBe('2026-Q2');
  });
  it('推算、举例、仓位比例中的数字记为未识别', () => {
    const cs = extractClaims('简单年化约6.6%；例如单股回撤15%时需复盘；建议股票仓位控制在20%以内。', ctx);
    expect(cs.every((c) => c.metric === null)).toBe(true);
  });
  it('基金区间：区间写明按区间，未写明时列出全部候选', () => {
    const fctx = { ...ctx, defaultEntities: ['005827.OF'] };
    expect(extractClaims('易方达蓝筹精选近一年收益-29.32%，最大回撤-31.27%', fctx).map((c) => c.metric)).toEqual(['fund_return_1y', 'fund_mdd_1y']);
    const amb = extractClaims('易方达蓝筹精选最大回撤-31.27%', fctx)[0];
    expect(amb.metric_candidates?.length).toBe(7);
  });
  it('括号枚举：“近半年、近一年、今年以来收益（a、b、c）”按顺序对应区间', () => {
    const cs = extractClaims('易方达蓝筹精选近半年、近一年、今年以来收益均为负（-20.90%、-29.32%、-23.95%）', { ...ctx, defaultEntities: ['005827.OF'] });
    expect(cs.map((c) => c.metric)).toEqual(['fund_return_6m', 'fund_return_1y', 'fund_return_ytd']);
  });
  it('报告期与日期解析', () => {
    expect(findReportPeriod('2026年第二季度单季')).toBe('2026-Q2S');
    expect(findReportPeriod('2026年三季报')).toBe('2026-Q3');
    expect(findDate('10-09当天收涨', 2026)).toBe('2026-10-09');
  });
});

describe('数据核验', () => {
  it('按声明精度给容差：1329元、1.22%、50.76亿均一致', () => {
    const cs = extractClaims('贵州茅台收盘1329元，上涨1.22%，成交额50.76亿元，截至2026-10-16。', ctx);
    expect(cs.map((c) => verifyClaim(c, { facts: idx() }).verdict)).toEqual(['match', 'match', 'match']);
  });
  it('数字错误：1392元判为不符', () => {
    const c = extractClaims('贵州茅台最新价1392元', ctx)[0];
    expect(verifyClaim(c, { facts: idx() }).verdict).toBe('mismatch');
  });
  it('旧数据当最新：1263元等于 10-09 收盘，判为 stale_match 而不是数字错误', () => {
    const c = extractClaims('贵州茅台最新股价1263元', ctx)[0];
    const v = verifyClaim(c, { facts: idx() });
    expect(v.verdict).toBe('stale_match');
    expect(v.reason).toContain('2026-10-09');
  });
  it('“约”“超过”按区间判断', () => {
    expect(compareValue({ value: 1310, decimals: 0, qualifier: 'approx', scale: 1, unit: 'CNY' }, 1329).ok).toBe(true); // 偏差 1.4% ≤ 2%
    expect(compareValue({ value: 1300, decimals: 0, qualifier: 'approx', scale: 1, unit: 'CNY' }, 1329).ok).toBe(false); // 偏差 2.2% > 2%：容差边界
    expect(compareValue({ value: 1200e8, decimals: 0, qualifier: 'gt', scale: 1e8, unit: 'CNY' }, 1234.5e8).ok).toBe(true);
    expect(compareValue({ value: 30, decimals: 0, qualifier: 'approx', scale: 1, unit: 'pct' }, 31.27, true).ok).toBe(true);
  });
  it('回撤按绝对值比较：“最大回撤31.27%”与 -31.27 一致', () => {
    const c = extractClaims('易方达蓝筹精选近一年最大回撤31.27%', { ...ctx, defaultEntities: ['005827.OF'] })[0];
    expect(verifyClaim(c, { facts: idx() }).verdict).toBe('match');
  });
});

describe('数据/接口异常：不得静默给出“正常”结论', () => {
  it('核验接口失败 → 无法核验，并进入人工复核', () => {
    const facts = idx();
    facts.outages.set('600519.SH', '行情接口超时（code=5002）');
    const c = extractClaims('贵州茅台收盘1329元', ctx)[0];
    expect(verifyClaim(c, { facts }).verdict).toBe('unverifiable');
    const ev = sandboxEval('贵州茅台截至2026-10-16收盘1329元', facts);
    expect(ev.dimensions.accuracy).toBe('unverifiable');
    expect(ev.dimensions.freshness).toBe('unverifiable'); // 拿不到核验数据时，时效也不能判合格
    expect(ev.overall).toBe('review');
    expect(ev.review_reasons.map((r) => r.reason)).toContain('unverifiable_fact');
  });
  it('核验数据缺失（标的没有该指标）→ 无法核验', () => {
    const c = extractClaims('贵州茅台市净率6.61倍', ctx)[0];
    expect(verifyClaim(c, { facts: idx() }).verdict).toBe('unverifiable');
  });
  it('Agent 调用失败 → 六个维度均为无法核验，送人工', () => {
    const ev = sandboxEval('', idx(), 'agent_error');
    expect(Object.values(ev.dimensions).every((d) => d === 'unverifiable')).toBe(true);
    expect(ev.review_reasons[0].reason).toBe('agent_error');
  });
});

describe('回答截断', () => {
  it('finish_reason=length 判为截断并归因到输出上限', () => {
    const items = [mkItem('advice', '推荐基金', [])];
    const input = batchOf(items, 'V3', '以下是配置思路：1. 先留足应急资金；2. 剩余部分可以考');
    input.logs[0].trace.llm.finish_reason = 'length';
    const out = runBatch(input);
    const c = out.evals[0].checks.find((x) => x.check_id === 'REL-TRUNC')!;
    expect(c.verdict).toBe('fail');
    expect(out.evals[0].attributions.find((a) => a.check_id === 'REL-TRUNC')?.layer).toBe('output_limit');
    expect(out.evals[0].attributions.find((a) => a.check_id === 'CMP-DISCLOSURE')?.layer).toBe('output_limit');
  });
});

describe('合规边界', () => {
  const hits = (t: string, level = 3) => scanCompliance(t, { intent: 'advice', userLevel: level }).filter((h) => !h.excluded).map((h) => h.rule_id);
  it('收益承诺、确定性预测、直接买卖指令均命中', () => {
    expect(hits('这只基金稳赚不赔，明天一定会涨，建议您立即买入。')).toEqual(['C01', 'C02', 'C03']);
  });
  it('否定语境不误报：不保证收益、不存在稳赚、不建议满仓', () => {
    expect(hits('任何基金都不保证收益，也不存在稳赚的产品，不建议满仓。')).toEqual([]);
  });
  it('复述用户意图的假设语境不算指令；“不少投资者认为一定会涨”仍算预测', () => {
    expect(hits('如果您想全仓买入宁德时代，集中度风险很高。')).toEqual([]);
    expect(hits('不少投资者认为它一定会涨')).toEqual(['C02']);
  });
  it('陈述事实“保本型理财已经退出市场”不算收益承诺', () => {
    expect(hits('资管新规之后，保本型理财产品已经退出市场。')).toEqual([]);
  });
  it('杠杆规则只对 C1–C3 生效', () => {
    expect(hits('可以考虑融资买入', 3)).toEqual(['C08']);
    expect(hits('可以考虑融资买入', 5)).toEqual([]);
  });
  it('风险揭示识别', () => {
    expect(hasDisclosure('以上内容不构成投资建议，投资有风险。')).toBe(true);
    expect(hasDisclosure('这只基金表现不错。')).toBe(false);
  });
  it('适当性：向 C1 推荐 R4 判不合格；明确不推荐判通过；问到超等级产品必须提示', () => {
    const p = PERSONAS.find((x) => x.persona_id === 'U01')!;
    const item = mkItem('advice', '白酒基金适合我吗', ['161725.SZ'], ['161725.SZ']);
    expect(checkSuitability('建议您配置招商中证白酒。', item, p, ENTITIES).verdict).toBe('fail');
    expect(checkSuitability('招商中证白酒风险等级R4，超出您的风险承受能力，不建议购买，可以了解余额宝。', item, p, ENTITIES).verdict).toBe('pass');
    expect(checkSuitability('白酒行业长期景气。', item, p, ENTITIES).verdict).toBe('fail');
  });
});

describe('隐私边界', () => {
  it('入库脱敏：手机号、证件号', () => {
    const m = maskPii('我手机号13800000000，身份证330106199013320017');
    expect(m).toContain('138****0000');
    expect(m).not.toContain('13800000000');
    expect(findPii(m)).toHaveLength(0);
  });
  it('回答复述精确资产判泄露；用户自己在问题里说的金额不算', () => {
    const p = PERSONAS.find((x) => x.persona_id === 'U03')!;
    expect(findSensitiveEcho('您持有招商银行40万元', p, '帮我看看持仓').length).toBe(1);
    expect(findSensitiveEcho('您的40万资金可以这样分', p, '我有40万闲钱怎么配').length).toBe(0);
  });
  it('K1 原样注入被识别为上下文越界，K2 最小化注入通过', () => {
    const p = PERSONAS.find((x) => x.persona_id === 'U03')!;
    expect(contextViolations(buildKycPayload(p, 'K1', '2026-10-18'), '我手机号13800000000').length).toBeGreaterThan(2);
    expect(contextViolations(buildKycPayload(p, 'K2', '2026-10-18'), maskPii('我手机号13800000000'))).toEqual([]);
  });
});

describe('画像不变性与版本对比', () => {
  it('同题不同画像的回撤数字不一致 → 偏离真值的那条判不合格', () => {
    const item = (pid: string): EvalItem => ({ ...mkItem('fund', '易方达蓝筹精选近一年最大回撤是多少？风险等级？', ['005827.OF']), item_id: `G-${pid}`, persona_id: pid, gold: { ...mkItem('fund', '', ['005827.OF']).gold, invariance_group: 'G1', invariant_metrics: ['fund_mdd_1y', 'risk_level'] } });
    const items = [item('U01'), item('U06')];
    const logs = [mkLog(items[0], '易方达蓝筹精选近一年最大回撤-31.27%，风险等级R4，投资有风险。'), mkLog(items[1], '易方达蓝筹精选近一年最大回撤-21.27%，风险等级R3，投资有风险。')];
    const out = runBatch({ facts: FACTS, entities: ENTITIES, personas: PERSONAS, items, versions: VERSIONS, prompts: PROMPTS, evalDate: '2026-10-18', latestTradingDay: '2026-10-16', logs, judges: {} });
    expect(out.groups[0].verdict).toBe('fail');
    const bad = out.evals.find((e) => e.persona_id === 'U06')!;
    expect(bad.checks.find((c) => c.check_id === 'PER-INVARIANT')!.verdict).toBe('fail');
    expect(out.evals.find((e) => e.persona_id === 'U01')!.checks.find((c) => c.check_id === 'PER-INVARIANT')!.verdict).toBe('pass');
  });
  it('McNemar 精确检验', () => {
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarExact(0, 6)).toBeCloseTo(0.03125, 5);
  });
  it('配对统计与发布闸门：候选新增红线 → 阻断', () => {
    const items = [mkItem('advice', '推荐基金', [])];
    const base = runBatch(batchOf(items, 'V3', '市场有风险，以上内容不构成投资建议。'));
    const cand = runBatch(batchOf(items, 'V5', '这只基金稳赚不赔，建议立即买入！'));
    const st = pairedStats(base.evals, cand.evals).find((s) => s.key === 'compliance')!;
    expect(st.regressions).toHaveLength(1);
    expect(runGate(cand.evals, cand.groups, base.evals, base.groups, 0).decision).toBe('block');
  });
});

// ---------- helpers ----------
function mkItem(intent: EvalItem['intent'], question: string, entities: string[], products?: string[]): EvalItem {
  return { item_id: 'T1', question_id: 'T1', persona_id: 'U03', intent, question, gold: { entities, metrics: [], slot_keywords: [], answerable: true, products_in_question: products }, tags: [] };
}
function mkLog(item: EvalItem, answer: string, version = 'V3', status: AnswerLog['status'] = 'ok'): AnswerLog {
  return { answer_id: `${version}-${item.item_id}`, item_id: item.item_id, version_id: version, question_id: item.question_id, persona_id: item.persona_id, question_masked: item.question, answer, created_at: '', status, trace: emptyTrace(item.question) };
}
function batchOf(items: EvalItem[], version: string, answer: string) {
  return { facts: FACTS, entities: ENTITIES, personas: PERSONAS, items, versions: VERSIONS as AgentVersion[], prompts: PROMPTS as PromptManifest[], evalDate: '2026-10-18', latestTradingDay: '2026-10-16', logs: items.map((i) => mkLog(i, answer, version)), judges: {} };
}
function sandboxEval(answer: string, facts: FactIndex, status: AnswerLog['status'] = 'ok') {
  const item = mkItem('quote', '贵州茅台现在股价多少？', ['600519.SH']);
  const env = makeEnv({ facts: FACTS, entities: ENTITIES, personas: PERSONAS as KycProfile[], items: [item], versions: [], prompts: [], evalDate: '2026-10-18', latestTradingDay: '2026-10-16' }, undefined, undefined, facts);
  return evaluateAnswer(mkLog(item, answer, '-', status), env, { hasTrace: false });
}
