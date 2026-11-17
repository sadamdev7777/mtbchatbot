"use client";
import { useState } from "react";

/** Validated chart colours (dataviz validator, light + dark): series green and AI purple. */
export const CHART = { green: "#0A8F6E", purple: "#5B4BC4", grid: "#E4E7EC" };

/** Single-series horizontal bars (magnitude): one hue, value labels, hover tooltip, table fallback. */
export function HBars({ data, label, format = (n: number) => n.toLocaleString() }: { data: { label: string; n: number; sub?: string }[]; label: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <figure className="m-0 flex flex-col gap-2" aria-label={label}>
      {data.map((d, i) => (
        <div key={d.label} className="relative grid grid-cols-[120px_1fr_64px] items-center gap-3 text-sm" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="truncate text-body">{d.label}</span>
          <span className="relative h-6">
            <span className="absolute inset-y-1 left-0 rounded-r-[4px]" style={{ width: `${(d.n / max) * 100}%`, minWidth: d.n ? 3 : 0, background: CHART.green }} />
            {hover === i ? <span role="tooltip" className="absolute -top-8 left-0 z-10 rounded-md bg-ink px-2 py-1 text-xs text-white shadow">{d.label}: {format(d.n)}{d.sub ? ` · ${d.sub}` : ""}</span> : null}
          </span>
          <span className="text-right font-semibold text-ink">{format(d.n)}</span>
        </div>
      ))}
      <details className="text-xs text-muted"><summary className="cursor-pointer">Show as table</summary>
        <table className="mt-1"><tbody>{data.map((d) => <tr key={d.label}><td className="pr-4">{d.label}</td><td>{format(d.n)}</td></tr>)}</tbody></table></details>
    </figure>
  );
}

/** Vertical single-series bars over time (e.g. handovers per day) with hover tooltip. */
export function VBars({ data, label }: { data: { label: string; n: number }[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="text-sm text-muted">No data for this period.</p>;
  return (
    <figure className="m-0" aria-label={label}>
      <div className="relative flex h-40 items-end gap-[2px] border-b" style={{ borderColor: CHART.grid }}>
        {data.map((d, i) => (
          <div key={d.label} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className="w-full rounded-t-[4px]" style={{ height: `${(d.n / max) * 100}%`, minHeight: d.n ? 3 : 0, background: CHART.green, opacity: hover === null || hover === i ? 1 : 0.6 }} />
            {hover === i ? <span role="tooltip" className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs text-white">{d.label}: {d.n}</span> : null}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted"><span>{data[0].label}</span><span>{data.at(-1)!.label}</span></div>
      <details className="text-xs text-muted"><summary className="cursor-pointer">Show as table</summary>
        <table className="mt-1"><tbody>{data.map((d) => <tr key={d.label}><td className="pr-4">{d.label}</td><td>{d.n}</td></tr>)}</tbody></table></details>
    </figure>
  );
}

/** Two-part share bar (bot only vs handed to staff), direct-labelled + legend. */
export function ShareBar({ a, b }: { a: { label: string; n: number }; b: { label: string; n: number } }) {
  const total = a.n + b.n;
  const pa = total ? Math.round((a.n / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-6 gap-[2px] overflow-hidden rounded-[4px]" role="img" aria-label={`${a.label} ${pa}%, ${b.label} ${100 - pa}%`}>
        {total ? <>
          <span title={`${a.label}: ${a.n}`} style={{ width: `${pa}%`, background: CHART.green }} />
          <span title={`${b.label}: ${b.n}`} style={{ width: `${100 - pa}%`, background: CHART.purple }} />
        </> : <span className="w-full bg-chip" />}
      </div>
      <div className="flex justify-between text-sm">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART.green }} />{a.label} <strong>{pa}%</strong> ({a.n})</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART.purple }} />{b.label} <strong>{total ? 100 - pa : 0}%</strong> ({b.n})</span>
      </div>
    </div>
  );
}
