"use client";

import type { Totals } from "@/lib/calc";
import type { Strings } from "@/lib/i18n";

interface Props {
  points: { year: number; t: Totals | null }[];
  year: number;
  compareYear: number | null;
  /** Jaren met dienstencijfers; andere jaren worden gearceerd ("alleen goederen"). */
  serviceYears: number[];
  /** Methodebreuken: de lijn wordt daar onderbroken. */
  breaks: { year: number; label: string }[];
  onYear: (year: number) => void;
  fmt: (amountMln: number, signed?: boolean, year?: number) => string;
  t: Strings;
}

const W = 340;
const H = 120;
const PAD = { l: 4, r: 4, t: 10, b: 20 };

/** Twee lijnen door de jaren heen: geld uit Nederland en geld naar Nederland. */
export default function TrendChart({ points, year, compareYear, serviceYears, breaks, onYear, fmt, t }: Props) {
  if (points.length < 2) return null;
  const max = Math.max(1e-9, ...points.flatMap((p) => (p.t ? [p.t.uit, p.t.in] : [])));
  const step = (W - PAD.l - PAD.r) / (points.length - 1);
  const x = (i: number) => PAD.l + i * step;
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const breakYears = new Set(breaks.map((b) => b.year));
  // Bij een methodebreuk of na een jaar zonder data begint de lijn opnieuw: anders lijkt een sprong een trend.
  const line = (key: "uit" | "in") =>
    points
      .map((p, i) => {
        if (!p.t) return "";
        const restart = i === 0 || breakYears.has(p.year) || !points[i - 1].t;
        return `${restart ? "M" : "L"}${x(i)},${y(p.t[key])}`;
      })
      .join(" ");
  const idx = (yr: number) => points.findIndex((p) => p.year === yr);
  const cur = idx(year);
  const cmp = compareYear != null ? idx(compareYear) : -1;

  // Aaneengesloten stukken zonder dienstencijfers.
  const goodsOnly: [number, number][] = [];
  points.forEach((p, i) => {
    if (serviceYears.includes(p.year)) return;
    const last = goodsOnly[goodsOnly.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else goodsOnly.push([i, i]);
  });

  return (
    <figure className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.trendAria}>
        {goodsOnly.map(([a, b]) => (
          <g key={a}>
            <rect x={Math.max(PAD.l, x(a) - step / 2)} y={PAD.t} width={x(b) - x(a) + step} height={H - PAD.t - PAD.b} className="trend__goods" />
            {b - a >= 2 && (
              <text x={x(a) + 2} y={PAD.t + 10} className="trend__note">
                {t.goodsOnly}
              </text>
            )}
          </g>
        ))}
        {breaks.map((b) => {
          const i = idx(b.year);
          if (i <= 0) return null;
          return (
            <line key={b.year} x1={x(i) - step / 2} x2={x(i) - step / 2} y1={PAD.t} y2={H - PAD.b} className="trend__break">
              <title>{`${b.year}: ${b.label} (${t.breakLabel})`}</title>
            </line>
          );
        })}
        {cmp >= 0 && <line x1={x(cmp)} x2={x(cmp)} y1={PAD.t} y2={H - PAD.b} className="trend__cursor trend__cursor--cmp" />}
        {cur >= 0 && <line x1={x(cur)} x2={x(cur)} y1={PAD.t} y2={H - PAD.b} className="trend__cursor" />}
        <path d={line("uit")} className="trend__line trend__line--uit" />
        <path d={line("in")} className="trend__line trend__line--in" />
        {points.map((p, i) => {
          const last = points.length - 1;
          // Randjaren alleen tonen als ze niet botsen met het gekozen of vergelijkingsjaar.
          const far = (j: number) => j < 0 || Math.abs(i - j) > 2;
          const label = i === cur || i === cmp || ((i === 0 || i === last) && far(cur) && far(cmp));
          const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
          return (
            <g key={p.year} className="trend__col" onClick={() => onYear(p.year)}>
              <title>
                {p.t ? `${p.year}\n${t.nlToLand}: ${fmt(p.t.uit, false, p.year)}\n${t.landToNl}: ${fmt(p.t.in, false, p.year)}` : `${p.year}: –`}
              </title>
              <rect x={x(i) - step / 2} y={0} width={step} height={H} className="trend__hit" />
              {p.t && (
                <>
                  <circle cx={x(i)} cy={y(p.t.uit)} r={i === cur ? 3.5 : 1.8} className="trend__dot trend__dot--uit" />
                  <circle cx={x(i)} cy={y(p.t.in)} r={i === cur ? 3.5 : 1.8} className="trend__dot trend__dot--in" />
                </>
              )}
              {label && (
                <text x={x(i)} y={H - 5} textAnchor={anchor} className={i === cur ? "trend__year trend__year--cur" : "trend__year"}>
                  {p.year}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
