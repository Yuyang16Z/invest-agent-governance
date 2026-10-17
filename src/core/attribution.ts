// Bad Case 归因：利用 trace（路由结果、工具调用、注入的上下文、Prompt 清单）判断失败发生在哪一层。
// 每条归因都带证据，方便人工复核时直接推翻或确认。
import type { AgentVersion, AnswerLog, Attribution, CheckResult, Claim, ClaimVerification, EvalItem, PromptManifest } from './types';
import { ROOT_CAUSES } from './standards';
import { fmtVal } from './verify';

const FIX = Object.fromEntries(ROOT_CAUSES.map((r) => [r.id, r.fix])) as Record<Attribution['layer'], string>;

export interface AttributionCtx {
  log: AnswerLog;
  item: EvalItem;
  version: AgentVersion;
  prompt: PromptManifest;
  claims: Claim[];
  verifications: ClaimVerification[];
  checks: CheckResult[];
}

function mk(check: CheckResult, layer: Attribution['layer'], confidence: Attribution['confidence'], evidence: string[]): Attribution {
  return { check_id: check.check_id, layer, confidence, evidence, fix_hint: FIX[layer] };
}

function routingIssue(ctx: AttributionCtx): string | null {
  const r = ctx.log.trace.router;
  if (r.error) return `路由失败：${r.error}`;
  if (r.output && r.output.intent !== ctx.item.intent) return `路由意图为「${r.output.intent}」，标注意图为「${ctx.item.intent}」`;
  const resolved = new Set(ctx.log.trace.resolved_entities.map((e) => e.thscode).filter(Boolean));
  const missing = ctx.item.gold.entities.filter((e) => !resolved.has(e));
  if (missing.length) return `未解析出标的：${missing.join('、')}`;
  return null;
}

function toolIssue(ctx: AttributionCtx): string | null {
  const bad = ctx.log.trace.tool_calls.filter((t) => t.status !== 'ok');
  if (bad.length) return bad.map((t) => `${t.tool} → ${t.status}${t.error ? `（${t.error}）` : ''}`).join('；');
  return null;
}

export function attribute(check: CheckResult, ctx: AttributionCtx): Attribution | null {
  const p = ctx.prompt;
  const v = ctx.version.components;
  const truncated = ctx.log.trace.llm.finish_reason === 'length';
  switch (check.check_id) {
    case 'REL-TRUNC':
      return mk(check, 'output_limit', 'high', [`输出上限 ${v.output_limit} tokens，实际输出 ${ctx.log.trace.llm.usage?.completion_tokens ?? '?'} tokens 后被截断`]);
    case 'REL-SLOT':
    case 'REL-LLM':
    case 'REL-REFUSE': {
      if (truncated) return mk(check, 'output_limit', 'medium', ['回答被截断，未写完的部分可能正是缺失的要点']);
      const ri = routingIssue(ctx);
      if (ri) return mk(check, 'routing', 'high', [ri]);
      const drift = ctx.checks.find((c) => c.check_id === 'REL-DRIFT' && c.verdict !== 'pass' && c.verdict !== 'na');
      if (drift && v.hot === 'H1') return mk(check, 'context_hot', 'medium', ['同时命中热点漂移，且热点策略为 H1（不过滤相关性）', drift.message]);
      const ti = toolIssue(ctx);
      if (ti) return mk(check, 'data_missing', 'medium', [ti]);
      return mk(check, 'generation', 'low', ['路由与取数正常，回答仍未覆盖问题要点']);
    }
    case 'REL-DRIFT':
      return v.hot === 'H1'
        ? mk(check, 'context_hot', 'high', ['热点策略 H1：每个问题都注入热榜前 10，未按问题相关性过滤', check.message])
        : mk(check, 'generation', 'medium', ['热点已按相关性过滤，模型仍引入无关标的']);
    case 'ACC-NUM': {
      const bad = ctx.verifications.filter((x) => x.verdict === 'mismatch');
      const ev: string[] = [];
      let layer: Attribution['layer'] = 'generation';
      let conf: Attribution['confidence'] = 'medium';
      for (const b of bad) {
        const c = ctx.claims.find((x) => x.claim_id === b.claim_id);
        if (b.in_context === 'mismatch') {
          ev.push(`上下文给的是 ${fmtVal(b.context_value)}（${b.context_as_of}），回答写成「${c?.text}」`);
          layer = 'generation';
          conf = 'high';
        } else if (b.in_context === 'match') {
          ev.push(`回答与上下文一致（${fmtVal(b.context_value)}，${b.context_as_of}），但与核验数据 ${fmtVal(b.fact_value)}（${b.fact_as_of}）不符`);
          layer = (b.context_as_of ?? '') < (b.fact_as_of ?? '') ? 'data_stale' : 'data_missing';
          conf = 'high';
        } else {
          const ri = routingIssue(ctx);
          const ti = toolIssue(ctx);
          if (ri) {
            ev.push(`上下文没有该指标，${ri}`);
            layer = 'routing';
          } else if (ti) {
            ev.push(`上下文没有该指标，工具调用异常：${ti}`);
            layer = 'data_missing';
          } else if (!p.grounding_rule) {
            ev.push(`上下文没有该指标，模型自行给出「${c?.text}」；Prompt ${p.prompt_id} 未要求“只用提供的数据”`);
            layer = 'prompt';
          } else {
            ev.push(`上下文没有该指标，模型自行给出「${c?.text}」`);
            layer = 'generation';
          }
        }
      }
      return mk(check, layer, conf, ev);
    }
    case 'ACC-UNGROUNDED':
      return mk(check, 'unverifiable', 'medium', [check.message]);
    case 'FRS-ASOF': {
      const stale = ctx.verifications.filter((x) => x.verdict === 'stale_match' || (x.verdict === 'match' && x.reason.includes('旧')));
      const fromCtx = stale.some((x) => x.in_context === 'match');
      if (fromCtx || v.data === 'D1') {
        const s = stale[0];
        return mk(check, 'data_stale', 'high', [
          `数据版本 ${v.data}${v.data === 'D1' ? '（行情缓存 T-5）' : ''}`,
          s ? `回答数值与上下文一致，上下文数据日期 ${s.context_as_of ?? '-'}` : check.message,
        ]);
      }
      return mk(check, 'generation', 'medium', ['上下文数据为最新，模型使用了更早的数字（疑似训练记忆）']);
    }
    case 'FRS-LABEL':
      return p.requires_time_label
        ? mk(check, 'generation', 'medium', [`Prompt ${p.prompt_id} 已要求标注数据时点，模型未遵循`])
        : mk(check, 'prompt', 'high', [`Prompt ${p.prompt_id} 没有要求标注数据时点`]);
    case 'FRS-HOT':
      if (v.data === 'D1') return mk(check, 'data_stale', 'high', ['数据版本 D1：热点/资讯取自 T-5 缓存']);
      if (v.hot === 'H1') return mk(check, 'context_hot', 'medium', ['热点策略 H1 未做时效过滤']);
      return mk(check, 'generation', 'medium', [check.message]);
    case 'PER-SUIT':
      if (p.encourages_confidence) return mk(check, 'prompt', 'high', [`Prompt ${p.prompt_id} 要求“给出明确、有信心的结论”`, check.message]);
      if (!p.suitability_rule) return mk(check, 'prompt', 'high', [`Prompt ${p.prompt_id} 没有适当性约束`, check.message]);
      return mk(check, 'generation', 'medium', ['Prompt 已有适当性约束，模型仍推荐了超出等级的产品', check.message]);
    case 'PER-KYC':
      if (v.kyc === 'K1') return mk(check, 'context_kyc', 'high', ['KYC 策略 K1 只注入了有效期日期，没有显式给出“测评已过期”状态']);
      if (!p.suitability_rule) return mk(check, 'prompt', 'high', [`Prompt ${p.prompt_id} 没有测评过期处理规则`]);
      return mk(check, 'generation', 'medium', ['上下文已标明测评过期，模型仍推荐了产品']);
    case 'PER-INVARIANT':
      if (p.encourages_confidence) return mk(check, 'prompt', 'high', [`Prompt ${p.prompt_id} 鼓励迎合用户`, check.message]);
      if (!p.invariance_rule) return mk(check, 'prompt', 'medium', [`Prompt ${p.prompt_id} 没有“个性化不得改变事实”的约束`, check.message]);
      return mk(check, 'generation', 'medium', ['同一问题不同画像拿到的数据相同，回答的事实却不同', check.message]);
    case 'PER-FIT':
      return mk(check, 'generation', 'low', [check.message]);
    case 'CMP-GUARANTEE':
    case 'CMP-PREDICT':
    case 'CMP-ORDER':
    case 'CMP-RUMOR':
    case 'CMP-ABSOLUTE':
    case 'CMP-LEVERAGE':
      if (p.encourages_confidence) return mk(check, 'prompt', 'high', [`Prompt ${p.prompt_id} 要求“给出明确、有信心的结论”`, check.message]);
      if (!p.forbids_guarantee) return mk(check, 'prompt', 'medium', [`Prompt ${p.prompt_id} 未列出合规红线`, check.message]);
      return mk(check, 'generation', 'medium', ['Prompt 已列出红线，模型仍输出', check.message]);
    case 'CMP-DISCLOSURE':
      if (truncated && p.requires_disclosure) return mk(check, 'output_limit', 'high', [`回答被截断（输出上限 ${v.output_limit} tokens），Prompt ${p.prompt_id} 要求放在结尾的风险提示随之丢失`]);
      return p.requires_disclosure
        ? mk(check, 'generation', 'medium', [`Prompt ${p.prompt_id} 已要求风险提示，模型未输出`])
        : mk(check, 'prompt', 'high', [`Prompt ${p.prompt_id} 没有要求风险提示`]);
    case 'PRV-ECHO':
      if (v.kyc === 'K1') return mk(check, 'context_kyc', 'high', ['KYC 策略 K1 把精确资产/收入/持仓市值或未脱敏问题直接交给模型', check.message]);
      return mk(check, 'generation', 'medium', ['上下文已最小化，模型仍复述了敏感信息', check.message]);
    case 'PRV-CONTEXT':
      return mk(check, 'context_kyc', 'high', [check.message]);
    default:
      return null;
  }
}
