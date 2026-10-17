// LLM 评审（AI 角色之一）：只判“答没答到问题”和“个性化是否恰当”，不判数字对错（数字交给数据核验）。
// 用法：npm run run:judge   输出 data/judge/<版本>.json，含原始输出、耗时，便于追溯与复现。
import fs from 'node:fs';
import path from 'node:path';
import type { AnswerLog, JudgeResult } from '../src/core/types';
import { INTENT_LABEL } from '../src/core/standards';
import { horizonLabel } from '../src/core/privacy';
import { PERSONAS } from '../src/seed/personas';
import { ITEMS } from '../src/seed/questions';
import { VERSIONS } from '../src/seed/versions';
import { chat, pool } from './llm';
import { JUDGE_ID, JUDGE_MODEL, JUDGE_PROMPT } from '../src/seed/judge';

async function main() {
  const personas = new Map(PERSONAS.map((p) => [p.persona_id, p]));
  const items = new Map(ITEMS.map((i) => [i.item_id, i]));
  fs.mkdirSync('data/judge', { recursive: true });
  for (const v of VERSIONS) {
    const file = path.join('data/logs', `${v.version_id}.jsonl`);
    if (!fs.existsSync(file)) continue;
    const out = path.join('data/judge', `${v.version_id}.json`);
    const prev: Record<string, JudgeResult> = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
    const logs: AnswerLog[] = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const todo = logs.filter((l) => l.status === 'ok' && (!prev[l.answer_id] || prev[l.answer_id].error));
    console.log(`${v.version_id}: judging ${todo.length}`);
    await pool(todo, 10, async (l) => {
      const it = items.get(l.item_id)!;
      const p = personas.get(l.persona_id)!;
      const user = `【问题意图】${INTENT_LABEL[it.intent]}\n【问题】${l.question_masked}\n【用户画像（L1 摘要）】风险等级 C${p.risk_level}（${p.risk_label}）；投资期限 ${horizonLabel(p.horizon)}；投资经验 ${p.experience_years} 年；目标：${p.objective}；持仓：${p.holdings.map((h) => h.name).join('、') || '无'}\n【回答】\n${l.answer}`;
      const r = await chat({ model: JUDGE_MODEL, system: JUDGE_PROMPT, user, temperature: 0, json: true, maxTokens: 2500 });
      let res: JudgeResult;
      try {
        const o = JSON.parse(r.content);
        res = {
          judge_id: JUDGE_ID,
          model: JUDGE_MODEL,
          relevance: [0, 1, 2].includes(o.relevance) ? o.relevance : 1,
          personalization: o.personalization === null || o.personalization === undefined ? null : [0, 1, 2].includes(o.personalization) ? o.personalization : null,
          missing: Array.isArray(o.missing) ? o.missing.map(String) : [],
          drift_to_hot: Boolean(o.drift_to_hot),
          fact_bending_suspected: Boolean(o.fact_bending_suspected),
          confidence: typeof o.confidence === 'number' ? o.confidence : 0.5,
          reason: String(o.reason ?? ''),
          latency_ms: r.latency_ms,
          raw: r.content,
        };
      } catch {
        res = { judge_id: JUDGE_ID, model: JUDGE_MODEL, relevance: 1, personalization: null, missing: [], drift_to_hot: false, fact_bending_suspected: false, confidence: 0, reason: '', latency_ms: r.latency_ms, raw: r.content, error: r.error ?? '评审输出无法解析为 JSON' };
      }
      prev[l.answer_id] = res;
      process.stdout.write(res.error ? 'x' : '.');
    });
    fs.writeFileSync(out, JSON.stringify(prev, null, 1));
    console.log(`\n${v.version_id}: ${Object.keys(prev).length} judged`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
