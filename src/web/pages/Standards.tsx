import { useStore } from '../store';
import { Section, Badge } from '../ui';
import { CHECKS, DIMENSIONS, DIVISION_OF_LABOR, INTENT_STANDARDS, ROOT_CAUSES, STAGE_LABEL } from '../../core/standards';
import { COMPLIANCE_RULES } from '../../core/compliance';
import { KYC_FIELD_POLICY } from '../../core/privacy';
import { PRODUCT_CATEGORIES } from '../../core/personalization';

export function Standards() {
  const s = useStore();
  const metrics = s.metrics['V3'];
  const calls = s.bundle.fetch_log.calls;
  const byEndpoint = Object.entries(
    calls.reduce<Record<string, { n: number; ok: number; ms: number }>>((acc, c) => {
      const k = c.endpoint;
      acc[k] ??= { n: 0, ok: 0, ms: 0 };
      acc[k].n++;
      if (c.code === 0) acc[k].ok++;
      acc[k].ms += c.ms;
      return acc;
    }, {}),
  );
  return (
    <div className="page">
      <div className="page-title">
        <div>
          <h1>质量标准</h1>
          <p>评测引擎与本页渲染的是同一份配置（src/core/standards.ts），文档与实现不会分叉。</p>
        </div>
      </div>
      <Section title="不同问答意图的质量标准">
        <table className="tbl">
          <thead>
            <tr>
              <th>意图</th>
              <th>示例</th>
              <th>核心指标</th>
              <th>时效要求</th>
              <th>风险提示</th>
              <th>不变事实</th>
              <th>允许的个性化</th>
            </tr>
          </thead>
          <tbody>
            {INTENT_STANDARDS.map((st) => (
              <tr key={st.intent}>
                <td>
                  <b>{st.label}</b>
                  <div className="muted">{st.description}</div>
                </td>
                <td className="muted">{st.example}</td>
                <td>{st.core_metrics.join('、')}</td>
                <td>{st.freshness}</td>
                <td>{st.disclosure_required ? '必须' : '不强制'}</td>
                <td>{st.invariant_facts.join('；')}</td>
                <td className="muted">{st.personalization_allowed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="自动评测、数据核验、人工复核、用户反馈的分工">
        <table className="tbl">
          <thead>
            <tr>
              <th>环节</th>
              <th>覆盖</th>
              <th>负责判断</th>
              <th>不负责</th>
              <th>产出</th>
              <th>如何衔接</th>
            </tr>
          </thead>
          <tbody>
            {DIVISION_OF_LABOR.map((d) => (
              <tr key={d.stage}>
                <td>
                  <b>{d.label}</b>
                </td>
                <td>{d.coverage}</td>
                <td>{d.owns}</td>
                <td className="muted">{d.not_for}</td>
                <td>{d.output}</td>
                <td className="muted">{d.feeds}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <div className="grid2">
        <Section title="质量维度与检查项">
          {DIMENSIONS.map((d) => (
            <div key={d.id} className="dim-block">
              <h3>
                {d.label} <span className="muted">← {d.problem}</span>
              </h3>
              <p className="muted">{d.definition}</p>
              <ul>
                {CHECKS.filter((c) => c.dimension === d.id).map((c) => (
                  <li key={c.id}>
                    <code>{c.id}</code> {c.label} <Badge kind="stage">{STAGE_LABEL[c.stage]}</Badge> <Badge kind={c.severity === 'high' ? 'fail' : c.severity === 'medium' ? 'warn' : 'na'}>{c.severity === 'high' ? '高危' : c.severity === 'medium' ? '中' : '低'}</Badge>
                    <div className="muted">{c.description}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Section>
        <div>
          <Section title="可计算指标与口径">
            <table className="tbl small">
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <b>{m.label}</b>
                    </td>
                    <td className="muted">{m.formula}</td>
                    <td>{m.threshold !== undefined ? `${m.direction === 'higher' ? '≥' : '≤'} ${(m.threshold * 100).toFixed(0)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Bad Case 根因层">
            <table className="tbl small">
              <tbody>
                {ROOT_CAUSES.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.label}</b>
                    </td>
                    <td className="muted">{r.description}</td>
                    <td>{r.fix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
      </div>

      <div className="grid2">
        <Section title="合规红线规则">
          <table className="tbl small">
            <tbody>
              {COMPLIANCE_RULES.map((r) => (
                <tr key={r.rule_id}>
                  <td>
                    <code>{r.rule_id}</code> {r.label}
                  </td>
                  <td>{r.severity === 'high' ? '高危' : r.severity === 'medium' ? '中' : '低'}</td>
                  <td className="muted">
                    {r.patterns.map((p) => p.source).join(' | ').slice(0, 160)}
                    {r.hypothetical_exempt ? '（假设语境豁免）' : ''}
                    {r.max_user_level ? `（仅对 C1–C${r.max_user_level}）` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">命中前 12 字内出现“不/无法/并非/不建议…”等否定词，或之后紧跟“是不存在的”，视为否定语境不计。产品类别默认等级（构造）：{PRODUCT_CATEGORIES.map((c) => `${c.term} R${c.level}`).join('、')}。</p>
        </Section>
        <Section title="KYC 字段分级与隐私边界">
          <table className="tbl small">
            <thead>
              <tr>
                <th>字段</th>
                <th>分级</th>
                <th>使用方式</th>
              </tr>
            </thead>
            <tbody>
              {KYC_FIELD_POLICY.map((f) => (
                <tr key={f.field}>
                  <td>{f.label}</td>
                  <td>
                    <Badge kind={f.grade === 'L1' ? 'pass' : f.grade === 'L2' ? 'warn' : 'fail'}>{f.grade}</Badge>
                  </td>
                  <td className="muted">{f.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">问题文本入库前统一脱敏（手机号、证件号、银行卡号、邮箱）；评测日志与界面只展示脱敏后的文本。</p>
        </Section>
      </div>

      <div className="grid2">
        <Section title="数据来源与接口记录（扶摇，真实调用）">
          <p>
            共 {calls.length} 次调用，抓取于 {s.bundle.meta.fetched_at}；每条事实保留 endpoint、参数、request_id 和抓取时间，可在评测记录详情的证据里看到。
          </p>
          <table className="tbl small">
            <thead>
              <tr>
                <th>endpoint</th>
                <th>调用</th>
                <th>成功</th>
                <th>平均耗时</th>
              </tr>
            </thead>
            <tbody>
              {byEndpoint.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    <code>{k}</code>
                  </td>
                  <td>{v.n}</td>
                  <td>{v.ok}</td>
                  <td>{(v.ms / v.n).toFixed(0)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="抓取时发现的数据/接口异常及处理">
          <ul>
            {s.bundle.fetch_log.anomalies.map((a, i) => (
              <li key={i}>
                <Badge kind="warn">{a.kind}</Badge> {a.detail}
                {a.request_id ? <span className="muted"> · request_id {a.request_id}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="被测 Agent 与评审的 Prompt（版本化）">
        {Object.entries(s.bundle.prompt_text).map(([k, v]) => (
          <details key={k}>
            <summary>
              {s.bundle.prompts.find((p) => p.prompt_id === k)?.label ?? k}
            </summary>
            <pre>{v}</pre>
          </details>
        ))}
        <details>
          <summary>路由 Prompt R1</summary>
          <pre>{s.bundle.router_prompt}</pre>
        </details>
        <details>
          <summary>LLM 评审 Prompt J1</summary>
          <pre>{s.bundle.judge_prompt}</pre>
        </details>
      </Section>
    </div>
  );
}
