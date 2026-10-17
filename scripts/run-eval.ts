// 评测与打包：读取事实快照、Agent 日志、LLM 评审结果 → 跑评测 → 输出网页数据包与可追溯的评测报告。
// 用法：npm run eval
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { AnswerLog, Entity, Fact, JudgeResult } from '../src/core/types';
import { runBatch } from '../src/core/pipeline';
import { computeMetrics } from '../src/core/metrics';
import { attributionScope, componentDiff, pairedStats, rootCauseShift, runGate } from '../src/core/compare';
import { summarizeFeedback } from '../src/core/feedback';
import { ROOT_CAUSE_LABEL } from '../src/core/standards';
import { PERSONAS } from '../src/seed/personas';
import { ITEMS } from '../src/seed/questions';
import { PROMPT_TEXT, PROMPTS, ROUTER_PROMPT, VERSIONS } from '../src/seed/versions';
import { FUND_MASTER } from '../src/seed/universe';
import { JUDGE_PROMPT } from '../src/seed/judge';

const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
const facts: Fact[] = read('data/facts/facts.json');
const fetched: Entity[] = read('data/facts/entities.json');
const entities: Entity[] = fetched.map((e) => ({ ...e, risk_level: FUND_MASTER.find((f) => f.thscode === e.thscode)?.risk_level ?? e.risk_level }));
const meta = read('data/facts/meta.json');
const fetchLog = read('data/facts/fetch_log.json');
const hot = read('data/facts/hot.json');

const logs: AnswerLog[] = [];
const judges: Record<string, JudgeResult> = {};
for (const v of VERSIONS) {
  const f = `data/logs/${v.version_id}.jsonl`;
  if (fs.existsSync(f)) logs.push(...fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const j = `data/judge/${v.version_id}.json`;
  if (fs.existsSync(j)) Object.assign(judges, read(j));
}

const input = {
  facts,
  entities,
  personas: PERSONAS,
  items: ITEMS,
  versions: VERSIONS,
  prompts: PROMPTS,
  evalDate: meta.eval_date,
  latestTradingDay: meta.latest_trading_day,
  logs,
  judges,
};

const t0 = Date.now();
const out = runBatch(input);
const ms = Date.now() - t0;
const fbMap = new Map(out.feedback.map((f) => [f.answer_id, f]));

const perVersion = VERSIONS.filter((v) => logs.some((l) => l.version_id === v.version_id)).map((v) => {
  const ev = out.evals.filter((e) => e.version_id === v.version_id);
  const gr = out.groups.filter((g) => g.version_id === v.version_id);
  return { version: v, n: ev.length, metrics: computeMetrics(ev, gr), feedback: summarizeFeedback(ev, fbMap) };
});

const pairs: [string, string][] = [
  ['V1', 'V2'],
  ['V2', 'V3'],
  ['V3', 'V4'],
  ['V3', 'V5'],
];
const comparisons = pairs
  .filter(([a, b]) => perVersion.some((p) => p.version.version_id === a) && perVersion.some((p) => p.version.version_id === b))
  .map(([a, b]) => {
    const va = VERSIONS.find((v) => v.version_id === a)!;
    const vb = VERSIONS.find((v) => v.version_id === b)!;
    const ea = out.evals.filter((e) => e.version_id === a);
    const eb = out.evals.filter((e) => e.version_id === b);
    const ga = out.groups.filter((g) => g.version_id === a);
    const gb = out.groups.filter((g) => g.version_id === b);
    const pending = eb.filter((e) => e.review_reasons.some((r) => r.reason === 'high_risk_hit')).length;
    const diff = componentDiff(va, vb);
    return { a, b, diff, scope: attributionScope(diff), stats: pairedStats(ea, eb), root_cause: rootCauseShift(ea, eb), gate: runGate(eb, gb, ea, ga, pending) };
  });

fs.mkdirSync('public/data', { recursive: true });
fs.mkdirSync('data/eval', { recursive: true });
const bundle = {
  meta: { ...meta, generated_at: new Date().toISOString() },
  entities,
  personas: PERSONAS,
  items: ITEMS,
  versions: VERSIONS,
  prompts: PROMPTS,
  prompt_text: PROMPT_TEXT,
  router_prompt: ROUTER_PROMPT,
  judge_prompt: JUDGE_PROMPT,
  facts,
  logs,
  judges,
  fetch_log: fetchLog,
  hot,
};
const bundleText = JSON.stringify(bundle);
fs.writeFileSync('public/data/bundle.json', bundleText);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const summary = {
  generated_at: new Date().toISOString(),
  bundle_sha256: sha(bundleText),
  eval_ms: ms,
  answers: logs.length,
  per_version: perVersion.map((p) => ({ version_id: p.version.version_id, label: p.version.label, n: p.n, metrics: p.metrics.map(({ failing, ...m }) => ({ ...m, failing_count: failing.length, failing_sample: failing.slice(0, 8) })), feedback: { ...p.feedback, negative_but_pass: p.feedback.negative_but_pass.length } })),
  comparisons: comparisons.map((c) => ({ ...c, stats: c.stats.map((s) => ({ ...s, regressions: s.regressions, improvements: s.improvements })) })),
};
fs.writeFileSync('data/eval/summary.json', JSON.stringify(summary, null, 1));

// ---------- 可追溯的评测报告 ----------
const pct = (v: number | null) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
const lines: string[] = [];
lines.push('# 评测报告（自动生成）', '');
lines.push(`> 由 \`npm run eval\` 生成于 ${summary.generated_at}；数据包 \`public/data/bundle.json\` 的 SHA-256 前 16 位：\`${summary.bundle_sha256}\`。`);
lines.push(`> 事实快照抓取于 ${meta.fetched_at}（扶摇），最近交易日 ${meta.latest_trading_day}，D1 旧缓存取 ${meta.t5_trading_day}。共 ${logs.length} 条 Agent 回答，评测耗时 ${ms} ms。`, '');
lines.push('## 各版本关键指标', '');
const ids = ['overall_pass', 'numeric_accuracy', 'freshness_pass', 'time_label', 'slot_coverage', 'llm_relevance', 'hot_drift', 'suitability', 'kyc_expiry', 'invariance', 'redline_rate', 'disclosure', 'privacy_leak', 'context_min'];
lines.push(`| 指标 | ${perVersion.map((p) => p.version.label).join(' | ')} |`);
lines.push(`|---|${perVersion.map(() => '---').join('|')}|`);
for (const id of ids) {
  const label = perVersion[0].metrics.find((m) => m.id === id)?.label ?? id;
  lines.push(`| ${label} | ${perVersion.map((p) => { const m = p.metrics.find((x) => x.id === id)!; return `${pct(m.value)}（${m.numerator}/${m.denominator}）`; }).join(' | ')} |`);
}
lines.push('', '口径见 `src/core/metrics.ts` 与网页“质量标准”页；每个比例括号内为分子/分母，可在网页“评测记录”中按版本与维度筛出对应回答。', '');
lines.push('## 版本对比与发布闸门', '');
for (const c of comparisons) {
  lines.push(`### ${c.a} → ${c.b}`, '', `- 组件变更：${c.diff.map((d) => `${d.component} ${d.from}→${d.to}`).join('；') || '无'}`, `- 归因范围：${c.scope}`);
  for (const s of c.stats) lines.push(`- ${s.label}：${s.pass_a}/${s.n} → ${s.pass_b}/${s.n}（Δ ${(s.delta * 100).toFixed(1)} pp，95% CI [${(s.ci95[0] * 100).toFixed(1)}, ${(s.ci95[1] * 100).toFixed(1)}]，McNemar p=${s.p_value.toFixed(3)}；退化 ${s.regressions.length}、改善 ${s.improvements.length}）`);
  lines.push(`- 根因变化：${c.root_cause.map((r) => `${ROOT_CAUSE_LABEL[r.layer]} ${r.a}→${r.b}`).join('；')}`);
  lines.push(`- 闸门（${c.b} 相对 ${c.a}）：**${c.gate.label}**；${c.gate.rules.map((r) => `${r.id}${r.ok ? '✓' : '✗'} ${r.detail}`).join('；')}`, '');
}
lines.push('## 用户行为反馈（模拟信号）', '', '以下为按 `src/core/feedback.ts` 中公开假设生成的模拟信号，只演示用法，不是实证结论。', '');
lines.push('| 版本 | 点赞率 | 点踩率 | 改写重问率 | 点赞回答中命中红线 | 负反馈但评测通过（送人工） |', '|---|---|---|---|---|---|');
for (const p of perVersion) lines.push(`| ${p.version.label} | ${pct(p.feedback.up_rate)} | ${pct(p.feedback.down_rate)} | ${pct(p.feedback.rephrase_rate)} | ${p.feedback.up_with_redline} | ${p.feedback.negative_but_pass.length} |`);
lines.push('', '## 接口与数据异常（抓取时真实记录）', '');
for (const a of fetchLog.anomalies) lines.push(`- ${a.kind}：${a.detail}${a.request_id ? `（request_id ${a.request_id}）` : ''}`);
fs.writeFileSync('docs/评测报告.md', lines.join('\n') + '\n');

console.log(`evaluated ${logs.length} answers in ${ms} ms; groups=${out.groups.length}; bundle=${(bundleText.length / 1024).toFixed(0)}KB sha=${summary.bundle_sha256}`);
for (const p of perVersion) console.log(p.version.version_id, p.metrics.filter((m) => ['overall_pass', 'numeric_accuracy', 'freshness_pass', 'redline_rate', 'privacy_leak', 'invariance', 'suitability'].includes(m.id)).map((m) => `${m.id}=${pct(m.value)}(${m.numerator}/${m.denominator})`).join(' '));
for (const c of comparisons) console.log(`${c.a}->${c.b}`, c.gate.label, c.stats[0].delta.toFixed(3), c.stats[0].p_value.toFixed(3));
