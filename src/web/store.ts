// 前端数据层：加载数据包后在浏览器里用同一套评测引擎重算（与 npm run eval 的结果逐位一致）。
import { createContext, useContext } from 'react';
import type { AgentVersion, AnswerEval, AnswerLog, Entity, EvalItem, Fact, FeedbackEvent, HotItem, InvarianceGroupResult, JudgeResult, KycProfile, PromptManifest } from '../core/types';
import { runBatch } from '../core/pipeline';
import { computeMetrics, type MetricValue } from '../core/metrics';
import { FactIndex } from '../core/verify';

export interface Bundle {
  meta: { eval_date: string; latest_trading_day: string; t5_trading_day: string; fetched_at: string; generated_at: string; recent_trading_days: string[] };
  entities: Entity[];
  personas: KycProfile[];
  items: EvalItem[];
  versions: AgentVersion[];
  prompts: PromptManifest[];
  prompt_text: Record<string, string>;
  router_prompt: string;
  judge_prompt: string;
  facts: Fact[];
  logs: AnswerLog[];
  judges: Record<string, JudgeResult>;
  fetch_log: { calls: { endpoint: string; params: Record<string, unknown>; http: number; code: number | null; message: string; request_id: string | null; ms: number; fetched_at: string; items: number | null }[]; anomalies: { kind: string; detail: string; request_id?: string | null }[] };
  hot: { latest: HotItem[]; stale: HotItem[] };
}

export interface Store {
  bundle: Bundle;
  evals: AnswerEval[];
  groups: InvarianceGroupResult[];
  feedback: Map<string, FeedbackEvent>;
  evalById: Map<string, AnswerEval>;
  logById: Map<string, AnswerLog>;
  itemById: Map<string, EvalItem>;
  personaById: Map<string, KycProfile>;
  versionById: Map<string, AgentVersion>;
  metrics: Record<string, MetricValue[]>;
  facts: FactIndex;
  evalMs: number;
}

export function buildStore(bundle: Bundle): Store {
  const t0 = performance.now();
  const out = runBatch({
    facts: bundle.facts,
    entities: bundle.entities,
    personas: bundle.personas,
    items: bundle.items,
    versions: bundle.versions,
    prompts: bundle.prompts,
    evalDate: bundle.meta.eval_date,
    latestTradingDay: bundle.meta.latest_trading_day,
    logs: bundle.logs,
    judges: bundle.judges,
  });
  const evalMs = performance.now() - t0;
  const metrics: Record<string, MetricValue[]> = {};
  for (const v of bundle.versions) {
    metrics[v.version_id] = computeMetrics(
      out.evals.filter((e) => e.version_id === v.version_id),
      out.groups.filter((g) => g.version_id === v.version_id),
    );
  }
  return {
    bundle,
    evals: out.evals,
    groups: out.groups,
    feedback: new Map(out.feedback.map((f) => [f.answer_id, f])),
    evalById: new Map(out.evals.map((e) => [e.answer_id, e])),
    logById: new Map(bundle.logs.map((l) => [l.answer_id, l])),
    itemById: new Map(bundle.items.map((i) => [i.item_id, i])),
    personaById: new Map(bundle.personas.map((p) => [p.persona_id, p])),
    versionById: new Map(bundle.versions.map((v) => [v.version_id, v])),
    metrics,
    facts: new FactIndex(bundle.facts),
    evalMs,
  };
}

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error('store not ready');
  return s;
}

/** 人工复核记录保存在浏览器本地（演示站点没有后端），可导出 JSON */
const REVIEW_KEY = 'iag.reviews.v1';
export function loadReviews(): Record<string, import('../core/types').HumanReview> {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_KEY) ?? '{}');
  } catch {
    return {};
  }
}
export function saveReviews(r: Record<string, import('../core/types').HumanReview>): void {
  try {
    localStorage.setItem(REVIEW_KEY, JSON.stringify(r));
  } catch {
    /* 隐私模式下可能不可用，忽略 */
  }
}

export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`);
