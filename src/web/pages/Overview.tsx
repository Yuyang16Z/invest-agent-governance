import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, pct } from '../store';
import { MetricCard, Section, Badge } from '../ui';
import { DIMENSIONS, INTENT_STANDARDS, ROOT_CAUSE_LABEL } from '../../core/standards';
import { intentDimensionMatrix, rootCauseCounts } from '../../core/metrics';
import { runGate } from '../../core/compare';

const KPI = ['overall_pass', 'numeric_accuracy', 'freshness_pass', 'time_label', 'slot_coverage', 'llm_relevance', 'suitability', 'kyc_expiry', 'invariance', 'redline_rate', 'disclosure', 'privacy_leak'];

export function Overview() {
  const s = useStore();
  const prod = s.bundle.versions.find((v) => v.status === 'production')!;
  const [vid, setVid] = useState(prod.version_id);
  const nav = useNavigate();
  const evals = useMemo(() => s.evals.filter((e) => e.version_id === vid), [s, vid]);
  const ms = s.metrics[vid];
  const matrix = useMemo(() => intentDimensionMatrix(evals), [evals]);
  const causes = useMemo(() => Object.entries(rootCauseCounts(evals)).sort((a, b) => b[1].count - a[1].count), [evals]);
  const maxCause = Math.max(1, ...causes.map(([, c]) => c.count));
  const candidates = s.bundle.versions.filter((v) => v.status === 'candidate');
  const gates = candidates.map((c) => {
    const base = c.parent ?? prod.version_id;
    const ce = s.evals.filter((e) => e.version_id === c.version_id);
    const pending = ce.filter((e) => e.review_reasons.some((r) => r.reason === 'high_risk_hit')).length;
    return { c, base, g: runGate(ce, s.groups.filter((g) => g.version_id === c.version_id), s.evals.filter((e) => e.version_id === base), s.groups.filter((g) => g.version_id === base), pending) };
  });
  const reviewQueue = evals.filter((e) => e.review_reasons.length).length;

  return (
    <div className="page">
      <div className="intro">
        <p>
          每条回答都会经过同一条评测链路：抽取数字 → 用扶摇数据核验 → 规则与 LLM 评审 → 归因到组件 → 按规则送人工复核。下面的数字都在浏览器里用评测引擎现算（本次 {s.evalMs.toFixed(0)} ms，{s.evals.length} 条回答），点开任一卡片即可看到对应回答。
        </p>
        <p className="muted">
          事实快照：扶摇 API 抓取于 {s.bundle.meta.fetched_at.slice(0, 16).replace('T', ' ')} UTC；最近交易日 {s.bundle.meta.latest_trading_day}；KYC 画像、问题集为匿名构造样例。
        </p>
      </div>

      <div className="vtabs">
        {s.bundle.versions.map((v) => (
          <button key={v.version_id} className={v.version_id === vid ? 'on' : ''} onClick={() => setVid(v.version_id)}>
            {v.label}
            {v.status === 'production' ? <Badge kind="pass">线上</Badge> : v.status === 'candidate' ? <Badge kind="warn">候选</Badge> : null}
          </button>
        ))}
      </div>
      <p className="muted">{s.versionById.get(vid)?.change_note}</p>

      <div className="metrics">
        {KPI.map((id) => {
          const m = ms.find((x) => x.id === id)!;
          return <MetricCard key={id} m={m} onClick={() => nav(`/cases?version=${vid}&metric=${id}`)} />;
        })}
      </div>

      <div className="grid2">
        <Section title="意图 × 维度 合格率" right={<span className="muted">格内：合格/适用</span>}>
          <table className="tbl heat">
            <thead>
              <tr>
                <th>意图</th>
                {DIMENSIONS.map((d) => (
                  <th key={d.id}>{d.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INTENT_STANDARDS.map((st) => (
                <tr key={st.intent}>
                  <td>{st.label}</td>
                  {DIMENSIONS.map((d) => {
                    const c = matrix[st.intent]?.[d.id];
                    const r = c && c.total ? c.pass / c.total : null;
                    return (
                      <td key={d.id} className="heat-cell" style={{ background: r === null ? undefined : `color-mix(in srgb, var(--bad) ${Math.round((1 - r) * 70)}%, var(--ok-bg))` }}>
                        <Link to={`/cases?version=${vid}&intent=${st.intent}&dim=${d.id}`}>{c && c.total ? `${c.pass}/${c.total}` : '—'}</Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Bad Case 根因分布" right={<span className="muted">按回答计数，一条回答可有多个根因</span>}>
          {causes.length === 0 ? <p className="muted">无失败回答</p> : null}
          {causes.map(([layer, c]) => (
            <Link key={layer} className="bar-row" to={`/cases?version=${vid}&cause=${layer}`}>
              <span className="bar-label">{ROOT_CAUSE_LABEL[layer as keyof typeof ROOT_CAUSE_LABEL]}</span>
              <span className="bar">
                <span className="bar-fill" style={{ width: `${(c.count / maxCause) * 100}%` }} />
              </span>
              <span className="bar-num">{c.count}</span>
            </Link>
          ))}
          <p className="muted">待人工复核：{reviewQueue} 条（<Link to={`/review?version=${vid}`}>进入复核队列</Link>）</p>
        </Section>
      </div>

      <Section title="候选版本发布闸门">
        <table className="tbl">
          <thead>
            <tr>
              <th>候选</th>
              <th>对比基线</th>
              <th>结论</th>
              <th>未通过的规则</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {gates.map(({ c, base, g }) => (
              <tr key={c.version_id}>
                <td>{c.label}</td>
                <td>{s.versionById.get(base)?.label}</td>
                <td>
                  <Badge kind={g.decision === 'pass' ? 'pass' : g.decision === 'block' ? 'fail' : 'warn'}>{g.label}</Badge>
                </td>
                <td className="muted">{g.rules.filter((r) => !r.ok).map((r) => `${r.id} ${r.label}（${r.detail}）`).join('；') || '—'}</td>
                <td>
                  <Link to={`/compare?a=${base}&b=${c.version_id}`}>查看对比</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="版本趋势">
        <table className="tbl">
          <thead>
            <tr>
              <th>指标</th>
              {s.bundle.versions.map((v) => (
                <th key={v.version_id}>{v.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {KPI.map((id) => (
              <tr key={id}>
                <td title={s.metrics[vid].find((m) => m.id === id)?.formula}>{s.metrics[vid].find((m) => m.id === id)?.label}</td>
                {s.bundle.versions.map((v) => {
                  const m = s.metrics[v.version_id].find((x) => x.id === id)!;
                  return (
                    <td key={v.version_id}>
                      {pct(m.value)} <span className="muted">({m.numerator}/{m.denominator})</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
