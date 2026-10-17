// DeepSeek（OpenAI 兼容）调用：超时、一次退避重试、记录耗时与 token。Key 只从环境变量读取。
export interface ChatResult {
  content: string;
  latency_ms: number;
  usage?: { prompt_tokens: number; completion_tokens: number };
  finish_reason?: string;
  error?: string;
}

const BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

export async function chat(opts: {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<ChatResult> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('缺少 DEEPSEEK_API_KEY（写在 .env）');
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120000);
    try {
      const r = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
          ],
          temperature: opts.temperature,
          max_tokens: opts.maxTokens ?? 1600,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      const j: any = await r.json().catch(() => null);
      clearTimeout(timer);
      if (!r.ok) {
        lastErr = `HTTP ${r.status} ${j?.error?.message ?? ''}`.trim();
        if (r.status === 429 || r.status >= 500) {
          await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
          continue;
        }
        return { content: '', latency_ms: Date.now() - t0, error: lastErr };
      }
      const ch = j?.choices?.[0];
      return {
        content: ch?.message?.content ?? '',
        latency_ms: Date.now() - t0,
        usage: j?.usage ? { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens } : undefined,
        finish_reason: ch?.finish_reason,
      };
    } catch (e: any) {
      clearTimeout(timer);
      lastErr = e?.name === 'AbortError' ? '请求超时' : String(e?.message ?? e);
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
  return { content: '', latency_ms: 0, error: lastErr };
}

export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}
