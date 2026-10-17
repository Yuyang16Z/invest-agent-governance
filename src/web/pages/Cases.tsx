import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useStore } from '../store';
import { AnswerText, Badge, CaseLink, CheckRow, ClaimTable, DimRow, OverallBadge, RootCauseLabel, Section } from '../ui';
import { DIMENSIONS, INTENT_LABEL, INTENT_STANDARDS, METRIC_BY_ID } from '../../core/standards';
import { fmtVal } from '../../core/verify';
import type { DimensionId, IntentId } from '../../core/types';

const REASON_LABEL: Record<string, string> = {
  high_risk_hit: '高危命中确认',
  unverifiable_fact: '无法核验',
  judge_disagree: '评审分歧',
  negative_feedback_pass: '负反馈但评测通过',
  calibration_sample: '校准抽样',
  invariance_violation: '画像不变性',
  agent_error: 'Agent 报错',
};
export { REASON_LABEL };

export function Cases() {
  const s = useStore();
  const [q, setQ] = useSearchParams();
  const nav = useNavigate();
  const version = q.get('version') ?? 'all';
  const intent = q.get('intent') ?? 'all';
  const dim = q.get('dim') ?? 'all';
  const overall = q.get('overall') ?? 'all';
  const metric = q.get('metric');
  const cause = q.get('cause');
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(q);
    if (v === 'all') n.delete(k);
    else n.set(k, v);
    setQ(n);
  };
  const rows = useMemo(() => {
    let r = s.evals;
    if (version !== 'all') r = r.filter((e) => e.version_id === version);
    if (intent !== 'all') r = r.filter((e) => e.intent === intent);
    if (dim !== 'all') r = r.filter((e) => ['fail', 'unverifiable'].includes(e.dimensions[dim as DimensionId]));
    if (overall !== 'all') r = r.filter((e) => e.overall === overall);
    if (cause) r = r.filter((e) => e.attributions.some((a) => a.layer === cause));
    if (metric && version !== 'all') {
      const m = s.metrics[version].find((x) => x.id === metric);
      if (m) {
        const ids = new Set(m.failing);
        r = metric === 'invariance' ? r.filter((e) => e.checks.some((c) => c.check_id === 'PER-INVARIANT' && c.verdict === 'fail')) : r.filter((e) => ids.has(e.answer_id));
      }
    }
    return r;
  }, [s, version, intent, dim, overall, metric, cause]);
  const metricLabel = metric && version !== 'all' ? s.metrics[version].find((x) => x.id === metric)?.label : null;

  return (
    <div className="page">
      <div className="filters">
        <select value={version} onChange={(e) => set('version', e.target.value)}>
          <option value="all">全部版本</option>
          {s.bundle.versions.map((v) => (
            <option key={v.version_id} value={v.version_id}>
              {v.label}
            </option>
          ))}
        </select>
        <select value={intent} onChange={(e) => set('intent', e.target.value)}>
          <option value="all">全部意图</option>
          {INTENT_STANDARDS.map((st) => (
            <option key={st.intent} value={st.intent}>
              {st.label}
            </option>
          ))}
        </select>
        <select value={dim} onChange={(e) => set('dim', e.target.value)}>
          <option value="all">任意维度</option>
          {DIMENSIONS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}不合格
            </option>
          ))}
        </select>
        <select value={overall} onChange={(e) => set('overall', e.target.value)}>
          <option value="all">全部结论</option>
          <option value="pass">合格</option>
          <option value="review">待复核</option>
          <option value="fail">不合格</option>
        </select>
        {metricLabel ? (
          <span className="chip">
            指标未达标：{metricLabel}{' '}
            <button onClick={() => set('metric', 'all')}>×</button>
          </span>
        ) : null}
        {cause ? (
          <span className="chip">
            根因：<RootCauseLabel id={cause as never} /> <button onClick={() => set('cause', 'all')}>×</button>
          </span>
        ) : null}
        <span className="muted">{rows.length} 条</span>
      </div>
      <table className="tbl clickable">
        <thead>
          <tr>
            <th>回答 ID</th>
            <th>版本</th>
            <th>意图</th>
            <th>画像</th>
            <th>问题</th>
            <th>结论</th>
            <th>六维</th>
            <th>根因</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.answer_id} onClick={() => nav(`/cases/${encodeURIComponent(e.answer_id)}`)}>
              <td>
                <code>{e.answer_id}</code>
              </td>
              <td>{e.version_id}</td>
              <td>{INTENT_LABEL[e.intent]}</td>
              <td>{s.personaById.get(e.persona_id)?.label}</td>
              <td className="q">{s.logById.get(e.answer_id)?.question_masked}</td>
              <td>
                <OverallBadge v={e.overall} />
              </td>
              <td>
                <DimRow ev={e} />
              </td>
              <td>
                {[...new Set(e.attributions.map((a) => a.layer))].map((l) => (
                  <RootCauseLabel key={l} id={l} />
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CaseDetail() {
  const { id = '' } = useParams();
  const s = useStore();
  const ev = s.evalById.get(id);
  const log = s.logById.get(id);
  if (!ev || !log) return <div className="page">未找到 {id}</div>;
  const item = s.itemById.get(ev.item_id)!;
  const persona = s.personaById.get(ev.persona_id)!;
  const version = s.versionById.get(ev.version_id)!;
  const judge = s.bundle.judges[id];
  const fb = s.feedback.get(id);
  const siblings = s.evals.filter((e) => e.item_id === ev.item_id && e.answer_id !== id);
  const t = log.trace;

  return (
    <div className="page">
      <div className="case-head">
        <h1>
          <code>{id}</code> <OverallBadge v={ev.overall} />
        </h1>
        <div className="muted">
          {version.label} · {INTENT_LABEL[item.intent as IntentId]} · 画像 {persona.label}（C{persona.risk_level}，{persona.experience_years} 年经验，测评有效期至 {persona.expires_at}）
        </div>
        <div className="muted">
          同题其他版本：
          {siblings.map((x) => (
            <span key={x.answer_id}>
              {' '}
              <CaseLink id={x.answer_id}>{x.version_id}</CaseLink>
            </span>
          ))}
          {' · '}
          <Link to={`/review?version=${ev.version_id}&open=${encodeURIComponent(id)}`}>人工复核此条</Link>
        </div>
        {ev.review_reasons.length ? (
          <div className="reasons">
            送人工复核：
            {ev.review_reasons.map((r) => (
              <Badge key={r.reason} kind={r.priority >= 3 ? 'fail' : r.priority === 2 ? 'warn' : 'na'} title={r.detail}>
                {REASON_LABEL[r.reason]}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid2">
        <Section title="问题与回答" right={<span className="legend"><mark className="m-ok">一致</mark><mark className="m-bad">不符</mark><mark className="m-stale">旧数据</mark><mark className="m-unk">无法核验</mark><mark className="m-rule">规则命中</mark></span>}>
          <p>
            <b>问题（入库已脱敏）</b>：{log.question_masked}
          </p>
          <AnswerText ev={ev} text={log.answer} />
        </Section>
        <div>
          <Section title="检查结果">
            {DIMENSIONS.map((d) => {
              const cs = ev.checks.filter((c) => c.dimension === d.id);
              return (
                <div key={d.id} className="dim-block">
                  <h3>
                    {d.label} <span className="muted">（{d.problem}）</span>
                  </h3>
                  {cs.map((c) => (
                    <CheckRow key={c.check_id} c={c} />
                  ))}
                </div>
              );
            })}
          </Section>
          <Section title="Bad Case 归因">
            {ev.attributions.length === 0 ? <p className="muted">没有失败项。</p> : null}
            {ev.attributions.map((a, i) => (
              <div key={i} className="attr">
                <RootCauseLabel id={a.layer} /> <code>{a.check_id}</code> <span className="muted">置信度 {a.confidence}</span>
                <ul>
                  {a.evidence.map((x, j) => (
                    <li key={j}>{x}</li>
                  ))}
                </ul>
                <div className="muted">修复建议：{a.fix_hint}</div>
              </div>
            ))}
          </Section>
        </div>
      </div>

      <Section title="数字声明与数据核验">
        <ClaimTable claims={ev.claims} verifications={ev.verifications} />
      </Section>

      <div className="grid2">
        <Section title="Agent 运行 Trace">
          <p>
            <b>组件</b>：模型 {version.components.model} · Prompt {version.components.prompt} · 数据 {version.components.data} · 热点 {version.components.hot} · KYC {version.components.kyc}
          </p>
          <p>
            <b>路由输出</b>：<code>{JSON.stringify(t.router.output)}</code>（{t.router.latency_ms} ms）
          </p>
          <p>
            <b>实体解析</b>：{t.resolved_entities.map((r) => `${r.mention}→${r.thscode ?? '未解析'}`).join('，') || '无'}
          </p>
          <p>
            <b>工具调用</b>：
          </p>
          <ul>
            {t.tool_calls.map((c, i) => (
              <li key={i}>
                {c.tool} <code>{JSON.stringify(c.params)}</code> → {c.status}（{c.data_version}{c.as_of ? `，as_of ${c.as_of}` : ''}）
              </li>
            ))}
          </ul>
          <details>
            <summary>注入的数据（{t.context.data.length} 条）</summary>
            <table className="tbl small">
              <tbody>
                {t.context.data.map((d) => (
                  <tr key={d.fact_key}>
                    <td>{d.entity}</td>
                    <td>{METRIC_BY_ID[d.metric]?.label ?? d.metric}</td>
                    <td>{fmtVal(d.value)}</td>
                    <td>{d.as_of}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          <details>
            <summary>
              注入的热点（{t.context.hot_policy}，{t.context.hot_items.length} 条）与资讯（{t.context.news.length} 条）
            </summary>
            <ul>
              {t.context.hot_items.map((h, i) => (
                <li key={i}>
                  {h.published_at} {h.title}
                </li>
              ))}
              {t.context.news.map((n, i) => (
                <li key={`n${i}`}>
                  {n.published_at} {n.title}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>注入的 KYC（{t.context.kyc_policy}）</summary>
            <pre>{JSON.stringify(t.context.kyc_payload, null, 1)}</pre>
          </details>
          <p className="muted">
            生成：{t.llm.model} · {t.llm.prompt_version} · {t.llm.latency_ms} ms · tokens {t.llm.usage ? `${t.llm.usage.prompt_tokens}/${t.llm.usage.completion_tokens}` : '—'}
          </p>
        </Section>
        <Section title="LLM 评审与用户反馈">
          {judge ? (
            <>
              <p>
                相关性 <b>{judge.relevance}/2</b> · 个性化 {judge.personalization ?? '—'} · 置信度 {judge.confidence} · 疑似因画像改口 {judge.fact_bending_suspected ? '是' : '否'}
              </p>
              <p>{judge.reason}</p>
              <details>
                <summary>评审原始输出（{judge.model}，{judge.latency_ms} ms）</summary>
                <pre>{judge.raw}</pre>
              </details>
            </>
          ) : (
            <p className="muted">无评审结果</p>
          )}
          {fb ? (
            <p className="muted">
              用户行为（模拟信号）：{fb.thumbs === 'up' ? '点赞' : fb.thumbs === 'down' ? '点踩' : '未评价'}
              {fb.rephrased_within_60s ? ' · 60 秒内改写重问' : ''}
              {fb.asked_data_source ? ' · 追问数据来源' : ''}
              {fb.complaint ? ' · 投诉' : ''}
            </p>
          ) : null}
        </Section>
      </div>
    </div>
  );
}
