// 调试用：列出某版本的数值不符项及上下文
import fs from 'node:fs';
import { runBatch } from '../src/core/pipeline';
import { PERSONAS } from '../src/seed/personas';
import { ITEMS } from '../src/seed/questions';
import { PROMPTS, VERSIONS } from '../src/seed/versions';
const b = JSON.parse(fs.readFileSync('public/data/bundle.json', 'utf8'));
const out = runBatch({ facts: b.facts, entities: b.entities, personas: PERSONAS, items: ITEMS, versions: VERSIONS, prompts: PROMPTS, evalDate: b.meta.eval_date, latestTradingDay: b.meta.latest_trading_day, logs: b.logs, judges: b.judges });
for (const e of out.evals.filter((x) => process.argv.slice(2).includes(x.version_id)))
  for (const v of e.verifications.filter((x) => x.verdict === 'mismatch')) {
    const c = e.claims.find((x) => x.claim_id === v.claim_id)!;
    const log = b.logs.find((l: any) => l.answer_id === e.answer_id);
    console.log(`${e.answer_id} ${c.entity} ${c.metric} "${c.text}" fact=${v.fact_value} ctx=${v.in_context}:${v.context_value} | …${log.answer.slice(Math.max(0, c.start - 40), c.end + 15).replace(/\n/g, ' ')}`);
  }
