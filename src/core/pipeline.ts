// 批量评测：单条评测 → 画像不变性（组级）→ 模拟反馈 → 复核路由，供脚本与浏览器共用。
import type { AgentVersion, AnswerEval, AnswerLog, Entity, EvalItem, Fact, FeedbackEvent, InvarianceGroupResult, JudgeResult, KycProfile, PromptManifest } from './types';
import { FactIndex } from './verify';
import { evaluateAnswer, finalize, type EvalEnv } from './evaluate';
import { evaluateInvariance } from './personalization';
import { simulateFeedback } from './feedback';

export interface BatchInput {
  facts: Fact[];
  entities: Entity[];
  personas: KycProfile[];
  items: EvalItem[];
  versions: AgentVersion[];
  prompts: PromptManifest[];
  evalDate: string;
  latestTradingDay: string;
  logs: AnswerLog[];
  judges: Record<string, JudgeResult>;
}

export interface BatchOutput {
  evals: AnswerEval[];
  groups: InvarianceGroupResult[];
  feedback: FeedbackEvent[];
}

export function makeEnv(input: Omit<BatchInput, 'logs' | 'judges'>, judges?: Record<string, JudgeResult>, feedback?: Map<string, FeedbackEvent>, facts?: FactIndex): EvalEnv {
  return {
    facts: facts ?? new FactIndex(input.facts),
    entities: input.entities,
    personas: new Map(input.personas.map((p) => [p.persona_id, p])),
    items: new Map(input.items.map((i) => [i.item_id, i])),
    versions: new Map(input.versions.map((v) => [v.version_id, v])),
    prompts: new Map(input.prompts.map((p) => [p.prompt_id, p])),
    evalDate: input.evalDate,
    latestTradingDay: input.latestTradingDay,
    judges: judges ? new Map(Object.entries(judges)) : undefined,
    feedback,
  };
}

export function runBatch(input: BatchInput): BatchOutput {
  const env = makeEnv(input, input.judges);
  const evals = input.logs.map((l) => evaluateAnswer(l, env));
  const byId = new Map(evals.map((e) => [e.answer_id, e]));
  const logById = new Map(input.logs.map((l) => [l.answer_id, l]));

  // 画像不变性：按 版本 × 问题组 汇总
  const groups: InvarianceGroupResult[] = [];
  const truthOf = (entity: string, metric: string) => {
    if (metric === 'risk_level') return input.entities.find((e) => e.thscode === entity)?.risk_level ?? null;
    return env.facts.latest(entity, metric as never)?.value ?? null;
  };
  for (const v of input.versions) {
    const byGroup = new Map<string, { item: EvalItem; log: AnswerLog; ev: AnswerEval }[]>();
    for (const l of input.logs.filter((x) => x.version_id === v.version_id && x.status === 'ok')) {
      const item = env.items.get(l.item_id)!;
      const g = item.gold.invariance_group;
      if (!g) continue;
      const arr = byGroup.get(g) ?? [];
      arr.push({ item, log: l, ev: byId.get(l.answer_id)! });
      byGroup.set(g, arr);
    }
    for (const [g, members] of byGroup) if (members.length > 1) groups.push(evaluateInvariance(g, members, input.entities, env.personas, truthOf));
  }

  // 模拟用户反馈（基于第一轮评测结论），再统一收尾：维度、归因、复核路由
  const feedback = evals.map((e) => simulateFeedback(e, logById.get(e.answer_id)?.status === 'agent_error'));
  env.feedback = new Map(feedback.map((f) => [f.answer_id, f]));
  for (const e of evals) {
    const log = logById.get(e.answer_id)!;
    if (log.status !== 'ok') continue;
    const item = env.items.get(e.item_id)!;
    const version = env.versions.get(e.version_id);
    finalize(e, env, log, item, version, version ? env.prompts.get(version.components.prompt) : undefined);
  }
  return { evals, groups, feedback };
}
