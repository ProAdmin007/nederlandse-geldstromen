"use client";

import { useState } from "react";
import { formatChange, ranked, sumDataType, toCsv, totals, type Options } from "@/lib/calc";
import type { Dataset, Flow, Lang } from "@/lib/types";
import { Badge, type Ctx } from "./Panel";

type SortKey = "name" | "uit" | "in" | "netto" | "change";

export function downloadCsv(data: Dataset, resolved: Map<string, Flow[]>, opts: Options, lang: Lang) {
  // BOM zodat Excel de accenten goed leest.
  const blob = new Blob(["﻿" + toCsv(data, resolved, opts, lang)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${lang === "en" ? "money-flows" : "geldstromen"}-${opts.year}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Toegankelijk alternatief voor de kaart: alle landen in een sorteerbare tabel. */
export default function DataTable({ ctx, selectedId, onSelect }: { ctx: Ctx; selectedId: string | null; onSelect: (id: string) => void }) {
  const { data, resolved, opts, fmt, t, lang, compare } = ctx;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "uit", desc: true });
  const prev = (id: string) => (compare ? totals(compare.resolved.get(id) ?? []) : null);
  const growth = (id: string, now: number) => {
    const p = prev(id);
    const before = p ? p.uit + p.in : 0;
    return before > 0 ? (now - before) / before : Infinity;
  };
  const rows = ranked(data, resolved).sort((a, b) => {
    const v =
      sort.key === "name"
        ? a.country.name.localeCompare(b.country.name, lang)
        : sort.key === "change"
          ? growth(a.country.id, a.t.uit + a.t.in) - growth(b.country.id, b.t.uit + b.t.in)
          : a.t[sort.key] - b.t[sort.key];
    return sort.desc ? -v : v;
  });

  const th = (key: SortKey, label: string, num = true) => (
    <th scope="col" className={num ? "num" : undefined} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}>
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div className="table-wrap">
      <div className="table-head">
        <p className="muted small">{t.tableIntro(rows.length, opts.year)}</p>
        <button className="button" onClick={() => downloadCsv(data, resolved, opts, lang)}>
          {t.csvDownload}
        </button>
      </div>
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">{t.tableCaption(opts.year)}</caption>
          <thead>
            <tr>
              {th("name", t.country, false)}
              {th("uit", t.nlToLand)}
              {th("in", t.landToNl)}
              {th("netto", t.net)}
              {compare && th("change", `${t.change} ${t.vs} ${compare.year}`)}
              <th scope="col">{t.quality}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ country, t: tot }) => {
              const p = prev(country.id);
              return (
                <tr key={country.id} className={country.id === selectedId ? "is-selected" : undefined}>
                  <th scope="row">
                    <button className="link-button" onClick={() => onSelect(country.id)}>
                      {country.name}
                    </button>
                  </th>
                  <td className="num tone-uit">{fmt(tot.uit)}</td>
                  <td className="num tone-in">{fmt(tot.in)}</td>
                  <td className="num">{fmt(tot.netto, true)}</td>
                  {compare && <td className="num">{p ? formatChange(p.uit + p.in, tot.uit + tot.in, lang) : ""}</td>}
                  <td>
                    <Badge type={sumDataType(resolved.get(country.id) ?? [])} lang={lang} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
