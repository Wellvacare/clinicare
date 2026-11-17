import { useState } from 'react';
import { fmtDate } from './api.js';

const W = 640; const H = 220; const P = { l: 44, r: 12, t: 12, b: 28 };
const niceMax = (v) => { if (v <= 0) return 10; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

/** Grouped bar chart. series: [{ key, label, color }] ; data: [{ date, ...values }] */
export function BarChart({ data, series, format = (v) => v, height = H }) {
  const [hover, setHover] = useState(null);
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key] || 0))));
  const iw = W - P.l - P.r; const ih = height - P.t - P.b;
  const band = iw / Math.max(1, data.length); const bw = Math.min(28, (band * 0.7) / series.length);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.ceil(data.length / 8);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={`Chart of ${series.map((s) => s.label).join(' and ')} by day`}>
        {ticks.map((t) => {
          const y = P.t + ih - (t / max) * ih;
          return <g key={t}><line x1={P.l} x2={W - P.r} y1={y} y2={y} className="stroke-slate-200 dark:stroke-slate-800" /><text x={P.l - 6} y={y + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{format(t)}</text></g>;
        })}
        {data.map((d, i) => {
          const x0 = P.l + i * band + (band - bw * series.length) / 2;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={P.l + i * band} y={P.t} width={band} height={ih} fill="transparent" />
              {series.map((s, k) => {
                const h = ((d[s.key] || 0) / max) * ih;
                return <rect key={s.key} x={x0 + k * bw} y={P.t + ih - h} width={bw - 2} height={Math.max(h, 0)} rx="3" fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
              })}
              {i % every === 0 && <text x={P.l + i * band + band / 2} y={height - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">{fmtDate(d.date, { day: 'numeric', month: 'short' })}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute right-2 top-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <p className="mb-1 font-medium">{fmtDate(data[hover].date, { weekday: 'short', day: 'numeric', month: 'short' })}</p>
          {series.map((s) => <p key={s.key} className="flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}: <b>{format(data[hover][s.key] || 0)}</b></p>)}
        </div>
      )}
      <div className="mt-2 flex justify-center gap-4 text-xs text-slate-500">
        {series.map((s) => <span key={s.key} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}

/** Horizontal stacked share bar for status mix. */
export function StackBar({ items }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return <p className="text-sm text-slate-500">No appointments in this period.</p>;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label="Appointment status mix">
        {items.filter((i) => i.value).map((i) => <div key={i.label} style={{ width: `${(i.value / total) * 100}%`, background: i.color }} title={`${i.label}: ${i.value}`} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {items.map((i) => <li key={i.label} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><span className="size-2.5 rounded-full" style={{ background: i.color }} />{i.label}</span><b>{i.value}</b></li>)}
      </ul>
    </div>
  );
}
