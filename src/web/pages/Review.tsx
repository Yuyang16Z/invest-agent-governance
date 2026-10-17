import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { loadReviews, saveReviews, useStore } from '../store';
import { AnswerText, Badge, CaseLink, OverallBadge, Section, VerdictBadge } from '../ui';
import { DIMENSIONS, ROOT_CAUSES } from '../../core/standards';
import type { DimensionId, HumanReview, RootCauseLayer } from '../../core/types';
import { REASON_LABEL } from './Cases';

export function Review() {
  const s = useStore();
  const [q, setQ] = useSearchParams();
  const vid = q.get('version') ?? 'V5';
  const open = q.get('open');
  const [reviews, setReviews] = useState<Record<string, HumanReview>>(() => loadReviews());
  const queue = useMemo(
    () =>
      s.evals
        .filter((e) => e.version_id === vid && e.review_reasons.length)
        .sort((x, y) => (y.review_reasons[0]?.priority ?? 0) - (x.review_reasons[0]?.priority ?? 0)),
    [s, vid],
  );
  const current = open ? s.evalById.get(open) : undefined;
  const log = open ? s.logById.get(open) : undefined;
  const [draft, setDraft] = useState<HumanReview | null>(null);
  const r = draft && draft.answer_id === open ? draft : open ? reviews[open] ?? { answer_id: open, reviewer: '复核员', reviewed_at: '', decisions: {}, comment: '' } : null;

  const save = () => {
    if (!r) return;
    const next = { ...reviews, [r.answer_id]: { ...r, reviewed_at: new Date().toISOString() } };
    setReviews(next);
    saveReviews(next);
    setDraft(null);
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(Object.values(reviews), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'human_reviews.json';
    a.click();
  };
  const stats = useMemo(() => {
    const done = Object.values(reviews).filter((x) => s.evalById.get(x.answer_id)?.version_id === vid);
    const per = DIMENSIONS.map((d) => {
      const ds = done.map((x) => x.decisions[d.id]).filter(Boolean);
      return { d, n: ds.length, overridden: ds.filter((x) => x !== 'agree').length };
    });
    return { done: done.length, per };
  }, [reviews, s, vid]);

  return (
    <div className="page">
      <div className="intro">
        <p>
          自动评测不全量送人工：只有高危命中、无法核验、评审分歧、负反馈但评测通过、画像不变性违规，以及按 answer_id 哈希抽取的 5% 校准样本，才会进入这里。复核员逐维度给出“同意 / 推翻”，推翻率用来校准规则和评审 Prompt。复核记录保存在本浏览器，可导出。
        </p>
      </div>
      <div className="filters">
        <select value={vid} onChange={(e) => setQ({ version: e.target.value })}>
          {s.bundle.versions.map((v) => (
            <option key={v.version_id} value={v.version_id}>
              {v.label}
            </option>
          ))}
        </select>
        <span className="muted">
          队列 {queue.length} 条 · 已复核 {stats.done} 条
        </span>
        <button onClick={exportJson}>导出复核记录 JSON</button>
      </div>
      <div className="grid-review">
        <div className="queue">
          {queue.map((e) => (
            <button key={e.answer_id} className={`qitem ${e.answer_id === open ? 'on' : ''}`} onClick={() => setQ({ version: vid, open: e.answer_id })}>
              <div>
                <code>{e.answer_id}</code> <OverallBadge v={e.overall} /> {reviews[e.answer_id] ? <Badge kind="pass">已复核</Badge> : null}
              </div>
              <div className="muted">
                {e.review_reasons.map((x) => REASON_LABEL[x.reason]).join(' · ')}
              </div>
            </button>
          ))}
        </div>
        <div>
          {current && log && r ? (
            <Section title={`复核 ${current.answer_id}`} right={<CaseLink id={current.answer_id}>查看完整详情</CaseLink>}>
              <p>
                <b>问题</b>：{log.question_masked}
              </p>
              <AnswerText ev={current} text={log.answer} />
              <ul className="reasons-list">
                {current.review_reasons.map((x) => (
                  <li key={x.reason}>
                    <b>{REASON_LABEL[x.reason]}</b>：{x.detail}
                  </li>
                ))}
              </ul>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>维度</th>
                    <th>自动结论</th>
                    <th>复核意见</th>
                  </tr>
                </thead>
                <tbody>
                  {DIMENSIONS.map((d) => (
                    <tr key={d.id}>
                      <td title={current.checks.filter((c) => c.dimension === d.id && c.verdict !== 'pass' && c.verdict !== 'na').map((c) => c.message).join('\n')}>{d.label}</td>
                      <td>
                        <VerdictBadge v={current.dimensions[d.id]} />
                      </td>
                      <td>
                        {(['agree', 'override_pass', 'override_fail'] as const).map((opt) => (
                          <label key={opt} className="radio">
                            <input type="radio" name={d.id} checked={r.decisions[d.id as DimensionId] === opt} onChange={() => setDraft({ ...r, decisions: { ...r.decisions, [d.id]: opt } })} />
                            {opt === 'agree' ? '同意' : opt === 'override_pass' ? '改判合格' : '改判不合格'}
                          </label>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="form-row">
                根因
                <select value={r.root_cause ?? ''} onChange={(e) => setDraft({ ...r, root_cause: (e.target.value || undefined) as RootCauseLayer | undefined })}>
                  <option value="">（同意自动归因）</option>
                  {ROOT_CAUSES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <textarea placeholder="复核说明（例如：数字识别把区间涨跌幅当成当日涨跌幅，属平台误判）" value={r.comment} onChange={(e) => setDraft({ ...r, comment: e.target.value })} />
              <button className="primary" onClick={save}>
                保存复核
              </button>
              {reviews[current.answer_id]?.reviewed_at ? <span className="muted"> 已保存于 {reviews[current.answer_id].reviewed_at.slice(0, 19)}</span> : null}
            </Section>
          ) : (
            <Section title="复核统计（本浏览器）">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>维度</th>
                    <th>已复核</th>
                    <th>推翻</th>
                    <th>推翻率</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.per.map((p) => (
                    <tr key={p.d.id}>
                      <td>{p.d.label}</td>
                      <td>{p.n}</td>
                      <td>{p.overridden}</td>
                      <td>{p.n ? `${((p.overridden / p.n) * 100).toFixed(0)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted">从左侧选择一条开始复核。</p>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
