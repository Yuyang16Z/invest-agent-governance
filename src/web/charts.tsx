import { useState } from 'react';

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** 悬停时显示的分子/分母 */
  details?: string[];
}

/** 版本演进折线图：x 为版本，y 为 0–100% 比率；终点直接标注，悬停显示十字线与各系列数值 */
export function LineChart({ xLabels, series, height = 240 }: { xLabels: string[]; series: LineSeries[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const pad = { l: 40, r: 132, t: 14, b: 30 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (xLabels.length === 1 ? pw / 2 : (i * pw) / (xLabels.length - 1));
  const y = (v: number) => pad.t + (1 - v) * ph;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  // 终点标签：按 y 排序后上下推开，避免重叠
  const ends = series
    .map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && s.values[i] === null) i--;
      return { s, i, y: i >= 0 ? y(s.values[i]!) : 0 };
    })
    .filter((e) => e.i >= 0)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 15) ends[k].y = ends[k - 1].y + 15;

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.id}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`版本演进：${series.map((s) => s.label).join('、')}`}>
        <g className="grid">
          {ticks.map((t) => (
            <line key={t} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          ))}
        </g>
        <g className="axis">
          {ticks.map((t) => (
            <text key={t} x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          ))}
          {xLabels.map((l, i) => (
            <text key={l} x={x(i)} y={H - 8} textAnchor="middle" style={{ fontWeight: hover === i ? 700 : 400 }}>
              {l}
            </text>
          ))}
        </g>
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ph} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" /> : null}
        {series.map((s) => {
          const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
          return <polyline key={s.id} points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
        })}
        {series.map((s) =>
          s.values.map((v, i) =>
            v === null ? null : <circle key={`${s.id}-${i}`} cx={x(i)} cy={y(v)} r={hover === i ? 5.5 : 4} fill={s.color} stroke="#fff" strokeWidth={2} />,
          ),
        )}
        {ends.map((e) => (
          <text key={e.s.id} className="series-label" x={x(e.i) + 12} y={e.y + 4}>
            {e.s.label} {Math.round(e.s.values[e.i]! * 100)}%
          </text>
        ))}
        {xLabels.map((_, i) => (
          <rect key={i} x={x(i) - pw / (2 * Math.max(1, xLabels.length - 1))} y={pad.t} width={pw / Math.max(1, xLabels.length - 1)} height={ph} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null ? (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%`, top: 26 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{xLabels[hover]}</div>
          {series.map((s) => (
            <div className="t-row" key={s.id}>
              <span>
                <i style={{ background: s.color }} />
                {s.label}
              </span>
              <span>
                {s.values[hover] === null ? '—' : `${(s.values[hover]! * 100).toFixed(1)}%`}
                {s.details?.[hover] ? <span style={{ opacity: 0.7 }}> ({s.details[hover]})</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
