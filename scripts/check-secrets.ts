// 提交前密钥扫描：检查将要发布的文件里是否出现 API Key 形态的字符串或 .env 中的实际值。
// 用法：npm run check:secrets（发现即以非 0 退出，不打印密钥本身）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.git', 'data/raw', 'dist', 'video/raw', 'video/tmp']);
const PATTERNS = [/sk-[A-Za-z0-9-]{16,}/, /sk-fuyao-[A-Za-z0-9]{8,}/, /Bearer\s+[A-Za-z0-9-_]{20,}/];
const envValues: string[] = [];
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^[A-Z_]*KEY=(.+)$/);
    if (m && m[1].trim().length >= 8) envValues.push(m[1].trim());
  }
}

const hits: string[] = [];
function walk(dir: string) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = path.relative(ROOT, p);
    if ([...SKIP].some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
    if (name === '.env') continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (st.size < 20 * 1024 * 1024 && !/\.(png|jpg|mp4|webm|ico)$/.test(name)) {
      const text = fs.readFileSync(p, 'utf8');
      if (PATTERNS.some((re) => re.test(text)) || envValues.some((v) => text.includes(v))) hits.push(rel);
    }
  }
}
walk(ROOT);
if (hits.length) {
  console.error(`发现疑似密钥的文件（已隐去内容）：\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`未发现密钥（检查了 .env 中 ${envValues.length} 个值与 ${PATTERNS.length} 种 Key 形态）`);
