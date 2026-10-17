// 用户行为反馈：本仓库没有真实线上用户，这里按公开写明的假设模型生成【模拟】信号，
// 只用于演示“反馈怎么用、不能怎么用”。假设参数见 FEEDBACK_ASSUMPTIONS，结论不能当实证。
import type { AnswerEval, FeedbackEvent } from './types';
import { hash32, rng } from './text';

export const FEEDBACK_ASSUMPTIONS = [
  '点踩概率 = 4% + 30%×相关性不合格 + 10%×数字错误 + 8%×时效不合格 + 15%×Agent 报错',
  '60 秒内改写重问概率 = 3% + 40%×（相关性不合格或槽位部分覆盖）',
  '点赞概率 = 18% + 12%×出现确定性/承诺性表述（用户偏好“有信心”的回答）+ 6%×个性化贴合 − 10%×相关性不合格',
  '追问数据来源概率 = 5% + 20%×未标注数据时点',
  '投诉概率 = 1% + 4%×隐私复述',
];

const failed = (e: AnswerEval, id: string) => e.checks.some((c) => c.check_id === id && c.verdict === 'fail');

export function simulateFeedback(e: AnswerEval, agentError: boolean): FeedbackEvent {
  const r = rng(hash32(`fb:${e.answer_id}`));
  const relFail = e.dimensions.relevance === 'fail';
  const slotWarn = e.checks.some((c) => c.check_id === 'REL-SLOT' && c.verdict === 'warn');
  const confident = failed(e, 'CMP-PREDICT') || failed(e, 'CMP-GUARANTEE') || failed(e, 'CMP-ORDER');
  const fit = e.checks.some((c) => c.check_id === 'PER-FIT' && c.verdict === 'pass');
  const pDown = 0.04 + 0.3 * +relFail + 0.1 * +(e.dimensions.accuracy === 'fail') + 0.08 * +(e.dimensions.freshness === 'fail') + 0.15 * +agentError;
  const pUp = Math.max(0, 0.18 + 0.12 * +confident + 0.06 * +fit - 0.1 * +relFail);
  const x = r();
  return {
    answer_id: e.answer_id,
    version_id: e.version_id,
    thumbs: x < pUp ? 'up' : x < pUp + pDown ? 'down' : null,
    rephrased_within_60s: r() < 0.03 + 0.4 * +(relFail || slotWarn),
    asked_data_source: r() < 0.05 + 0.2 * +failed(e, 'FRS-LABEL'),
    copied: r() < 0.12,
    complaint: r() < 0.01 + 0.04 * +(e.dimensions.privacy === 'fail'),
  };
}

export interface FeedbackSummary {
  n: number;
  up_rate: number;
  down_rate: number;
  rephrase_rate: number;
  source_rate: number;
  complaint_rate: number;
  /** 被点赞的回答中，有多少命中合规红线：说明“点赞率高 ≠ 质量好” */
  up_with_redline: number;
  /** 负反馈（点踩/改写/投诉）但自动评测通过：漏检候选，送人工 */
  negative_but_pass: string[];
}

export function summarizeFeedback(evals: AnswerEval[], fb: Map<string, FeedbackEvent>): FeedbackSummary {
  const rows = evals.map((e) => ({ e, f: fb.get(e.answer_id) })).filter((x): x is { e: AnswerEval; f: FeedbackEvent } => Boolean(x.f));
  const n = rows.length || 1;
  const redline = (e: AnswerEval) => e.checks.some((c) => c.dimension === 'compliance' && c.severity === 'high' && c.verdict === 'fail');
  return {
    n: rows.length,
    up_rate: rows.filter((x) => x.f.thumbs === 'up').length / n,
    down_rate: rows.filter((x) => x.f.thumbs === 'down').length / n,
    rephrase_rate: rows.filter((x) => x.f.rephrased_within_60s).length / n,
    source_rate: rows.filter((x) => x.f.asked_data_source).length / n,
    complaint_rate: rows.filter((x) => x.f.complaint).length / n,
    up_with_redline: rows.filter((x) => x.f.thumbs === 'up' && redline(x.e)).length,
    negative_but_pass: rows.filter((x) => (x.f.thumbs === 'down' || x.f.complaint || x.f.rephrased_within_60s) && x.e.overall === 'pass').map((x) => x.e.answer_id),
  };
}
