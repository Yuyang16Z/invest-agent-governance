// 调试用：打印指定回答的检查结论
import fs from 'node:fs';
import { runBatch } from '../src/core/pipeline';
import { PERSONAS } from '../src/seed/personas';
import { ITEMS } from '../src/seed/questions';
import { PROMPTS, VERSIONS } from '../src/seed/versions';
const b = JSON.parse(fs.readFileSync('public/data/bundle.json', 'utf8'));
const out = runBatch({ facts: b.facts, entities: b.entities, personas: PERSONAS, items: ITEMS, versions: VERSIONS, prompts: PROMPTS, evalDate: b.meta.eval_date, latestTradingDay: b.meta.latest_trading_day, logs: b.logs, judges: b.judges });
for (const id of process.argv.slice(2)) {
  const e = out.evals.find((x) => x.answer_id === id)!;
  console.log(`== ${id} overall=${e.overall} dims=${JSON.stringify(e.dimensions)} reasons=${e.review_reasons.map((r) => r.reason).join(',')}`);
  for (const c of e.checks.filter((c) => c.verdict === 'fail' || c.verdict === 'unverifiable')) console.log(`   ${c.check_id} ${c.verdict}: ${c.message.slice(0, 120)}`);
  for (const a of e.attributions) console.log(`   -> ${a.check_id} ${a.layer}: ${a.evidence[0]?.slice(0, 80)}`);
}
