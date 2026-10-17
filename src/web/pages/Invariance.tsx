import { useState } from 'react';
import { useStore } from '../store';
import { Badge, CaseLink, Section } from '../ui';
import { ALLOWED_PERSONALIZATION, METRIC_BY_ID, PROFILE_INVARIANT_FACTS } from '../../core/standards';
import { fmtVal } from '../../core/verify';

export function Invariance() {
  const s = useStore();
  const [vid, setVid] = useState('V4');
  const groups = s.groups.filter((g) => g.version_id === vid);
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>画像一致性</h1>
          <p>同一个问题换成不同画像（保守退休、新手、重仓持有、专业投资者）分别提问：不变事实必须一致，也不能对某个画像选择性省略。允许变化的只有表达方式、解释深度和关注重点。</p>
        </div>
      </div>
      <div className="vtabs">
        {s.bundle.versions.map((v) => {
          const gs = s.groups.filter((g) => g.version_id === v.version_id);
          return (
            <button key={v.version_id} className={v.version_id === vid ? 'on' : ''} onClick={() => setVid(v.version_id)}>
              {v.label} <span className="muted">{gs.filter((g) => g.verdict === 'pass').length}/{gs.length}</span>
            </button>
          );
        })}
      </div>
      {groups.map((g) => (
        <Section key={g.group_id} title={`${g.group_id}：${g.question}`} right={<Badge kind={g.verdict === 'pass' ? 'pass' : 'fail'}>{g.verdict === 'pass' ? '一致' : '不一致'}</Badge>}>
          <table className="tbl">
            <thead>
              <tr>
                <th>不变事实</th>
                <th>真值（扶摇/主数据）</th>
                {g.members.map((m) => (
                  <th key={m.persona_id}>
                    <CaseLink id={m.answer_id}>{s.personaById.get(m.persona_id)?.label}</CaseLink>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={r.metric} className={r.consistent && r.covered_all ? '' : 'row-fail'}>
                  <td>{r.metric === 'risk_level' ? '产品风险等级' : METRIC_BY_ID[r.metric]?.label ?? r.metric}</td>
                  <td>{r.metric === 'risk_level' ? `R${r.truth}` : fmtVal(r.truth)}</td>
                  {r.values.map((v) => (
                    <td key={v.persona_id}>{v.text ? <code>{v.text}</code> : <span className="neg">未提及</span>}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <td>风险提示</td>
                <td>各画像须一致（基金/热点/建议类必须有）</td>
                {g.disclosure_parity.map((p) => (
                  <td key={p.persona_id} className={p.has_disclosure ? '' : 'neg'}>
                    {p.has_disclosure ? '有' : '缺失'} <span className="muted">（风险词 {p.risk_terms}）</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          {g.issues.length ? (
            <ul className="issues">
              {g.issues.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : null}
        </Section>
      ))}
      <div className="grid2">
        <Section title="不能因用户画像而改变的事实">
          <table className="tbl">
            <thead>
              <tr>
                <th>类别</th>
                <th>事实</th>
                <th>为什么不能变</th>
                <th>由哪项检查保证</th>
              </tr>
            </thead>
            <tbody>
              {PROFILE_INVARIANT_FACTS.map((f) => (
                <tr key={f.category}>
                  <td>{f.category}</td>
                  <td>{f.facts}</td>
                  <td className="muted">{f.why}</td>
                  <td>
                    <code>{f.check}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="允许个性化的部分">
          <ul>
            {ALLOWED_PERSONALIZATION.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
