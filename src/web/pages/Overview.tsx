import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore, pct } from '../store';
import { Badge, Section } from '../ui';
import { LineChart } from '../charts';
import { DIMENSIONS, INTENT_STANDARDS, ROOT_CAUSE_LABEL } from '../../core/standards';
import { intentDimensionMatrix, rootCauseCounts, type MetricValue } from '../../core/metrics';
import { pairedStats, runGate } from '../../core/compare';

const KPI = ['overall_pass', 'completeness', 'numeric_accuracy', 'freshness_pass', 'time_label', 'slot_coverage', 'llm_relevance', 'suitability', 'invariance', 'redline_rate', 'disclosure', 'privacy_leak'];

function delta(m: MetricValue, p: MetricValue | undefined) {
  if (!p || m.value === null || p.value === null) return null;
  const d = m.value - p.value;
  const good = m.direction === 'higher' ? d > 0 : d < 0;
  if (Math.abs(d) < 1e-9) return <span className="delta flat">持平</span>;
  return <span className={`delta ${good ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'} {Math.abs(d * 100).toFixed(1)}pp</span>;
}

const fmtP = (p: number) => (p < 0.001 ? 'p<0.001' : `p=${p.toFixed(3)}`);

export function Overview() {
  const s = useStore();
  const prod = s.bundle.versions.find((v) => v.status === 'production')!;
  const [vid, setVid] = useState(prod.version_id);
  const nav = useNavigate();
  const version = s.versionById.get(vid)!;
  const evals = useMemo(() => s.evals.filter((e) => e.version_id === vid), [s, vid]);
  const ms = s.metrics[vid];
  const parentMs = version.parent ? s.metrics[version.parent] : undefined;
  const matrix = useMemo(() => intentDimensionMatrix(evals), [evals]);
  const causes = useMemo(() => Object.entries(rootCauseCounts(evals)).sort((a, b) => b[1].count - a[1].count), [evals]);
  const maxCause = Math.max(1, ...causes.map(([, c]) => c.count));
  const byVer = (v: string) => s.evals.filter((e) => e.version_id === v);
  const grp = (v: string) => s.groups.filter((g) => g.version_id === v);
  const m = (v: string, id: string) => s.metrics[v].find((x) => x.id === id)!;

  const gates = s.bundle.versions
    .filter((v) => v.status === 'candidate')
    .map((c) => {
      const base = c.parent ?? prod.version_id;
      const ce = byVer(c.version_id);
      const pending = ce.filter((e) => e.review_reasons.some((r) => r.reason === 'high_risk_hit')).length;
      return { c, base, g: runGate(ce, grp(c.version_id), byVer(base), grp(base), pending) };
    });

  // 本期结论：全部由数据现算，文字只做组织
  const findings = useMemo(() => {
    const s12 = pairedStats(byVer('V1'), byVer('V2'))[0];
    const s23 = pairedStats(byVer('V2'), byVer('V3'))[0];
    const s34 = pairedStats(byVer('V3'), byVer('V4'))[0];
    const s35 = pairedStats(byVer('V3'), byVer('V5'))[0];
    const s36 = pairedStats(byVer('V3'), byVer('V6'))[0];
    const g4 = gates.find((g) => g.c.version_id === 'V4');
    const g5 = gates.find((g) => g.c.version_id === 'V5');
    const g6 = gates.find((g) => g.c.version_id === 'V6');
    const ratio = (v: string, id: string) => `${m(v, id).numerator}/${m(v, id).denominator}`;
    const hardFails = (g?: (typeof gates)[number]) => g?.g.rules.filter((r) => !r.ok && r.hard && r.id !== 'G8').map((r) => r.label).join('；') || '无';
    return [
      {
        title: 'Prompt 修不了数据问题',
        kpis: [
          { v: `${ratio('V1', 'freshness_pass')} → ${ratio('V2', 'freshness_pass')}`, l: '时效合格 · 只换 Prompt（V1→V2）' },
          { v: `${s23.pass_a} → ${s23.pass_b}/${s23.n}`, l: `整体合格 · 修数据层（V2→V3）${fmtP(s23.p_value)}` },
        ],
        why: `只换 Prompt 后隐私复述 ${m('V1', 'privacy_leak').numerator}→${m('V2', 'privacy_leak').numerator} 条，但时效反而变差：新 Prompt 让模型如实写出“截至 ${s.bundle.meta.t5_trading_day}”，旧缓存被暴露；根因在数据时效层（V1→V2 整体 Δ${(s12.delta * 100).toFixed(0)}pp）。`,
        link: '/compare?a=V2&b=V3',
      },
      {
        title: '发现 → 定位 → 修复：回答被截断',
        kpis: [
          { v: `${ratio('V3', 'completeness')} → ${ratio('V6', 'completeness')}`, l: '回答完整 · 只提高输出上限（V3→V6）' },
          { v: `${s36.pass_a} → ${s36.pass_b}/${s36.n}`, l: `整体合格 · ${fmtP(s36.p_value)} · 闸门${g6?.g.label ?? '—'}` },
        ],
        why: `平台发现 V3 有 ${m('V3', 'completeness').denominator - m('V3', 'completeness').numerator} 条回答因 1400 token 上限被截断，Prompt 要求放在结尾的风险提示随之丢失（风险揭示 ${ratio('V3', 'disclosure')}）；归因到“输出截断”层后只改这一个参数，风险揭示 ${ratio('V6', 'disclosure')}。`,
        link: '/compare?a=V3&b=V6',
      },
      {
        title: '换模型的提升，有一部分来自输出上限',
        kpis: [
          { v: `${s34.pass_a} → ${s34.pass_b}/${s34.n}`, l: `整体合格 · 换模型+上限 3200（V3→V4）${fmtP(s34.p_value)}` },
          { v: ratio('V4', 'invariance'), l: `画像不变性 · 闸门${g4?.g.label ?? '—'}` },
        ],
        why: `V4 同时换了模型和输出上限（多因素）；对照只提上限的 V6（${s36.pass_b}/${s36.n}），模型本身的贡献并不明显。V4 还因“${hardFails(g4)}”被阻断：对部分画像省略了风险提示。`,
        link: '/compare?a=V3&b=V4',
      },
      {
        title: '直觉与数据不一致时，按数据',
        kpis: [
          { v: `${s35.pass_a} → ${s35.pass_b}/${s35.n}`, l: `整体合格 · 亲和力 Prompt（V3→V5）${fmtP(s35.p_value)}` },
          { v: `${m('V5', 'redline_rate').numerator} · ${ratio('V5', 'invariance')}`, l: '红线命中 · 画像不变性' },
        ],
        why: `原以为“给出有信心的结论”会引发迎合，实测未出现，闸门${g5?.g.label ?? '—'}；但 P3 删掉了适当性与画像不变约束，32 条评测集可能覆盖不到，建议补红队样本再全量。`,
        link: '/compare?a=V3&b=V5',
      },
    ];
  }, [s]);

  // 评测链路：各环节在本期的实际工作量
  const pipe = useMemo(() => {
    const all = s.evals;
    const checks = all.reduce((n, e) => n + e.checks.filter((c) => c.verdict !== 'na').length, 0);
    const high = all.filter((e) => e.review_reasons.some((r) => r.reason === 'high_risk_hit')).length;
    const vs = all.flatMap((e) => e.verifications).filter((v) => v.verdict !== 'unrecognized');
    const judged = Object.values(s.bundle.judges).filter((j) => !j.error).length;
    const disagree = all.filter((e) => e.review_reasons.some((r) => r.reason === 'judge_disagree')).length;
    const queue = all.filter((e) => e.review_reasons.length).length;
    const calib = all.filter((e) => e.review_reasons.some((r) => r.reason === 'calibration_sample')).length;
    const fbNeg = all.filter((e) => e.review_reasons.some((r) => r.reason === 'negative_feedback_pass')).length;
    return [
      { cls: 's-rule', tag: '自动评测 · 规则', title: '合规 / 隐私 / 适当性 / 时点', num: checks, unit: '次检查', desc: `22 项规则覆盖全部 ${all.length} 条回答；高危命中 ${high} 条直接送人工`, not: '不判语义相关性' },
      { cls: 's-llm', tag: '自动评测 · LLM', title: '相关性与个性化贴合', num: judged, unit: '条评审', desc: `DeepSeek 按评分细则打 0/1/2 分，与规则分歧 ${disagree} 条送人工`, not: '不判数字对错' },
      { cls: 's-verify', tag: '数据核验 · 扶摇', title: '数字逐个比对', num: vs.length, unit: '个数字', desc: `不符 ${vs.filter((v) => v.verdict === 'mismatch').length} · 旧数据 ${vs.filter((v) => v.verdict === 'stale_match').length} · 无法核验 ${vs.filter((v) => v.verdict === 'unverifiable').length}`, not: '核不了就送人工，不默认通过' },
      { cls: 's-human', tag: '人工复核', title: '只看路由进来的', num: queue, unit: '条入队', desc: `高危、无法核验、评审分歧、负反馈但通过；含 5% 校准抽样 ${calib} 条`, not: '不全量逐条看' },
      { cls: 's-fb', tag: '用户反馈（模拟）', title: '发现漏检、排优先级', num: fbNeg, unit: '条漏检候选', desc: '负反馈但评测通过 → 送人工，挖新失败类型', not: '不当质量真值，不进闸门' },
    ];
  }, [s]);

  const order = s.bundle.versions.map((v) => v.version_id);
  const trend = [
    { id: 'overall_pass', label: '整体合格率', color: 'var(--s1)' },
    { id: 'freshness_pass', label: '时效合格率', color: 'var(--s2)' },
    { id: 'completeness', label: '回答完整率', color: 'var(--s3)' },
    { id: 'disclosure', label: '风险揭示覆盖', color: 'var(--s4)' },
  ].map((t) => ({
    ...t,
    values: order.map((v) => m(v, t.id).value),
    details: order.map((v) => `${m(v, t.id).numerator}/${m(v, t.id).denominator}`),
  }));

  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>总览</h1>
          <p>
            每条回答都走同一条链路：抽取数字 → 用扶摇数据核验 → 规则与 LLM 评审 → 归因到组件 → 按规则送人工复核 → 版本过发布闸门。下面所有数字都在你的浏览器里用评测引擎现算（本次 {s.evalMs.toFixed(0)} ms），点开即可看到具体回答。
          </p>
        </div>
        <div className="tour">
          第一次来：
          <Link to="/cases/V1-QT01-U03">① 看一条 Bad Case</Link>
          <Link to="/compare?a=V3&b=V4">② 对比两个版本</Link>
          <Link to="/invariance">③ 画像一致性</Link>
          <Link to="/sandbox">④ 粘贴回答现场评测</Link>
        </div>
      </div>

      <div className="grid-73">
        <section className="card hero">
          <div className="card-head">
            <h2>本期评测结论</h2>
            <span className="muted">
              {s.bundle.versions.length} 个版本 × 32 项 = {s.bundle.logs.length} 条 DeepSeek 真实回答 · 扶摇快照 {s.bundle.meta.latest_trading_day}
            </span>
          </div>
          <div className="findings">
            {findings.map((f, i) => (
              <div key={f.title} className="finding">
                <div className="finding-num">结论 {i + 1}</div>
                <div className="finding-title">{f.title}</div>
                <div className="fk">
                  {f.kpis.map((k) => (
                    <div key={k.l} className="fk-item">
                      <div className="fk-v">{k.v}</div>
                      <div className="fk-l">{k.l}</div>
                    </div>
                  ))}
                </div>
                <div className="finding-why">{f.why}</div>
                <Link to={f.link}>查看对比与样本 →</Link>
              </div>
            ))}
          </div>
        </section>
        <Section title="候选版本发布闸门">
          <div className="gate-mini">
            {gates.map(({ c, base, g }) => (
              <Link key={c.version_id} to={`/compare?a=${base}&b=${c.version_id}`} className="gate-row" style={{ color: 'inherit', textDecoration: 'none' }}>
                <div>
                  <div className="gname">{c.label}</div>
                  <div className="gwhy">
                    对比 {base} · {g.rules.filter((r) => !r.ok).map((r) => r.id).join('、') || '全部规则通过'}
                  </div>
                </div>
                <Badge kind={g.decision === 'pass' ? 'pass' : g.decision === 'block' ? 'fail' : 'warn'}>{g.label}</Badge>
              </Link>
            ))}
            <div className="gate-row">
              <div>
                <div className="gname">{prod.label}</div>
                <div className="gwhy">当前线上版本</div>
              </div>
              <Badge kind="na">线上</Badge>
            </div>
            <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
              硬性规则：红线不多于基线且 ≤2%、隐私复述 = 0、适当性 = 100%、画像不变性 = 100%、高危已人工确认。
            </p>
          </div>
        </Section>
      </div>

      <Section title="评测链路与分工" right={<span className="muted">数字为本期 {s.bundle.logs.length} 条回答的实际工作量</span>}>
        <div className="pipeline">
          {pipe.map((p) => (
            <div key={p.tag} className={`stage ${p.cls}`}>
              <div className="stage-tag">{p.tag}</div>
              <div className="stage-title">{p.title}</div>
              <div className="stage-num">
                {p.num.toLocaleString()}
                <small>{p.unit}</small>
              </div>
              <div className="stage-desc">{p.desc}</div>
              <div className="stage-not">✕ {p.not}</div>
            </div>
          ))}
        </div>
      </Section>

      <div className="vtabs">
        {s.bundle.versions.map((v) => (
          <button key={v.version_id} className={v.version_id === vid ? 'on' : ''} onClick={() => setVid(v.version_id)}>
            {v.label}
            {v.status === 'production' ? <Badge kind="pass">线上</Badge> : v.status === 'candidate' ? <Badge kind="warn">候选</Badge> : null}
          </button>
        ))}
      </div>
      <div className="change-note">
        {version.change_note}
        {version.parent ? `（指标卡中的 ▲▼ 为相对 ${version.parent} 的变化）` : ''}
      </div>

      <div className="metrics">
        {KPI.map((id) => {
          const mm = ms.find((x) => x.id === id)!;
          const bad = mm.threshold !== undefined && mm.value !== null && (mm.direction === 'higher' ? mm.value < mm.threshold : mm.value > mm.threshold);
          return (
            <button key={id} className={`metric ${bad ? 'metric-bad' : ''}`} title={mm.formula} onClick={() => nav(`/cases?version=${vid}&metric=${id}`)}>
              <div className="metric-label">
                <span>{mm.label}</span>
                {mm.threshold !== undefined ? <span className={`status-dot ${bad ? 'no' : 'ok'}`}>{bad ? '未达标' : '达标'}</span> : null}
              </div>
              <div className="metric-value">{pct(mm.value)}</div>
              <div className="metric-sub">
                <span>
                  {mm.numerator}/{mm.denominator}
                  {mm.threshold !== undefined ? ` · ${mm.direction === 'higher' ? '≥' : '≤'}${pct(mm.threshold, 0)}` : ''}
                </span>
                {delta(mm, parentMs?.find((x) => x.id === id))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid-73">
        <Section title="版本演进" right={<span className="muted">悬停查看分子/分母</span>}>
          <LineChart xLabels={order} series={trend} />
        </Section>
        <Section title={`Bad Case 根因（${vid}）`} right={<span className="muted">按回答计数</span>}>
          {causes.length === 0 ? <p className="muted">无失败回答</p> : null}
          {causes.map(([layer, c]) => (
            <Link key={layer} className="bar-row" to={`/cases?version=${vid}&cause=${layer}`} title={`${c.count} 条回答，点击查看`}>
              <span className="bar-label">{ROOT_CAUSE_LABEL[layer as keyof typeof ROOT_CAUSE_LABEL]}</span>
              <span className="bar">
                <span className="bar-fill" style={{ width: `${(c.count / maxCause) * 100}%` }} />
              </span>
              <span className="bar-num">{c.count}</span>
            </Link>
          ))}
          <p className="muted" style={{ fontSize: 12 }}>
            {version.label} 待人工复核 {evals.filter((e) => e.review_reasons.length).length} 条 · <Link to={`/review?version=${vid}`}>进入复核队列</Link>
          </p>
        </Section>
      </div>

      <Section title={`意图 × 维度 合格率（${vid}）`} right={<span className="muted">格内：合格/适用；颜色越深不合格越多</span>}>
        <div className="tbl-wrap">
          <table className="tbl heat">
            <thead>
              <tr>
                <th>意图</th>
                {DIMENSIONS.map((d) => (
                  <th key={d.id} style={{ textAlign: 'center' }}>
                    {d.label}
                    <div className="muted" style={{ fontWeight: 400 }}>
                      {d.problem}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {INTENT_STANDARDS.map((st) => (
                <tr key={st.intent}>
                  <td>
                    <b>{st.label}</b>
                  </td>
                  {DIMENSIONS.map((d) => {
                    const c = matrix[st.intent]?.[d.id];
                    const fail = c && c.total ? 1 - c.pass / c.total : null;
                    return (
                      <td key={d.id} className="heat-cell" style={{ background: fail === null ? undefined : fail === 0 ? '#f3faf5' : `color-mix(in srgb, #eb6834 ${Math.round(12 + fail * 58)}%, #ffffff)` }}>
                        <Link to={`/cases?version=${vid}&intent=${st.intent}&dim=${d.id}`}>{c && c.total ? `${c.pass}/${c.total}` : '—'}</Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
