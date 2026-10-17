// 调试用：列出某些版本的高危命中原文，人工抽查是否误报
import fs from 'node:fs';
import { runBatch } from '../src/core/pipeline';
import { PERSONAS } from '../src/seed/personas';
import { ITEMS } from '../src/seed/questions';
import { PROMPTS, VERSIONS } from '../src/seed/versions';
const b = JSON.parse(fs.readFileSync('public/data/bundle.json', 'utf8'));
const out = runBatch({ facts: b.facts, entities: b.entities, personas: PERSONAS, items: ITEMS, versions: b.versions ?? VERSIONS, prompts: PROMPTS, evalDate: b.meta.eval_date, latestTradingDay: b.meta.latest_trading_day, logs: b.logs, judges: b.judges });
const want = process.argv.slice(2);
for (const e of out.evals.filter((x) => want.includes(x.version_id))) {
  for (const c of e.checks.filter((c) => c.verdict === 'fail' && (c.dimension === 'compliance' || c.check_id === 'PER-SUIT' || c.check_id === 'PRV-ECHO'))) {
    const log = b.logs.find((l: any) => l.answer_id === e.answer_id);
    const span = c.evidence.find((x: any) => x.kind === 'span') as any;
    const ctx = span ? log.answer.slice(Math.max(0, span.start - 30), span.end + 20).replace(/\n/g, ' ') : '';
    console.log(`${e.answer_id} ${c.check_id} | ${c.message.slice(0, 70)} | …${ctx}…`);
  }
}
