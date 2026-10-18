import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore, pct } from '../store';
import { Badge, CaseLink, Section } from '../ui';
import { attributionScope, componentDiff, pairedStats, rootCauseShift, runGate } from '../../core/compare';
import { summarizeFeedback, FEEDBACK_ASSUMPTIONS } from '../../core/feedback';
import { ROOT_CAUSE_LABEL } from '../../core/standards';

export function Compare() {
  const s = useStore();
  const [q, setQ] = useSearchParams();
  const a = q.get('a') ?? 'V3';
  const b = q.get('b') ?? 'V6';
  const va = s.versionById.get(a)!;
  const vb = s.versionById.get(b)!;
  const ea = useMemo(() => s.evals.filter((e) => e.version_id === a), [s, a]);
  const eb = useMemo(() => s.evals.filter((e) => e.version_id === b), [s, b]);
  const stats = useMemo(() => pairedStats(ea, eb), [ea, eb]);
  const diff = componentDiff(va, vb);
  const shift = rootCauseShift(ea, eb);
  const pending = eb.filter((e) => e.review_reasons.some((r) => r.reason === 'high_risk_hit')).length;
  const gate = runGate(eb, s.groups.filter((g) => g.version_id === b), ea, s.groups.filter((g) => g.version_id === a), pending);
  const fa = summarizeFeedback(ea, s.feedback);
  const fbb = summarizeFeedback(eb, s.feedback);
  const ma = s.metrics[a];
  const mb = s.metrics[b];
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(q);
    n.set(k, v);
    setQ(n);
  };
  const ansOf = (vid: string, item: string) => `${vid}-${item}`;

  const overall = stats[0];
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>版本对比</h1>
          <p>用同一批 32 个问题分别考两个版本：看成绩差多少、差别是不是偶然的，以及这次改了哪个部件。下方表格里有详细的统计检验结果。</p>
        </div>
      </div>
      <section className="card verdict">
        <div className="verdict-main">
          <div className="verdict-k">
            <span className="muted">整体合格</span>
            <b>
              {overall?.pass_a ?? 0} → {overall?.pass_b ?? 0}
              <small>/{overall?.n ?? 0}</small>
            </b>
            <span className={overall && overall.delta < 0 ? 'neg' : 'pos'}>
              {overall ? `${overall.delta >= 0 ? '+' : ''}${(overall.delta * 100).toFixed(1)}pp · p=${overall.p_value.toFixed(3)}` : ''}
            </span>
          </div>
          <div className="verdict-k">
            <span className="muted">这次改了什么</span>
            <span className="verdict-text">{attributionScope(diff)}</span>
          </div>
          <div className="verdict-k">
            <span className="muted">发布闸门</span>
            <Badge kind={gate.decision === 'pass' ? 'pass' : gate.decision === 'block' ? 'fail' : 'warn'}>{gate.label}</Badge>
            <span className="muted" style={{ fontSize: 12 }}>
              {gate.rules.filter((r) => !r.ok).map((r) => r.id).join('、') || '全部规则通过'}
            </span>
          </div>
        </div>
      </section>
      <div className="filters">
        基线
        <select value={a} onChange={(e) => set('a', e.target.value)}>
          {s.bundle.versions.map((v) => (
            <option key={v.version_id} value={v.version_id}>
              {v.label}
            </option>
          ))}
        </select>
        → 候选
        <select value={b} onChange={(e) => set('b', e.target.value)}>
          {s.bundle.versions.map((v) => (
            <option key={v.version_id} value={v.version_id}>
              {v.label}
            </option>
          ))}
        </select>
        <span className="muted">同一评测集配对比较（{stats[0]?.n ?? 0} 对）</span>
      </div>

      <div className="grid2">
        <Section title="组件变更与可归因范围">
          <table className="tbl">
            <thead>
              <tr>
                <th>组件</th>
                <th>{va.label}</th>
                <th>{vb.label}</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(va.components) as (keyof typeof va.components)[]).map((k) => (
                <tr key={k} className={va.components[k] !== vb.components[k] ? 'row-changed' : ''}>
                  <td>{k}</td>
                  <td>{va.components[k]}</td>
                  <td>{vb.components[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <b>{attributionScope(diff)}</b>
          </p>
          <p className="muted">{vb.change_note}</p>
        </Section>
        <Section title={`发布闸门：${vb.label}`} right={<Badge kind={gate.decision === 'pass' ? 'pass' : gate.decision === 'block' ? 'fail' : 'warn'}>{gate.label}</Badge>}>
          <table className="tbl">
            <tbody>
              {gate.rules.map((r) => (
                <tr key={r.id} className={r.ok ? '' : 'row-fail'}>
                  <td>{r.ok ? '✓' : '✗'}</td>
                  <td>
                    {r.id} {r.label} {r.hard ? <Badge kind="stage">硬性</Badge> : <Badge kind="na">软性</Badge>}
                  </td>
                  <td className="muted">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">硬性规则不通过 → 阻断；只有软性不通过 → 有条件通过；高危命中未经人工确认 → 待确认。</p>
        </Section>
      </div>

      <Section title="维度合格率：配对检验">
        <table className="tbl">
          <thead>
            <tr>
              <th>维度</th>
              <th>样本对</th>
              <th>{a} 合格</th>
              <th>{b} 合格</th>
              <th>Δ（百分点）</th>
              <th>95% CI（bootstrap）</th>
              <th>McNemar p</th>
              <th>退化样本</th>
              <th>改善样本</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((st) => (
              <tr key={st.key}>
                <td>{st.label}</td>
                <td>{st.n}</td>
                <td>{st.pass_a}</td>
                <td>{st.pass_b}</td>
                <td className={st.delta < 0 ? 'neg' : st.delta > 0 ? 'pos' : ''}>{(st.delta * 100).toFixed(1)}</td>
                <td className="muted">
                  [{(st.ci95[0] * 100).toFixed(1)}, {(st.ci95[1] * 100).toFixed(1)}]
                </td>
                <td className={st.p_value < 0.05 ? 'pos' : 'muted'}>{st.p_value.toFixed(3)}</td>
                <td>
                  {st.regressions.slice(0, 6).map((it) => (
                    <span key={it}>
                      <CaseLink id={ansOf(b, it)}>{it}</CaseLink>{' '}
                    </span>
                  ))}
                  {st.regressions.length > 6 ? `…共 ${st.regressions.length}` : ''}
                </td>
                <td>
                  {st.improvements.slice(0, 4).map((it) => (
                    <span key={it}>
                      <CaseLink id={ansOf(b, it)}>{it}</CaseLink>{' '}
                    </span>
                  ))}
                  {st.improvements.length > 4 ? `…共 ${st.improvements.length}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">样本量小（每版本 32 条），p ≥ 0.05 的差异不应当作确定结论；退化样本可直接点开对比两版回答。</p>
      </Section>

      <div className="grid2">
        <Section title="关键指标对比">
          <table className="tbl">
            <thead>
              <tr>
                <th>指标</th>
                <th>{a}</th>
                <th>{b}</th>
              </tr>
            </thead>
            <tbody>
              {ma.map((m) => {
                const n = mb.find((x) => x.id === m.id)!;
                const better = m.value !== null && n.value !== null && (m.direction === 'higher' ? n.value > m.value : n.value < m.value);
                const worse = m.value !== null && n.value !== null && (m.direction === 'higher' ? n.value < m.value : n.value > m.value);
                return (
                  <tr key={m.id}>
                    <td title={m.formula}>{m.label}</td>
                    <td>
                      {pct(m.value)} <span className="muted">({m.numerator}/{m.denominator})</span>
                    </td>
                    <td className={better ? 'pos' : worse ? 'neg' : ''}>
                      {pct(n.value)} <span className="muted">({n.numerator}/{n.denominator})</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
        <div>
          <Section title="根因变化（按回答计数）">
            <table className="tbl">
              <thead>
                <tr>
                  <th>根因层</th>
                  <th>{a}</th>
                  <th>{b}</th>
                </tr>
              </thead>
              <tbody>
                {shift.map((r) => (
                  <tr key={r.layer}>
                    <td>{ROOT_CAUSE_LABEL[r.layer]}</td>
                    <td>{r.a}</td>
                    <td className={r.b > r.a ? 'neg' : r.b < r.a ? 'pos' : ''}>{r.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="用户行为反馈（模拟信号）">
            <table className="tbl">
              <thead>
                <tr>
                  <th />
                  <th>{a}</th>
                  <th>{b}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>点赞率</td>
                  <td>{pct(fa.up_rate)}</td>
                  <td>{pct(fbb.up_rate)}</td>
                </tr>
                <tr>
                  <td>点踩率</td>
                  <td>{pct(fa.down_rate)}</td>
                  <td>{pct(fbb.down_rate)}</td>
                </tr>
                <tr>
                  <td>60 秒内改写重问率</td>
                  <td>{pct(fa.rephrase_rate)}</td>
                  <td>{pct(fbb.rephrase_rate)}</td>
                </tr>
                <tr>
                  <td>被点赞但命中合规红线</td>
                  <td>{fa.up_with_redline}</td>
                  <td>{fbb.up_with_redline}</td>
                </tr>
                <tr>
                  <td>负反馈但评测通过（送人工）</td>
                  <td>{fa.negative_but_pass.length}</td>
                  <td>{fbb.negative_but_pass.length}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted">反馈只用于发现漏检和排优先级，不参与闸门判定。模拟假设：{FEEDBACK_ASSUMPTIONS.join('；')}。</p>
          </Section>
        </div>
      </div>
    </div>
  );
}
