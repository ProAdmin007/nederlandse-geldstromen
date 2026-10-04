"use client";

import { useState } from "react";
import { ranked, sumDataType, toCsv, type Options } from "@/lib/calc";
import type { Dataset, Flow } from "@/lib/types";
import { Badge, type Fmt } from "./Panel";

type SortKey = "name" | "uit" | "in" | "netto";

interface Props {
  data: Dataset;
  resolved: Map<string, Flow[]>;
  opts: Options;
  fmt: Fmt;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function downloadCsv(data: Dataset, resolved: Map<string, Flow[]>, opts: Options) {
  // BOM zodat Excel de accenten goed leest.
  const blob = new Blob(["﻿" + toCsv(data, resolved, opts)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `geldstromen-${opts.year}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Toegankelijk alternatief voor de kaart: alle landen in een sorteerbare tabel. */
export default function DataTable({ data, resolved, opts, fmt, selectedId, onSelect }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "uit", desc: true });
  const rows = ranked(data, resolved).sort((a, b) => {
    const v =
      sort.key === "name" ? a.country.name.localeCompare(b.country.name, "nl") : a.t[sort.key] - b.t[sort.key];
    return sort.desc ? -v : v;
  });

  const th = (key: SortKey, label: string, num = true) => (
    <th
      scope="col"
      className={num ? "num" : undefined}
      aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}
    >
      <button onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}>
        {label}
        {sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div className="table-wrap">
      <div className="table-head">
        <p className="muted small">
          {rows.length} landen · {opts.year}. Klik op een land voor details, of op een kolomkop om te sorteren.
        </p>
        <button className="button" onClick={() => downloadCsv(data, resolved, opts)}>
          CSV downloaden
        </button>
      </div>
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Geldstromen tussen Nederland en andere landen in {opts.year}</caption>
          <thead>
            <tr>
              {th("name", "Land", false)}
              {th("uit", "NL → land")}
              {th("in", "Land → NL")}
              {th("netto", "Netto")}
              <th scope="col">Kwaliteit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ country, t }) => (
              <tr key={country.id} className={country.id === selectedId ? "is-selected" : undefined}>
                <th scope="row">
                  <button className="link-button" onClick={() => onSelect(country.id)}>
                    {country.name}
                  </button>
                </th>
                <td className="num tone-uit">{fmt(t.uit)}</td>
                <td className="num tone-in">{fmt(t.in)}</td>
                <td className="num">{fmt(t.netto, true)}</td>
                <td>
                  <Badge type={sumDataType(resolved.get(country.id) ?? [])} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
