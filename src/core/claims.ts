// 从回答中抽取数字声明：数值、单位、限定词（约/超过/不到）、所属标的、指标与明确写出的时点。
// 抽取是确定性的，可在浏览器里对任意粘贴的回答运行；识别不出指标的数字记为“未识别”，不会被当成正确。
import type { Claim, Entity, MetricId, Qualifier, Unit } from './types';
import { FUND_MDD_KEYWORDS, FUND_RANGES, FUND_RETURN_KEYWORDS, METRIC_DEFS } from './standards';
import { findDate, findReportPeriod, sentenceRange } from './text';

const NUM_RE =
  /([+\-−－]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(万亿元|万亿|亿元|亿股|亿手|亿|万元|万股|万手|万|元\/股|元|%|％|个百分点|pct|倍|手|股)?/g;

const SKIP_AFTER = /^\s*(年|月|日|号|季|周|天|个交易日|个月|个|只|名|家|位|条|项|成(?!交)|:|：|岁|小时|分钟|期|笔|世纪|届|次|轮|批|款|种|大|强|佳)/;
const PERIOD_UNIT_AFTER = /^\s*(年|月|日)/;

interface KeywordHit {
  metric: MetricId | 'GENERIC_FUND_RETURN' | 'GENERIC_FUND_MDD';
  pos: number;
  len: number;
}

const STOCK_KEYWORDS: { metric: MetricId; kw: string }[] = METRIC_DEFS.flatMap((m) =>
  m.keywords.map((kw) => ({ metric: m.id, kw })),
).sort((a, b) => b.kw.length - a.kw.length);

function lastKeyword(window: string, entityType: Entity['type'] | null): KeywordHit | null {
  let best: KeywordHit | null = null;
  const consider = (metric: KeywordHit['metric'], kw: string) => {
    const idx = window.lastIndexOf(kw);
    if (idx < 0) return;
    const endPos = idx + kw.length;
    const bestEnd = best ? best.pos + best.len : -1;
    // 选“结束位置最靠近数字”的关键词；结束位置相同时取更长的词
    if (endPos > bestEnd || (endPos === bestEnd && best && kw.length > best.len)) best = { metric, pos: idx, len: kw.length };
  };
  for (const { metric, kw } of STOCK_KEYWORDS) {
    if (entityType === 'fund' && ['change_pct', 'return_5d', 'change', 'price'].includes(metric)) continue;
    consider(metric, kw);
  }
  if (entityType === 'fund') {
    for (const kw of FUND_RETURN_KEYWORDS) consider('GENERIC_FUND_RETURN', kw);
    for (const kw of FUND_MDD_KEYWORDS) consider('GENERIC_FUND_MDD', kw);
  }
  return best;
}

const NEG_VERB = /(下跌|跌幅|跌了|下降|减少|下滑|回落|回调|回吐|走低|收低|亏损|下行|降低|跌去|收跌|跌)/;
const POS_VERB = /(上涨|涨幅|涨了|增长|增加|上升|提升|收涨|涨)/;

export interface ExtractContext {
  entities: Entity[];
  /** 问题本身指向的标的，找不到就近提及时作为默认 */
  defaultEntities: string[];
  evalYear: number;
}

export function aliasIndex(entities: Entity[]): { alias: string; thscode: string }[] {
  const out: { alias: string; thscode: string }[] = [];
  for (const e of entities) {
    const names = new Set([e.name, ...e.aliases, e.thscode, e.thscode.split('.')[0]]);
    for (const n of names) if (n && n.length >= 2) out.push({ alias: n, thscode: e.thscode });
  }
  return out.sort((a, b) => b.alias.length - a.alias.length);
}

/** “来源：同花顺金融数据”等是数据来源，不是在提同花顺这只股票；等长替换为空格以保持位置不变 */
const SOURCE_PHRASES = /同花顺(金融数据|金融|数据|iFinD|App|APP|app|等|行情|软件|客户端|平台|官网|F10|API|接口)/g;
const SOURCE_PREFIX = /(来源|来自|源自|数据源|出处)\s*[：:为是于]?\s*(同花顺)/g;
export function maskSourcePhrases(text: string): string {
  return text
    .replace(SOURCE_PHRASES, (m) => ' '.repeat(m.length))
    .replace(SOURCE_PREFIX, (m, _a: string, b: string) => m.slice(0, m.length - b.length) + ' '.repeat(b.length));
}

/** 关键词窗口里的噪声词（“报道”里的“报”不是“报价”），等长替换 */
const WINDOW_NOISE = /(报道|报告|报表|日报|年报|季报|中报|快报|研报|播报|报名|报送|汇报|情报|年收入|月收入|家庭收入|收入水平|金融资产)/g;
/** 推算、举例、假设语境中的数字不是事实声明 */
const DERIVED_CONTEXT = /(÷|≈|×|＝|推算|相差|差额|折算|月均|日均|可理解为|理解为|愿意为|支付约|每\s*1\s*元|年化|折年|折合|换算|相当于|约合|测算|估算|假设|假如|例如|比如|譬如|如果|若是|即使|就算|万一|变成|放大|意味着|最多亏|最大亏|大致在|区间|之间|上限|下限|控制在|不超过|不要超过|目标)/;
const CATEGORY_TERMS = /(货币基金|纯债|债券基金|债基|混合型|股票型|指数基金|宽基|行业主题|银行板块|板块|行业平均|同类平均|同类)/;
const ALLOC_AFTER = /^\s*(的)?\s*(仓位|配|配置|用于|投入|资金|闲钱|的钱|左右的资金)/;
/** 这些语境下的数字是资金流、大宗交易等本平台未接入核验的指标，记为未识别而不是误判为错 */
const UNSUPPORTED_CONTEXT = /(振幅|区间|大宗交易|融资买入|融资余额|融券|主力资金|净流入|净流出|北向|南向|龙虎榜|遭抛售|抛售|成交了?\d|持仓市值|仓位|占比|比例|配置)/;
const INDEX_NAME_BEFORE = /(沪深|中证|上证|科创|创业板|深证|国证|恒生|标普|纳斯达克|中证A)$/;
const INDEX_NAME_AFTER = /^(ETF|指数|成份|成分|只|家|指)/;
const DERIVED_AFTER = /^\s*(的)?\s*(差额|差距|差值|合计|总和|之和|倍数)/;

/** 在 text[0..pos) 中找最近一次提及的标的 */
export function nearestEntity(text: string, pos: number, idx: { alias: string; thscode: string }[], lookback = 260): string | null {
  const from = Math.max(0, pos - lookback);
  const window = maskSourcePhrases(text.slice(from, pos));
  let best: { at: number; thscode: string } | null = null;
  for (const { alias, thscode } of idx) {
    const at = window.lastIndexOf(alias);
    if (at >= 0 && (!best || at + alias.length > best.at)) best = { at: at + alias.length, thscode };
  }
  return best ? best.thscode : null;
}

export function mentionedEntities(text: string, entities: Entity[]): string[] {
  const idx = aliasIndex(entities);
  const out = new Set<string>();
  const t = maskSourcePhrases(text);
  for (const { alias, thscode } of idx) if (t.includes(alias)) out.add(thscode);
  return [...out];
}

function unitInfo(u: string | undefined): { unit: Unit | null; scale: number } {
  switch (u) {
    case '万亿元':
    case '万亿':
      return { unit: 'CNY', scale: 1e12 };
    case '亿元':
    case '亿':
      return { unit: 'CNY', scale: 1e8 };
    case '万元':
    case '万':
      return { unit: 'CNY', scale: 1e4 };
    case '元':
      return { unit: 'CNY', scale: 1 };
    case '元/股':
      return { unit: 'CNY_per_share', scale: 1 };
    case '%':
    case '％':
    case '个百分点':
    case 'pct':
      return { unit: 'pct', scale: 1 };
    case '倍':
      return { unit: 'x', scale: 1 };
    case '亿股':
      return { unit: 'shares', scale: 1e8 };
    case '万股':
      return { unit: 'shares', scale: 1e4 };
    case '股':
      return { unit: 'shares', scale: 1 };
    case '亿手':
      return { unit: 'shares', scale: 1e10 };
    case '万手':
      return { unit: 'shares', scale: 1e6 };
    case '手':
      return { unit: 'shares', scale: 100 };
    default:
      return { unit: null, scale: 1 };
  }
}

function qualifierBefore(text: string, start: number): Qualifier {
  const before = text.slice(Math.max(0, start - 6), start).replace(/[\s*]/g, '');
  if (/(超过|逾|突破|超|高于|大于|以上)$/.test(before)) return 'gt';
  if (/(不到|不足|低于|少于|未到)$/.test(before)) return 'lt';
  if (/(约|大约|近|接近|将近|大概|大致|约为|左右)$/.test(before)) return 'approx';
  const after = text.slice(start, start + 24);
  if (/^[^，。；\n]{0,14}(左右|上下)/.test(after)) return 'approx';
  if (/^[^，。；\n]{0,14}以上/.test(after)) return 'gt';
  return 'exact';
}

function isListMarker(text: string, start: number, end: number): boolean {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const prefix = text.slice(lineStart, start).replace(/[#*>\-\s]/g, '');
  const next = text[end] ?? '';
  return prefix === '' && (next === '.' || next === '、' || next === ')' || next === '）') && !/\d/.test(text[end + 1] ?? '');
}

/** 主函数：抽取所有数字声明（含无法识别指标的数字，metric 为 null） */
export function extractClaims(answer: string, ctx: ExtractContext): Claim[] {
  const claims: Claim[] = [];
  const idx = aliasIndex(ctx.entities);
  const byCode = new Map(ctx.entities.map((e) => [e.thscode, e]));
  NUM_RE.lastIndex = 0;
  let n = 0;
  for (const m of answer.matchAll(NUM_RE)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const signStr = m[1];
    const numStr = m[2];
    const unitStr = m[3];
    const end = start + raw.length;
    const numEnd = start + signStr.length + numStr.length;
    const after = answer.slice(numEnd, numEnd + 6);
    const before1 = answer[start - 1] ?? '';

    // 过滤日期、代码、时间、序号、排名、计数等非指标数字
    if (signStr && /\d/.test(before1)) continue; // 2026-10-16、10-20 区间里的连字符不是负号
    if (/[A-Za-z\/]/.test(before1)) continue; // R4、Q3、10/16
    if (/[:：]/.test(before1) && /\d/.test(answer[start - 2] ?? '')) continue; // 15:00（冒号前是数字才是时间；“涨跌幅：-0.54%”要保留）
    if ((before1 === '第' || before1 === '前') && !unitStr) continue; // 第1名、前10
    if (!unitStr && SKIP_AFTER.test(after)) continue;
    if (unitStr && PERIOD_UNIT_AFTER.test(after) && !['%', '％'].includes(unitStr)) continue;
    if (/^\d{6}$/.test(numStr) && !unitStr) continue; // 证券代码
    if (/^(19|20)\d{2}$/.test(numStr) && !unitStr) continue; // 年份
    if (/^\s*\.(SH|SZ|BJ|OF)/i.test(answer.slice(numEnd, numEnd + 4))) continue;
    if (isListMarker(answer, start, numEnd)) continue;
    if (!signStr && INDEX_NAME_BEFORE.test(answer.slice(Math.max(0, start - 5), start))) continue; // 沪深300、中证500
    if (INDEX_NAME_AFTER.test(answer.slice(numEnd, numEnd + 3)) && !unitStr) continue;

    const { unit: unitFromStr, scale } = unitInfo(unitStr);
    let value = Number(numStr.replace(/,/g, '')) * scale;
    const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0;

    const [sStart, sEnd] = sentenceRange(answer, start);
    const sentence = answer.slice(sStart, sEnd).trim();
    // 关键词窗口：句首到数字（最多 36 字）
    const winStart = Math.max(sStart, start - 36);
    const window = answer.slice(winStart, start).replace(WINDOW_NOISE, (m) => ' '.repeat(m.length));
    // 引号内（多为新闻标题原文）或资金流等未接入语境的数字，不作为事实核验
    const quoteOpen = (answer.slice(sStart, start).match(/[“「『《"]/g) ?? []).length;
    const quoteClose = (answer.slice(sStart, start).match(/[”」』》"]/g) ?? []).length;
    const insideQuote = quoteOpen > quoteClose || (quoteOpen > 0 && /"/.test(answer.slice(sStart, start)) && quoteOpen % 2 === 1);
    const clause = window.slice(Math.max(0, window.search(/[^，,]*$/)));
    const afterNum = answer.slice(unitStr ? end : numEnd, (unitStr ? end : numEnd) + 8);
    const isRange = /^\s*(元|%)?\s*[–—~～\-至到]\s*\d/.test(afterNum) || /\d\s*(元|%)?\s*[–—~～至到]\s*$/.test(answer.slice(Math.max(0, start - 6), start));
    const unsupported =
      insideQuote ||
      isRange ||
      UNSUPPORTED_CONTEXT.test(window.slice(-20)) ||
      DERIVED_CONTEXT.test(clause) ||
      CATEGORY_TERMS.test(clause) ||
      ALLOC_AFTER.test(afterNum) ||
      /^\s*[÷×*/＋+]\s*\d/.test(afterNum) || // 1÷7.06 这类算式
      /^\s*-\d{1,2}(?!\d)/.test(afterNum); // 10-09 这类月-日

    const entity = nearestEntity(answer, start, idx) ?? ctx.defaultEntities[0] ?? null;
    const entityType = entity ? byCode.get(entity)?.type ?? null : null;

    let metric: MetricId | null = null;
    let candidates: MetricId[] | undefined;
    let kwHit = unsupported ? null : lastKeyword(window, entityType);
    let rangeHit = findRange(window);
    // “近一月、近三月、近半年收益分别为 a、b、c”：第 k 个数字对应第 k 个区间
    // 枚举起点：“分别为/是”，或同一分句里先列 2 个以上区间、再跟左括号（近半年、近一年…（a、b、c））
    let fenbie = window.search(/分别(为|是)/);
    if (fenbie < 0) {
      const paren = Math.max(window.lastIndexOf('（'), window.lastIndexOf('('));
      if (paren >= 0) {
        const pre = window.slice(0, paren);
        const segStart = Math.max(pre.lastIndexOf('%'), pre.lastIndexOf('，'), pre.lastIndexOf(','), pre.lastIndexOf('）')) + 1;
        const seg = pre.slice(segStart);
        const nRanges = FUND_RANGES.filter((r) => r.keywords.some((kw) => seg.includes(kw))).length;
        if (nRanges >= 2 && /、|和|及/.test(seg)) fenbie = paren;
      }
    }
    if (fenbie >= 0) {
      const pre = window.slice(0, fenbie).replace(/[，,\s]+$/, ''); // “……均为负收益，分别为”里紧挨“分别”的逗号不算分句
      const segStart = Math.max(pre.lastIndexOf('%'), pre.lastIndexOf('，'), pre.lastIndexOf(','), pre.lastIndexOf('）')) + 1;
      const before = pre.slice(segStart);
      const order: { pos: number; range: string }[] = [];
      for (const r of FUND_RANGES) for (const kw of r.keywords) {
        let at = before.indexOf(kw);
        while (at >= 0) {
          if (!order.some((o) => o.pos <= at && at < o.pos + 3)) order.push({ pos: at, range: r.range });
          at = before.indexOf(kw, at + kw.length);
        }
      }
      order.sort((a, b) => a.pos - b.pos);
      const k = (window.slice(fenbie).match(/[+\-−]?\d+(?:\.\d+)?\s*%/g) ?? []).length;
      if (order[k]) rangeHit = order[k].range;
    }
    const afterUnit = answer.slice(unitStr ? end : numEnd, (unitStr ? end : numEnd) + 6);
    const postKw = /^\s*(的)?\s*(单季)?\s*(PE|PB|市盈率|市净率|ROE|毛利率|成交额|成交量)/.exec(afterUnit + answer.slice((unitStr ? end : numEnd) + 6, (unitStr ? end : numEnd) + 10));
    const POST_MAP: Record<string, MetricId> = { PE: 'pe_ttm', 市盈率: 'pe_ttm', PB: 'pb_mrq', 市净率: 'pb_mrq', ROE: 'roe', 毛利率: 'gross_margin', 成交额: 'turnover', 成交量: 'volume' };
    if (postKw && !unsupported) kwHit = { metric: POST_MAP[postKw[3]], pos: window.length, len: 0 };
    if (DERIVED_AFTER.test(afterUnit)) kwHit = null; // “约 37 亿元的差额”是推算值

    if (kwHit) {
      if (kwHit.metric === 'GENERIC_FUND_MDD' && rangeHit) {
        // “最大回撤 -16.73%，今年来 -8.43%”：区间词在回撤之后且隔着逗号 → 指该区间收益
        const hits = FUND_RANGES.filter((r) => r.range === rangeHit).flatMap((r) => r.keywords.map((kw) => ({ at: window.lastIndexOf(kw), len: kw.length })));
        const best = hits.sort((a, b) => b.at - a.at)[0];
        const gap = best ? window.length - (best.at + best.len) : 99;
        if (best && best.at > kwHit.pos + kwHit.len && gap <= 3 && /[，,、；]/.test(window.slice(kwHit.pos + kwHit.len, best.at))) kwHit = { metric: 'GENERIC_FUND_RETURN', pos: best.at, len: best.len };
      }
      if (kwHit.metric === 'GENERIC_FUND_RETURN' || kwHit.metric === 'GENERIC_FUND_MDD') {
        const prefix = kwHit.metric === 'GENERIC_FUND_MDD' ? 'fund_mdd_' : 'fund_return_';
        if (rangeHit) metric = `${prefix}${rangeHit}` as MetricId;
        else {
          candidates = FUND_RANGES.map((r) => `${prefix}${r.range}` as MetricId);
          metric = candidates[3];
        }
      } else {
        metric = kwHit.metric;
        // “同比”紧跟基础指标 → 转为同比增速
        const tail = window.slice(kwHit.pos);
        if (/同比/.test(tail) && (unitFromStr === 'pct' || !unitFromStr)) {
          if (metric === 'revenue') metric = 'revenue_yoy';
          else if (metric === 'net_profit' || metric === 'parent_net_profit') metric = 'net_profit_yoy';
        }
        // 个股的“涨/跌”遇到近 5 日等区间词 → 区间涨跌幅；其他区间（近一年等）没有对应核验数据，记为未识别
        // “营收和归母净利润同比分别增长 a 和 b”：第 k 个数字对应第 k 个基础指标
        if (fenbie >= 0 && (metric === 'revenue_yoy' || metric === 'net_profit_yoy' || metric === 'revenue' || metric === 'net_profit' || metric === 'parent_net_profit')) {
          const before = window.slice(0, fenbie);
          const bases = [...before.matchAll(/(营业收入|营收|收入|归母净利润|归母净利|净利润|净利)/g)].map((m) => (/收入|营收/.test(m[0]) ? 'revenue' : /归母/.test(m[0]) ? 'parent_net_profit' : 'net_profit'));
          const k = (window.slice(fenbie).match(/[+\-−]?\d+(?:\.\d+)?\s*(%|亿|万)/g) ?? []).length;
          const base = bases[k];
          if (base) metric = (/同比/.test(window) ? (base === 'revenue' ? 'revenue_yoy' : 'net_profit_yoy') : base) as MetricId;
        }
        if (metric === 'change_pct') {
          if (/近5个交易日|近五个交易日|近5日|近五日|近一周|最近一周|本周|5个交易日/.test(window.replace(/[\s*]/g, ''))) metric = 'return_5d';
          else if (/近一月|近三月|近半年|近一年|今年以来|年初至今|年内|本月|上半年|近\d+个?(月|年)/.test(window)) metric = null;
        }
        if (metric === 'return_5d' && /(当天|当日|今日|单日)[^%]{0,6}$/.test(window.replace(/[\s*]/g, ''))) metric = 'change_pct';
      }
    } else if (/同比/.test(window)) {
      metric = null; // 只有“同比”没有基础指标，无法判断，记为未识别
    }

    // 单位与指标不兼容时，宁可记为未识别也不误判
    let unit: Unit = unitFromStr ?? (metric ? defaultUnit(metric) : 'pct');
    if (metric === 'change_pct' && unitFromStr === 'CNY') metric = 'change';
    if (metric && unitStr && !unitCompatible(metric, unitStr)) {
      metric = null;
      candidates = undefined;
    }
    if (metric && !unitFromStr) unit = defaultUnit(metric);

    // 符号：下跌/下降等动词使正数变负；回撤按绝对值比较
    const signNeg = /[\-−－]/.test(signStr);
    let signExplicit = Boolean(signStr);
    if (signNeg) value = -Math.abs(value);
    else if (!signStr && metric && isSigned(metric)) {
      // 方向词只看“关键词 + 关键词到数字之间”，并去掉“涨跌幅/涨跌额”这类中性词
      const verbZone = (kwHit ? window.slice(kwHit.pos) : window.slice(-8)).replace(/涨跌(幅|额)?/g, '');
      const neg = NEG_VERB.exec(verbZone);
      const pos = POS_VERB.exec(verbZone);
      if (neg && (!pos || neg.index >= pos.index)) value = -Math.abs(value);
      signExplicit = Boolean(neg || pos);
    }

    let period: string | null = null;
    if (metric) {
      const kind = METRIC_DEFS.find((d) => d.id === metric)?.kind;
      if (kind === 'report') period = findReportPeriod(sentence);
      else if (kind === 'price_like' || kind === 'nav_like') period = findDate(sentence, ctx.evalYear);
    }

    if (metric && ['price', 'open', 'high', 'low', 'prev_close'].includes(metric) && !candidates) candidates = [metric, ...(['price', 'open', 'high', 'low', 'prev_close'] as MetricId[]).filter((x) => x !== metric)];
    claims.push({
      claim_id: `c${++n}`,
      start,
      end: unitStr ? end : numEnd,
      text: answer.slice(start, unitStr ? end : numEnd),
      sentence,
      entity,
      metric,
      period,
      value,
      unit,
      qualifier: qualifierBefore(answer, start),
      decimals,
      scale,
      sign_explicit: signExplicit,
      metric_candidates: candidates,
    });
  }
  return claims;
}

function findRange(window: string): string | null {
  let best: { pos: number; range: string } | null = null;
  for (const r of FUND_RANGES) {
    for (const kw of r.keywords) {
      const at = window.lastIndexOf(kw);
      if (at >= 0 && (!best || at > best.pos)) best = { pos: at, range: r.range };
    }
  }
  return best?.range ?? null;
}

function isSigned(metric: MetricId): boolean {
  if (metric.startsWith('fund_return_')) return true;
  if (metric.startsWith('fund_mdd_')) return false;
  return METRIC_DEFS.find((d) => d.id === metric)?.signed ?? false;
}

export function defaultUnit(metric: MetricId): Unit {
  if (metric.startsWith('fund_')) return metric === 'fund_scale' ? 'CNY' : metric === 'fund_manager' ? 'text' : 'pct';
  return METRIC_DEFS.find((d) => d.id === metric)?.unit ?? 'pct';
}

function unitCompatible(metric: MetricId, unitStr: string): boolean {
  const expected = defaultUnit(metric);
  const { unit } = unitInfo(unitStr);
  if (!unit) return true;
  if (expected === 'CNY_per_share') return unit === 'CNY' || unit === 'CNY_per_share';
  if (expected === 'x') return unit === 'x';
  if (expected === 'shares') return unit === 'shares' || unit === 'CNY'; // “成交量 3.1万手”/“31万”
  return expected === unit;
}

/** 识别回答里写到的产品风险等级（R1–R5），供画像不变性与适当性检查使用。explicit=false 为“中高风险”等口语表述 */
export function extractRiskLevels(
  answer: string,
  entities: Entity[],
): { entity: string | null; level: number; start: number; text: string; explicit: boolean }[] {
  const idx = aliasIndex(entities);
  const out: { entity: string | null; level: number; start: number; text: string; explicit: boolean }[] = [];
  const re = /R\s*([1-5])(?!\d)|(?<![中高低])(中低|中高|低|中|高)风险(等级)?(?![承偏资])/g;
  for (const m of answer.matchAll(re)) {
    const start = m.index ?? 0;
    let level: number;
    let explicit = true;
    if (m[1]) level = Number(m[1]);
    else {
      // 口语只在紧邻“风险等级/属于/为”时才算等级表述，避免把“高风险资产”之类泛指当成评级
      const before = answer.slice(Math.max(0, start - 8), start);
      if (!/(风险等级|等级|属于|为|是|评级)[^，。]{0,3}$/.test(before)) continue;
      level = ({ 低: 1, 中低: 2, 中: 3, 中高: 4, 高: 5 } as Record<string, number>)[m[2]] ?? 0;
      explicit = false;
    }
    out.push({ entity: nearestEntity(answer, start, idx), level, start, text: m[0], explicit });
  }
  return out;
}
