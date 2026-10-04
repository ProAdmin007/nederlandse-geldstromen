"use client";

import { useMemo, useState } from "react";
import type { Country, DataType, Dataset, Flow } from "@/lib/types";
import {
  ranked,
  recipientsFor,
  sumDataType,
  totals,
  totalsBy,
  trend,
  yearsOf,
  type Options,
} from "@/lib/calc";
import { CATEGORIES, CATEGORY_LABELS, DATATYPE_LABELS, SECTOR_LABELS } from "@/lib/data";
import TrendChart from "./TrendChart";

export type Fmt = (amountMln: number, signed?: boolean, year?: number) => string;

interface Ctx {
  data: Dataset;
  opts: Options;
  resolved: Map<string, Flow[]>;
  fmt: Fmt;
  onYear: (year: number) => void;
}

export function Badge({ type }: { type: DataType }) {
  return <span className={`badge badge--${type}`}>{DATATYPE_LABELS[type]}</span>;
}

function SourceRef({ data, id, year }: { data: Dataset; id: string; year: number | string }) {
  const s = data.sources[id];
  if (!s) return <span className="src">Onbekende bron · {year}</span>;
  const label = `${s.publisher} – ${s.name}`;
  return (
    <span className="src">
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer">
          {label}
        </a>
      ) : (
        label
      )}{" "}
      · {year}
    </span>
  );
}

function Stat({ label, value, flows, tone, year }: { label: string; value: string; flows: Flow[]; tone: string; year: number }) {
  return (
    <div className={`stat stat--${tone}`}>
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {flows.length > 0 && (
        <div className="stat__meta">
          <Badge type={sumDataType(flows)} />
          <span>
            som van {flows.length} {flows.length === 1 ? "regel" : "regels"} · {year}
          </span>
        </div>
      )}
    </div>
  );
}

function Stats({ flows, name, ctx }: { flows: Flow[]; name?: string; ctx: Ctx }) {
  const t = totals(flows);
  const y = ctx.opts.year;
  return (
    <div className="stats">
      <Stat label={name ? `Nederland → ${name}` : "Uit Nederland"} value={ctx.fmt(t.uit)} flows={flows.filter((f) => f.direction === "uit")} tone="uit" year={y} />
      <Stat label={name ? `${name} → Nederland` : "Naar Nederland"} value={ctx.fmt(t.in)} flows={flows.filter((f) => f.direction === "in")} tone="in" year={y} />
      <Stat
        label={t.netto >= 0 ? "Netto naar Nederland" : "Netto uit Nederland"}
        value={ctx.fmt(t.netto, true)}
        flows={flows}
        tone={t.netto >= 0 ? "in" : "uit"}
        year={y}
      />
    </div>
  );
}

/** Eerlijke uitleg bij filters waar de data dun of afgeleid is. */
function FilterNotes({ ctx }: { ctx: Ctx }) {
  const { opts, data } = ctx;
  const notes: string[] = [];
  const servicesFrom = Math.min(...data.meta.serviceYears);
  if (opts.year < servicesFrom) notes.push(`Voor ${servicesFrom} zijn er geen dienstencijfers per land: je ziet alleen goederen en energie.`);
  if (opts.sector === "consumenten")
    notes.push(
      "Alleen privé reisverkeer (vakanties) is per land officieel bekend. Wat consumenten aan buitenlandse producten en webwinkels uitgeven, splitst CBS niet uit naar land; dat zit bij bedrijven, die de goederen invoeren.",
    );
  if (opts.sector === "overheid")
    notes.push(
      "De overheid koopt veel via Nederlandse tussenpartijen. Hier staan officiële overheidsdiensten (CBS) en geschatte defensie-aankopen; IT-uitgaven staan bij de ontvangers.",
    );
  if (opts.sector === "bedrijven")
    notes.push("CBS splitst handel niet uit naar wie betaalt. Alles wat niet aan overheid of consumenten is toe te rekenen, staat hier.");
  if (!opts.reexport)
    notes.push("Zonder wederuitvoer: goederen die Nederland alleen doorvoert zijn aan beide kanten afgetrokken. Wat overblijft is wat Nederland zelf gebruikt en zelf maakt.");
  if (opts.ultimate)
    notes.push("Uiteindelijke ontvanger: IT-diensten die vanuit Ierland worden gefactureerd zijn voor 90% toegerekend aan de VS (schatting).");
  if (opts.category === "defensie") notes.push("Defensie-aankopen zijn schattingen: jaarbedragen per land zijn vertrouwelijk.");
  if (!notes.length) return null;
  return (
    <ul className="filter-notes">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function Recipients({ ctx, countryId, title }: { ctx: Ctx; countryId?: string; title: string }) {
  const list = recipientsFor(ctx.data, ctx.opts, countryId);
  if (!list.length) return null;
  return (
    <>
      <h3>{title}</h3>
      <p className="muted small">Wat Nederland aan deze partijen betaalt, voor zover er een bron voor is. Dit zit al in de bedragen hierboven.</p>
      <ul className="rows">
        {list.map((r) => (
          <li key={`${r.name}-${r.year}`} className="row">
            <div className="row__main">
              <strong>{r.name}</strong>
              <span className="muted"> · {CATEGORY_LABELS[r.category]} · {SECTOR_LABELS[r.sector]}</span>
              {r.note && <div className="muted small">{r.note}</div>}
              <SourceRef data={ctx.data} id={r.source} year={r.year} />
            </div>
            <div className="row__side">
              <span className="amount">{ctx.fmt(r.amount, false, r.year)}</span>
              <Badge type={r.dataType} />
              {r.stale && <span className="muted small">cijfer {r.year}</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function CategoryBars({ flows, ctx }: { flows: Flow[]; ctx: Ctx }) {
  const byCat = totalsBy(flows, CATEGORIES, (f) => f.category);
  const cats = CATEGORIES.filter((c) => byCat[c].uit > 0 || byCat[c].in > 0);
  const max = Math.max(1e-9, ...cats.flatMap((c) => [byCat[c].uit, byCat[c].in]));
  if (!cats.length) return null;
  return (
    <>
      <h3>Verdeling per categorie</h3>
      <div className="cats">
        {cats.map((c) => (
          <div className="cat" key={c}>
            <div className="cat__name">{CATEGORY_LABELS[c]}</div>
            <div className="cat__bars">
              {(["uit", "in"] as const).map((d) => (
                <div className="bar" key={d}>
                  <span className={`bar__fill bar__fill--${d}`} style={{ width: `calc((100% - 90px) * ${byCat[c][d] / max})` }} />
                  <span className="bar__val">{byCat[c][d] > 0 ? ctx.fmt(byCat[c][d]) : "–"}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function CountryDetail({ country, ctx, onClose }: { country: Country; ctx: Ctx; onClose: () => void }) {
  const flows = ctx.resolved.get(country.id) ?? [];
  const { year: _y, ...rest } = ctx.opts;
  const points = useMemo(() => trend(ctx.data, rest, country.id), [ctx.data, country.id, JSON.stringify(rest)]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = [...flows].sort((a, b) => b.amount - a.amount);

  return (
    <div className="detail">
      <div className="detail__head">
        <div>
          <h2>{country.name}</h2>
          <p className="muted">
            {ctx.opts.year} · {SECTOR_LABELS[ctx.opts.sector]} · {CATEGORY_LABELS[ctx.opts.category]}
          </p>
        </div>
        <button className="close" onClick={onClose} aria-label="Sluiten">
          ×
        </button>
      </div>

      <Stats flows={flows} name={country.name} ctx={ctx} />
      <FilterNotes ctx={ctx} />

      <h3>Verloop</h3>
      <TrendChart points={points} year={ctx.opts.year} servicesFrom={Math.min(...ctx.data.meta.serviceYears)} onYear={ctx.onYear} fmt={ctx.fmt} />

      {flows.length === 0 ? (
        <p className="muted">Geen geldstromen bekend voor deze selectie.</p>
      ) : (
        <CategoryBars flows={flows} ctx={ctx} />
      )}

      <Recipients ctx={ctx} countryId={country.id} title="Bekende ontvangers" />

      {sorted.length > 0 && (
        <>
          <h3>Alle bedragen</h3>
          <ul className="rows">
            {sorted.map((f, i) => (
              <li key={i} className="row">
                <div className="row__main">
                  <span className={`dir dir--${f.direction}`}>
                    {f.direction === "uit" ? `NL → ${country.name}` : `${country.name} → NL`}
                  </span>
                  <div>
                    <strong>{CATEGORY_LABELS[f.category]}</strong>
                    <span className="muted"> · {SECTOR_LABELS[f.sector]}</span>
                  </div>
                  {f.movedFrom && <div className="small moved">Toegerekend vanuit {f.movedFrom}</div>}
                  {f.note && <div className="muted small">{f.note}</div>}
                  {f.adjustments?.map((a) => (
                    <div key={a.label} className="muted small">
                      Afgetrokken: {a.label} ({ctx.fmt(a.amount)}, {DATATYPE_LABELS[a.dataType].toLowerCase()})
                    </div>
                  ))}
                  <SourceRef data={ctx.data} id={f.source} year={f.year} />
                </div>
                <div className="row__side">
                  <span className="amount">{ctx.fmt(f.amount)}</span>
                  <Badge type={f.dataType} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const SHOW = 15;

export function Overview({ ctx, onSelect }: { ctx: Ctx; onSelect: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const rows = ranked(ctx.data, ctx.resolved);
  const flows = [...ctx.resolved.values()].flat();
  const max = Math.max(1e-9, ...rows.flatMap((r) => [r.t.uit, r.t.in]));
  const { year: _y, ...rest } = ctx.opts;
  const points = useMemo(() => trend(ctx.data, rest), [ctx.data, JSON.stringify(rest)]); // eslint-disable-line react-hooks/exhaustive-deps
  const cat = ctx.opts.category;

  return (
    <div className="detail">
      <h2>{cat === "alles" ? "Overzicht" : CATEGORY_LABELS[cat]}</h2>
      <p className="muted">
        {ctx.opts.year} · {SECTOR_LABELS[ctx.opts.sector]} · klik op een land op de kaart of in de lijst.
      </p>
      <Stats flows={flows} ctx={ctx} />
      <FilterNotes ctx={ctx} />

      <h3>Verloop</h3>
      <TrendChart points={points} year={ctx.opts.year} servicesFrom={Math.min(...ctx.data.meta.serviceYears)} onYear={ctx.onYear} fmt={ctx.fmt} />

      {cat === "alles" && <CategoryBars flows={flows} ctx={ctx} />}

      <h3>{cat === "alles" ? "Landen" : `Waar gaat het geld voor ${CATEGORY_LABELS[cat].toLowerCase()} heen?`}</h3>
      <ul className="ranking">
        {(all ? rows : rows.slice(0, SHOW)).map(({ country, t }) => (
          <li key={country.id}>
            <button onClick={() => onSelect(country.id)}>
              <span className="ranking__name">{country.name}</span>
              <span className="ranking__bars">
                <span className="mini mini--uit" style={{ width: `${(t.uit / max) * 100}%` }} />
                <span className="mini mini--in" style={{ width: `${(t.in / max) * 100}%` }} />
              </span>
              <span className="ranking__nums">
                <span className="tone-uit">{ctx.fmt(t.uit)}</span>
                <span className="tone-in">{ctx.fmt(t.in)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > SHOW && (
        <button className="link-button" onClick={() => setAll((a) => !a)}>
          {all ? "Minder tonen" : `Alle ${rows.length} landen tonen`}
        </button>
      )}

      <Recipients ctx={ctx} title={cat === "alles" ? "Bekende ontvangers" : "Bekende ontvangers in deze categorie"} />
      <p className="muted small">Jaren met data: {yearsOf(ctx.data.meta.years.map((year) => ({ year })))}.</p>
    </div>
  );
}
