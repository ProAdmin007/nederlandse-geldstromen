"use client";

import type { Totals } from "@/lib/calc";

interface Props {
  points: { year: number; t: Totals }[];
  year: number;
  /** Eerste jaar met dienstencijfers; daarvoor alleen goederen. */
  servicesFrom: number;
  onYear: (year: number) => void;
  fmt: (amountMln: number, signed?: boolean, year?: number) => string;
}

const W = 340;
const H = 120;
const PAD = { l: 4, r: 4, t: 10, b: 20 };

/** Twee lijnen door de jaren heen: geld uit Nederland en geld naar Nederland. */
export default function TrendChart({ points, year, servicesFrom, onYear, fmt }: Props) {
  if (points.length < 2) return null;
  const max = Math.max(1e-9, ...points.flatMap((p) => [p.t.uit, p.t.in]));
  const step = (W - PAD.l - PAD.r) / (points.length - 1);
  const x = (i: number) => PAD.l + i * step;
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const sIdx = points.findIndex((p) => p.year >= servicesFrom);
  // Waar de dienstencijfers beginnen, breekt de lijn af: anders lijkt die sprong een trend.
  const line = (key: "uit" | "in") =>
    points.map((p, i) => `${i === 0 || i === sIdx ? "M" : "L"}${x(i)},${y(p.t[key])}`).join(" ");
  const cur = points.findIndex((p) => p.year === year);

  return (
    <figure className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Verloop door de jaren">
        {sIdx > 0 && (
          <g>
            <rect x={PAD.l} y={PAD.t} width={x(sIdx) - PAD.l - step / 2} height={H - PAD.t - PAD.b} className="trend__goods" />
            <text x={PAD.l + 4} y={PAD.t + 10} className="trend__note">
              alleen goederen
            </text>
          </g>
        )}
        {cur >= 0 && <line x1={x(cur)} x2={x(cur)} y1={PAD.t} y2={H - PAD.b} className="trend__cursor" />}
        <path d={line("uit")} className="trend__line trend__line--uit" />
        <path d={line("in")} className="trend__line trend__line--in" />
        {points.map((p, i) => (
          <g key={p.year} className="trend__col" onClick={() => onYear(p.year)}>
            <title>{`${p.year}\nNL → land: ${fmt(p.t.uit, false, p.year)}\nLand → NL: ${fmt(p.t.in, false, p.year)}`}</title>
            <rect x={x(i) - step / 2} y={0} width={step} height={H} className="trend__hit" />
            <circle cx={x(i)} cy={y(p.t.uit)} r={i === cur ? 3.5 : 2} className="trend__dot trend__dot--uit" />
            <circle cx={x(i)} cy={y(p.t.in)} r={i === cur ? 3.5 : 2} className="trend__dot trend__dot--in" />
            {(i === 0 || i === points.length - 1 || i === cur) && (
              <text x={x(i)} y={H - 5} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} className={i === cur ? "trend__year trend__year--cur" : "trend__year"}>
                {p.year}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}
