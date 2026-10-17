// 数据核验：把数字声明与扶摇事实比对。按“声明精度”给容差，区分“数字错”和“拿旧数据当最新”。
// 核验数据缺失或接口失败时返回 unverifiable，绝不默认通过。
import type { Claim, ClaimVerification, ContextDatum, Fact, MetricId } from './types';
import { METRIC_BY_ID } from './standards';

export function factKey(entity: string, metric: MetricId, period: string): string {
  return `${entity}|${metric}|${period}`;
}

/** 报告期排序键：2026-Q2 → 2026*10+2；单季 'S' 与累计同序 */
function periodRank(period: string): number {
  const m = period.match(/^(\d{4})-Q([1-4])S?$/);
  if (m) return Number(m[1]) * 10 + Number(m[2]);
  const d = period.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (d) return Number(d[1]) * 10000 + Number(d[2]) * 100 + Number(d[3]);
  return period === 'latest' ? Number.MAX_SAFE_INTEGER : 0;
}

export class FactIndex {
  private byKey = new Map<string, Fact>();
  private byEM = new Map<string, Fact[]>();
  /** 模拟/记录的接口故障：entity → 错误描述（故障注入演练与接口异常测试用） */
  outages = new Map<string, string>();

  constructor(facts: Fact[]) {
    for (const f of facts) {
      this.byKey.set(f.key, f);
      const k = `${f.entity}|${f.metric}`;
      const arr = this.byEM.get(k) ?? [];
      arr.push(f);
      this.byEM.set(k, arr);
    }
    for (const arr of this.byEM.values()) arr.sort((a, b) => periodRank(b.period) - periodRank(a.period) || (b.as_of > a.as_of ? 1 : -1));
  }

  get(key: string): Fact | undefined {
    return this.byKey.get(key);
  }

  at(entity: string, metric: MetricId, period: string): Fact | undefined {
    return this.byKey.get(factKey(entity, metric, period));
  }

  /** 按时点从新到旧 */
  series(entity: string, metric: MetricId): Fact[] {
    return this.byEM.get(`${entity}|${metric}`) ?? [];
  }

  /** 最新一条：单季口径（S）不参与“最新报告期”判断 */
  latest(entity: string, metric: MetricId): Fact | undefined {
    return this.series(entity, metric).find((f) => !f.period.endsWith('S') && f.value !== null);
  }

  has(entity: string, metric: MetricId): boolean {
    return this.series(entity, metric).length > 0;
  }

  all(): Fact[] {
    return [...this.byKey.values()];
  }
}

export interface CompareResult {
  ok: boolean;
  tolerance: string;
}

/**
 * 按声明精度比较：写到几位小数，就允许最后一位相差 1（兼容四舍五入与截断）；
 * “约/左右”放宽到 2%（百分比指标另允许 0.5 个百分点）；“超过/不到”按区间判断。
 */
export function compareValue(claim: Pick<Claim, 'value' | 'decimals' | 'qualifier' | 'scale' | 'unit'> & { sign_explicit?: boolean }, fact: number, absCompare = false): CompareResult {
  const abs = absCompare || (claim.unit === 'pct' && claim.sign_explicit === false);
  const c = abs ? Math.abs(claim.value) : claim.value;
  const f = abs ? Math.abs(fact) : fact;
  const ulp = Math.pow(10, -claim.decimals) * (claim.scale || 1);
  const eps = 1e-9 * Math.max(1, Math.abs(f));
  switch (claim.qualifier) {
    case 'gt':
      return { ok: f >= c - eps && f <= Math.abs(c) * 1.3 + ulp, tolerance: '“超过”：事实值 ≥ 声明值且不超过其 1.3 倍' };
    case 'lt':
      return { ok: f <= c + eps && f >= c * 0.7 - ulp, tolerance: '“不到”：事实值 ≤ 声明值且不低于其 0.7 倍' };
    case 'approx': {
      const tol = claim.unit === 'pct' ? Math.max(ulp, 0.05 * Math.abs(f), 1) : Math.max(ulp, 0.02 * Math.abs(f));
      return { ok: Math.abs(c - f) <= tol + eps, tolerance: `“约”：允许 ±${fmtTol(tol, claim.unit)}` };
    }
    default:
      return { ok: Math.abs(c - f) <= ulp + eps, tolerance: `按声明精度：允许 ±${fmtTol(ulp, claim.unit)}` };
  }
}

function fmtTol(v: number, unit: string): string {
  if (unit === 'pct') return `${trim(v)} 个百分点`;
  if (v >= 1e8) return `${trim(v / 1e8)} 亿`;
  if (v >= 1e4) return `${trim(v / 1e4)} 万`;
  return trim(v);
}

function trim(v: number): string {
  return String(Number(v.toPrecision(6)));
}

export interface VerifyEnv {
  facts: FactIndex;
  /** Agent 当时拿到的数据（来自 trace）；在线评测粘贴的回答没有 trace，传 undefined */
  context?: ContextDatum[];
  /** 回答或问题里提到的其他标的，用于指代消歧 */
  altEntities?: string[];
}

function isAbs(metric: MetricId): boolean {
  return metric.startsWith('fund_mdd_') || Boolean(METRIC_BY_ID[metric]?.abs_compare);
}

/** 就近标的核不上时，用回答中提到的其他标的再试一次（“按数值匹配到其他标的”），避免把张冠李戴的指代当成数字错误 */
export function verifyClaim(claim: Claim, env: VerifyEnv): ClaimVerification {
  const first = verifyClaimOnce(claim, env);
  if (first.verdict !== 'mismatch' || !env.altEntities?.length) return first;
  for (const alt of env.altEntities) {
    if (alt === claim.entity) continue;
    const r = verifyClaimOnce({ ...claim, entity: alt }, env);
    if (r.verdict === 'match' || r.verdict === 'stale_match') return { ...r, reason: `${r.reason}（按数值归属到 ${alt}，原就近指代为 ${claim.entity}）` };
  }
  return first;
}

function verifyClaimOnce(claim: Claim, env: VerifyEnv): ClaimVerification {
  const base = { claim_id: claim.claim_id, in_context: (env.context ? 'absent' : 'unknown') as ClaimVerification['in_context'] };
  if (!claim.metric) return { ...base, verdict: 'unrecognized', reason: '未识别出指标（如仓位比例、年限），不作为事实核验', tolerance: '-' };
  if (!claim.entity) return { ...base, verdict: 'unverifiable', reason: '未识别出所属标的', tolerance: '-' };
  const outage = env.facts.outages.get(claim.entity);
  const candidates = claim.metric_candidates ?? [claim.metric];

  // 与 Agent 当时的上下文比对（归因用）
  let in_context: ClaimVerification['in_context'] = base.in_context;
  let context_value: number | string | null | undefined;
  let context_as_of: string | undefined;
  if (env.context) {
    const ctxRows = env.context.filter((d) => d.entity === claim.entity && candidates.includes(d.metric) && typeof d.value === 'number');
    if (ctxRows.length) {
      const hit = ctxRows.find((d) => compareValue(claim, d.value as number, isAbs(d.metric)).ok);
      const row = hit ?? ctxRows[0];
      in_context = hit ? 'match' : 'mismatch';
      context_value = row.value;
      context_as_of = row.as_of;
    }
  }
  const withCtx = { claim_id: claim.claim_id, in_context, context_value, context_as_of };

  if (outage) {
    return { ...withCtx, verdict: 'unverifiable', reason: `核验接口异常：${outage}`, tolerance: '-' };
  }

  const anyFacts = candidates.some((m) => env.facts.has(claim.entity!, m));
  if (!anyFacts) return { ...withCtx, verdict: 'unverifiable', reason: '核验数据缺失（该标的/指标未取到数据）', tolerance: '-' };

  // 1) 回答写明了时点：按该时点核验
  if (claim.period) {
    const atPeriod = candidates.map((m) => env.facts.at(claim.entity!, m, claim.period!)).filter((f): f is Fact => Boolean(f && typeof f.value === 'number'));
    const okFact = atPeriod.find((f) => compareValue(claim, f.value as number, isAbs(f.metric)).ok);
    for (const f of okFact ? [okFact] : atPeriod.slice(0, 1)) {
      {
        const r = compareValue(claim, f.value as number, isAbs(f.metric));
        return {
          ...withCtx,
          verdict: r.ok ? 'match' : 'mismatch',
          reason: r.ok ? `与 ${claim.period} 数据一致` : `与 ${claim.period} 数据不符`,
          fact_key: f.key,
          fact_value: f.value,
          fact_as_of: f.as_of,
          tolerance: r.tolerance,
        };
      }
    }
    // 写明的时点没有数据：退回按最新核验，但在理由里说明
  }

  // 2) 按最新值核验
  let firstLatest: Fact | undefined;
  for (const m of candidates) {
    const f = env.facts.latest(claim.entity, m);
    if (!f || typeof f.value !== 'number') continue;
    firstLatest ??= f;
    const r = compareValue(claim, f.value, isAbs(m));
    if (r.ok) {
      return {
        ...withCtx,
        verdict: 'match',
        reason: claim.period ? `回答写的时点（${claim.period}）无数据，与最新值（${f.as_of}）一致` : `与最新数据（${f.as_of}）一致`,
        fact_key: f.key,
        fact_value: f.value,
        fact_as_of: f.as_of,
        tolerance: r.tolerance,
      };
    }
  }

  // 3) 与更早时点吻合 → 过期数据当最新
  for (const m of candidates) {
    const latest = env.facts.latest(claim.entity, m);
    for (const f of env.facts.series(claim.entity, m)) {
      if (f === latest || typeof f.value !== 'number') continue;
      if (latest && f.period.endsWith('S') !== latest.period.endsWith('S')) continue;
      const r = compareValue(claim, f.value, isAbs(m));
      if (r.ok) {
        return {
          ...withCtx,
          verdict: 'stale_match',
          reason: `数值等于 ${f.as_of} 的旧数据，最新应为 ${latest?.as_of ?? '-'}：${fmtVal(latest?.value)}`,
          fact_key: latest?.key,
          fact_value: latest?.value,
          fact_as_of: latest?.as_of,
          matched_fact_key: f.key,
          tolerance: r.tolerance,
        };
      }
    }
  }

  const ref = firstLatest;
  return {
    ...withCtx,
    verdict: 'mismatch',
    reason: ref ? `与最新数据（${ref.as_of}：${fmtVal(ref.value)}）不符，也不等于任何更早时点的数据` : '与核验数据不符',
    fact_key: ref?.key,
    fact_value: ref?.value,
    fact_as_of: ref?.as_of,
    tolerance: ref ? compareValue(claim, ref.value as number, isAbs(ref.metric)).tolerance : '-',
  };
}

export function fmtVal(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'string') return v;
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return String(Number(v.toFixed(4)));
}
