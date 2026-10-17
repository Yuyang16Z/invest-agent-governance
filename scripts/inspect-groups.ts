// 调试用：打印画像不变性问题组的逐画像取值
import fs from 'node:fs';
import { runBatch } from '../src/core/pipeline';
import { PERSONAS } from '../src/seed/personas';
import { ITEMS } from '../src/seed/questions';
import { PROMPTS, VERSIONS } from '../src/seed/versions';
const b = JSON.parse(fs.readFileSync('public/data/bundle.json', 'utf8'));
const out = runBatch({ facts: b.facts, entities: b.entities, personas: PERSONAS, items: ITEMS, versions: VERSIONS, prompts: PROMPTS, evalDate: b.meta.eval_date, latestTradingDay: b.meta.latest_trading_day, logs: b.logs, judges: b.judges });
for (const g of out.groups.filter((x) => process.argv.slice(2).includes(x.version_id))) {
  console.log(`${g.version_id} ${g.group_id} ${g.verdict}`);
  for (const r of g.rows) console.log(`   ${r.metric} truth=${r.truth} ` + r.values.map((v) => `${v.persona_id}:${v.text ?? '∅'}`).join(' '));
  for (const i of g.issues) console.log('   ! ' + i);
}
