import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AnswerEval, CheckResult, Claim, ClaimVerification, EvidenceItem, Overall, Verdict } from '../core/types';
import { CHECK_BY_ID, DIMENSION_LABEL, METRIC_BY_ID, ROOT_CAUSE_LABEL, STAGE_LABEL } from '../core/standards';
import { fmtVal } from '../core/verify';
import type { MetricValue } from '../core/metrics';
import { pct } from './store';

export const VERDICT_LABEL: Record<Verdict, string> = { pass: '通过', fail: '不合格', warn: '提示', unverifiable: '无法核验', na: '不适用' };
export const OVERALL_LABEL: Record<Overall, string> = { pass: '合格', review: '待复核', fail: '不合格' };

export function Badge({ kind, children, title }: { kind: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge b-${kind}`} title={title}>
      {children}
    </span>
  );
}

export function VerdictBadge({ v }: { v: Verdict }) {
  return <Badge kind={v}>{VERDICT_LABEL[v]}</Badge>;
}

export function OverallBadge({ v }: { v: Overall }) {
  return <Badge kind={v === 'pass' ? 'pass' : v === 'fail' ? 'fail' : 'unverifiable'}>{OVERALL_LABEL[v]}</Badge>;
}

export function MetricCard({ m, onClick }: { m: MetricValue; onClick?: () => void }) {
  const bad = m.threshold !== undefined && m.value !== null && (m.direction === 'higher' ? m.value < m.threshold : m.value > m.threshold);
  return (
    <button className={`metric ${bad ? 'metric-bad' : ''}`} onClick={onClick} title={m.formula}>
      <div className="metric-label">{m.label}</div>
      <div className="metric-value">{pct(m.value)}</div>
      <div className="metric-sub">
        {m.numerator}/{m.denominator}
        {m.threshold !== undefined ? ` · 阈值 ${m.direction === 'higher' ? '≥' : '≤'}${pct(m.threshold, 0)}` : ''}
      </div>
    </button>
  );
}

/** 轻量渲染 Markdown：去掉 **、把 # 标题行加粗、隐藏表格分隔线；只处理已切好的片段，不改变高亮位置 */
function md(text: string, key: string): ReactNode[] {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const nl = i < lines.length - 1 ? '\n' : '';
    if (/^\s*\|?\s*:?-{3,}/.test(line)) return <span key={`${key}-${i}`}>{nl}</span>;
    const h = line.match(/^\s*#{1,6}\s+(.*)$/);
    const clean = (h ? h[1] : line).replace(/\*\*/g, '').replace(/^\s*---\s*$/, '');
    return h ? (
      <b key={`${key}-${i}`} className="md-h">
        {clean}
        {nl}
      </b>
    ) : (
      <span key={`${key}-${i}`}>
        {clean}
        {nl}
      </span>
    );
  });
}

/** 回答原文高亮：数字按核验结果着色，合规/隐私命中标橙 */
export function AnswerText({ ev, text }: { ev?: AnswerEval; text: string }) {
  if (!ev) return <div className="answer">{md(text, 'p')}</div>;
  type Mark = { start: number; end: number; cls: string; title: string };
  const marks: Mark[] = [];
  for (const c of ev.claims) {
    const v = ev.verifications.find((x) => x.claim_id === c.claim_id);
    if (!v) continue;
    const cls = { match: 'm-ok', mismatch: 'm-bad', stale_match: 'm-stale', unverifiable: 'm-unk', unrecognized: 'm-none' }[v.verdict];
    marks.push({ start: c.start, end: c.end, cls, title: `${c.metric ? METRIC_BY_ID[c.metric]?.label ?? c.metric : '未识别指标'}：${v.reason}` });
  }
  for (const ch of ev.checks) {
    if (ch.verdict !== 'fail' || !['compliance', 'privacy', 'personalization'].includes(ch.dimension)) continue;
    for (const e of ch.evidence) if (e.kind === 'span') marks.push({ start: e.start, end: e.end, cls: 'm-rule', title: `${CHECK_BY_ID[ch.check_id].label}：${ch.message}` });
  }
  marks.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: ReactNode[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start < pos) continue;
    out.push(...md(text.slice(pos, m.start), `t${pos}`));
    out.push(
      <mark key={`${m.start}-${m.cls}`} className={m.cls} title={m.title}>
        {text.slice(m.start, m.end).replace(/\*\*/g, '')}
      </mark>,
    );
    pos = m.end;
  }
  out.push(...md(text.slice(pos), `t${pos}`));
  return <div className="answer">{out}</div>;
}

function Evidence({ e }: { e: EvidenceItem }) {
  switch (e.kind) {
    case 'fact':
      return (
        <li className="ev">
          <b>事实</b> {e.fact_key} = <code>{fmtVal(e.value)}</code>（{e.as_of}）· 来源 {e.source.provider === 'fuyao' ? '扶摇' : e.source.provider === 'derived' ? '推算' : e.source.provider === 'master_data' ? '适当性主数据（构造）' : e.source.provider}
          {e.source.endpoint ? ` ${e.source.endpoint}` : ''}
          {e.source.request_id ? ` · request_id ${e.source.request_id}` : ''}
          {e.source.note ? ` · ${e.source.note}` : ''}
        </li>
      );
    case 'span':
      return (
        <li className="ev">
          <b>原文</b> 「{e.text}」
        </li>
      );
    case 'rule':
      return (
        <li className="ev">
          <b>规则</b> {e.rule_id} {e.text}
        </li>
      );
    case 'trace':
      return (
        <li className="ev">
          <b>Trace</b> {e.path}：{e.detail}
        </li>
      );
    default:
      return <li className="ev">{e.text}</li>;
  }
}

export function CheckRow({ c }: { c: CheckResult }) {
  const [open, setOpen] = useState(c.verdict === 'fail');
  const def = CHECK_BY_ID[c.check_id];
  return (
    <div className={`check check-${c.verdict}`}>
      <div className="check-head" onClick={() => setOpen(!open)}>
        <VerdictBadge v={c.verdict} />
        <span className="check-id">{c.check_id}</span>
        <span className="check-label">{def.label}</span>
        <Badge kind="stage">{STAGE_LABEL[c.stage]}</Badge>
        <span className="check-msg">{c.message}</span>
      </div>
      {open && c.evidence.length > 0 && <ul className="evidence">{c.evidence.slice(0, 12).map((e, i) => <Evidence key={i} e={e} />)}</ul>}
    </div>
  );
}

export function ClaimTable({ claims, verifications }: { claims: Claim[]; verifications: ClaimVerification[] }) {
  const rows = claims.map((c) => ({ c, v: verifications.find((x) => x.claim_id === c.claim_id)! }));
  if (!rows.length) return <p className="muted">回答中没有数字。</p>;
  const label = { match: '一致', mismatch: '不符', stale_match: '等于旧数据', unverifiable: '无法核验', unrecognized: '未识别指标' } as const;
  return (
    <table className="tbl small">
      <thead>
        <tr>
          <th>原文</th>
          <th>标的</th>
          <th>指标</th>
          <th>写明时点</th>
          <th>核验</th>
          <th>事实值（时点）</th>
          <th>Agent 上下文</th>
          <th>容差/说明</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ c, v }) => (
          <tr key={c.claim_id} className={`row-${v.verdict}`}>
            <td>
              <code>{c.text}</code>
              {c.qualifier !== 'exact' ? <span className="muted">（{c.qualifier === 'approx' ? '约' : c.qualifier === 'gt' ? '超过' : '不到'}）</span> : null}
            </td>
            <td>{c.entity ?? '—'}</td>
            <td>{c.metric ? METRIC_BY_ID[c.metric]?.label ?? c.metric : '—'}</td>
            <td>{c.period ?? '—'}</td>
            <td>{label[v.verdict]}</td>
            <td>{v.fact_value !== undefined ? `${fmtVal(v.fact_value)}（${v.fact_as_of}）` : '—'}</td>
            <td>{v.in_context === 'unknown' ? '—' : v.in_context === 'absent' ? '无' : `${v.in_context === 'match' ? '一致' : '不一致'} ${fmtVal(v.context_value)}`}</td>
            <td className="muted">{v.verdict === 'match' || v.verdict === 'mismatch' || v.verdict === 'stale_match' ? `${v.reason}；${v.tolerance}` : v.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DimRow({ ev }: { ev: AnswerEval }) {
  return (
    <span className="dims">
      {(Object.keys(ev.dimensions) as (keyof typeof ev.dimensions)[]).map((d) => (
        <span key={d} className={`dim dim-${ev.dimensions[d]}`} title={`${DIMENSION_LABEL[d]}：${VERDICT_LABEL[ev.dimensions[d]]}`}>
          {DIMENSION_LABEL[d].slice(0, 2)}
        </span>
      ))}
    </span>
  );
}

export function CaseLink({ id, children }: { id: string; children?: ReactNode }) {
  return <Link to={`/cases/${encodeURIComponent(id)}`}>{children ?? id}</Link>;
}

export function RootCauseLabel({ id }: { id: keyof typeof ROOT_CAUSE_LABEL }) {
  return <Badge kind="cause">{ROOT_CAUSE_LABEL[id]}</Badge>;
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
