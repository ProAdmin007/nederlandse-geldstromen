"use client";

import { useMemo, useState } from "react";
import { sankey, sankeyLinkHorizontal, type SankeyGraph } from "d3-sankey";
import type { Category, Direction } from "@/lib/types";
import { CATEGORIES } from "@/lib/data";
import { CATEGORY_LABELS } from "@/lib/i18n";
import type { Ctx } from "./Panel";

const W = 960;
const H = 580;
/** Zoveel landen apart; de rest wordt "Overige landen". */
const TOP = 14;
const OTHER = "__overig";

/** Rustige, goed te onderscheiden kleuren per categorie. */
const COLORS: Record<Category, string> = {
  goederen: "#4e79a7",
  energie: "#e15759",
  diensten: "#76b7b2",
  it: "#59a14f",
  ie: "#b07aa1",
  defensie: "#9c755f",
  hulp: "#edc948",
  eu: "#2f6fb0",
  uitkeringen: "#ff9da7",
  overmakingen: "#f28e2b",
};

interface NodeDatum {
  id: string;
  label: string;
  kind: "category" | "country";
  color?: string;
}
interface LinkDatum {
  source: string;
  target: string;
  value: number;
  color: string;
}

/**
 * "Waar gaat elke euro heen?": een stroomdiagram van categorieën naar landen voor het gekozen jaar
 * en de gekozen filters. Breedte = bedrag.
 */
export default function FlowDiagram({ ctx, onSelect }: { ctx: Ctx; onSelect: (id: string) => void }) {
  const { data, resolved, fmt, t, lang } = ctx;
  const [direction, setDirection] = useState<Direction>("uit");
  const [hover, setHover] = useState<string | null>(null);

  const graph = useMemo(() => {
    // Totalen per land en per (land, categorie) in de gekozen richting.
    const perCountry = new Map<string, number>();
    const perPair = new Map<string, number>();
    for (const c of data.countries) {
      for (const f of resolved.get(c.id) ?? []) {
        if (f.direction !== direction || f.amount <= 0) continue;
        perCountry.set(c.id, (perCountry.get(c.id) ?? 0) + f.amount);
        const k = `${c.id}|${f.category}`;
        perPair.set(k, (perPair.get(k) ?? 0) + f.amount);
      }
    }
    const top = [...perCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([id]) => id);
    const topSet = new Set(top);
    const links = new Map<string, LinkDatum>();
    for (const [k, v] of perPair) {
      const [cid, cat] = k.split("|") as [string, Category];
      const target = topSet.has(cid) ? cid : OTHER;
      const key = `${cat}|${target}`;
      const l = links.get(key) ?? { source: cat, target, value: 0, color: COLORS[cat] };
      l.value += v;
      links.set(key, l);
    }
    const cats = CATEGORIES.filter((c) => [...links.values()].some((l) => l.source === c));
    const nodes: NodeDatum[] = [
      ...cats.map((c) => ({ id: c, label: CATEGORY_LABELS[lang][c], kind: "category" as const, color: COLORS[c] })),
      ...top.map((id) => ({ id, label: data.countries.find((c) => c.id === id)!.name, kind: "country" as const })),
    ];
    if ([...links.values()].some((l) => l.target === OTHER))
      nodes.push({ id: OTHER, label: lang === "en" ? "Other countries" : "Overige landen", kind: "country" });
    if (!links.size) return null;

    const layout = sankey<NodeDatum, LinkDatum>()
      .nodeId((n) => n.id)
      .nodeWidth(12)
      .nodePadding(16)
      .nodeSort(null)
      .extent([
        [250, 10],
        [W - 200, H - 10],
      ]);
    return layout({ nodes: nodes.map((n) => ({ ...n })), links: [...links.values()].map((l) => ({ ...l })) }) as SankeyGraph<
      NodeDatum,
      LinkDatum
    >;
  }, [data, resolved, direction, lang]);

  const total = graph ? graph.links.reduce((n, l) => n + (l.value ?? 0), 0) : 0;
  const active = (l: { source: unknown; target: unknown }) => {
    if (!hover) return true;
    const s = (l.source as NodeDatum).id;
    const tg = (l.target as NodeDatum).id;
    return s === hover || tg === hover;
  };
  const pct = (v: number) => `${Math.round((v / total) * 1000) / 10}%`.replace(".", lang === "en" ? "." : ",");

  return (
    <div className="flows">
      <div className="flows__head">
        <div>
          <h2>{direction === "uit" ? t.flowsOutTitle : t.flowsInTitle}</h2>
          <p className="muted small">{t.flowsIntro(fmt(total))}</p>
        </div>
        <div className="segmented" role="group" aria-label={t.flowsDirection}>
          <button aria-pressed={direction === "uit"} onClick={() => setDirection("uit")}>
            {t.legendOut}
          </button>
          <button aria-pressed={direction === "in"} onClick={() => setDirection("in")}>
            {t.legendIn}
          </button>
        </div>
      </div>
      {!graph ? (
        <p className="muted">{t.noFlows}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="flows__svg" role="img" aria-label={direction === "uit" ? t.flowsOutTitle : t.flowsInTitle}>
          <g fill="none">
            {graph.links.map((l, i) => (
              <path
                key={i}
                d={sankeyLinkHorizontal()(l) ?? undefined}
                stroke={l.color}
                strokeWidth={Math.max(1, l.width ?? 1)}
                className={active(l) ? "flows__link" : "flows__link flows__link--dim"}
              >
                <title>{`${(l.source as NodeDatum).label} → ${(l.target as NodeDatum).label}: ${fmt(l.value)} (${pct(l.value)})`}</title>
              </path>
            ))}
          </g>
          {graph.nodes.map((n) => {
            const x0 = n.x0 ?? 0;
            const x1 = n.x1 ?? 0;
            const y0 = n.y0 ?? 0;
            const y1 = n.y1 ?? 0;
            const left = n.kind === "category";
            const clickable = n.kind === "country" && n.id !== OTHER;
            return (
              <g
                key={n.id}
                className={clickable ? "flows__node flows__node--click" : "flows__node"}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={clickable ? () => onSelect(n.id) : undefined}
              >
                <rect x={x0} y={y0} width={x1 - x0} height={Math.max(1, y1 - y0)} fill={n.color ?? "var(--accent)"} rx={2} />
                <text
                  x={left ? x0 - 8 : x1 + 8}
                  y={(y0 + y1) / 2}
                  dy="0.35em"
                  textAnchor={left ? "end" : "start"}
                  className="flows__label"
                >
                  {n.label}
                  <tspan className="flows__value"> {fmt(n.value ?? 0)}</tspan>
                </text>
                <title>{`${n.label}: ${fmt(n.value ?? 0)} (${pct(n.value ?? 0)})`}</title>
              </g>
            );
          })}
        </svg>
      )}
      <p className="muted small">{t.flowsHint}</p>
    </div>
  );
}
