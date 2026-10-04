"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import WorldMap from "./WorldMap";
import DataTable, { downloadCsv } from "./DataTable";
import { Badge, CountryDetail, Overview, type Fmt } from "./Panel";
import { format, resolveAll, type CategoryFilter, type Options, type SectorFilter, type Unit } from "@/lib/calc";
import { CATEGORIES, CATEGORY_LABELS, SECTOR_LABELS, UNIT_LABELS, useDataset } from "@/lib/data";
import { useUrlState, type ViewState } from "@/lib/urlState";

const SECTORS = Object.keys(SECTOR_LABELS) as SectorFilter[];
const UNITS = Object.keys(UNIT_LABELS) as Unit[];

export default function App() {
  const { data, error } = useDataset();
  const years = data?.meta.years ?? [];
  const fallback = useMemo<ViewState | null>(
    () =>
      data && {
        year: Math.max(...data.meta.years),
        sector: "alles",
        category: "alles",
        unit: "eur",
        reexport: true,
        estimates: true,
        ultimate: false,
        table: false,
        country: null,
      },
    [data],
  );
  const [state, update] = useUrlState(fallback, years);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

  const opts: Options | null = state && {
    year: state.year,
    sector: state.sector,
    category: state.category,
    reexport: state.reexport,
    estimates: state.estimates,
    ultimate: state.ultimate,
  };
  const resolved = useMemo(() => (data && opts ? resolveAll(data, opts) : new Map()), [data, JSON.stringify(opts)]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt: Fmt = useCallback(
    (amount, signed = false, year) => (data && state ? format(amount, state.unit, year ?? state.year, data.meta, signed) : ""),
    [data, state],
  );

  // Afspelen: elk jaar 1,4 seconde, stopt aan het eind.
  useEffect(() => {
    if (!playing || !state) return;
    const next = years.find((y) => y > state.year);
    if (next == null) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => update({ year: next }), 1400);
    return () => clearTimeout(t);
  }, [playing, state, years]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error)
    return (
      <main className="page">
        <p className="notice">Kon de data niet laden ({error}). Draai eerst <code>npm run data:build</code>.</p>
      </main>
    );
  if (!data || !state || !opts)
    return (
      <main className="page">
        <h1>Nederlandse Geldstromen</h1>
        <p className="muted">Data laden…</p>
      </main>
    );

  const selected = data.countries.find((c) => c.id === state.country) ?? null;
  const select = (id: string | null) => update({ country: id });
  const ctx = { data, opts, resolved, fmt, onYear: (year: number) => update({ year }) };
  const minYear = years[0];
  const maxYear = years[years.length - 1];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Kopieer deze link:", window.location.href);
    }
  };

  return (
    <main className="page">
      <header className="header">
        <h1>Nederlandse Geldstromen</h1>
        <p className="muted">
          Hoeveel geld stroomt er vanuit Nederland naar andere landen, en andersom? Handel in goederen en diensten volgens
          CBS, aangevuld met schattingen die als zodanig zijn gemarkeerd.
        </p>
      </header>

      <section className="card controls" aria-label="Instellingen">
        <div className="year">
          <label htmlFor="year" className="control-label">
            Jaar
          </label>
          <button
            className="icon-button"
            onClick={() => {
              if (!playing && state.year === maxYear) update({ year: minYear });
              setPlaying((p) => !p);
            }}
            aria-label={playing ? "Afspelen stoppen" : "Jaren afspelen"}
            title={playing ? "Stoppen" : "Jaren afspelen"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <input
            id="year"
            type="range"
            min={minYear}
            max={maxYear}
            step={1}
            value={state.year}
            onChange={(e) => {
              setPlaying(false);
              update({ year: Number(e.target.value) });
            }}
            list="year-ticks"
          />
          <datalist id="year-ticks">
            {years.map((y) => (
              <option key={y} value={y} />
            ))}
          </datalist>
          <output className="year__value" htmlFor="year">
            {state.year}
          </output>
        </div>

        <div className="control-row">
          <div className="control">
            <span className="control-label">Wie betaalt of ontvangt</span>
            <div className="segmented" role="group" aria-label="Filter op Nederlandse partij">
              {SECTORS.map((s) => (
                <button key={s} aria-pressed={state.sector === s} onClick={() => update({ sector: s })}>
                  {SECTOR_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="control">
            <label className="control-label" htmlFor="cat">
              Categorie
            </label>
            <select
              id="cat"
              className="select"
              value={state.category}
              onChange={(e) => update({ category: e.target.value as CategoryFilter })}
            >
              {(["alles", ...CATEGORIES] as CategoryFilter[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="control">
            <span className="control-label">Eenheid</span>
            <div className="segmented" role="group" aria-label="Eenheid">
              {UNITS.map((u) => (
                <button key={u} aria-pressed={state.unit === u} onClick={() => update({ unit: u })}>
                  {UNIT_LABELS[u]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="control-row">
          <label className="toggle" title="Goederen die Nederland alleen doorvoert, zoals via de Rotterdamse haven">
            <input type="checkbox" checked={state.reexport} onChange={(e) => update({ reexport: e.target.checked })} />
            Inclusief wederuitvoer
          </label>
          <label className="toggle">
            <input type="checkbox" checked={state.estimates} onChange={(e) => update({ estimates: e.target.checked, ...(e.target.checked ? {} : { ultimate: false }) })} />
            Schattingen tonen <Badge type="schatting" />
          </label>
          <div className="control">
            <div className="segmented" role="group" aria-label="Toerekenen aan">
              <button aria-pressed={!state.ultimate} onClick={() => update({ ultimate: false })} title="Het land waar de factuur vandaan komt">
                Factuurland
              </button>
              <button
                aria-pressed={state.ultimate}
                disabled={!state.estimates}
                onClick={() => update({ ultimate: true })}
                title={state.estimates ? "Het land van het moederbedrijf (bv. Microsoft via Ierland → VS)" : "Zet schattingen aan om dit te gebruiken"}
              >
                Uiteindelijke ontvanger
              </button>
            </div>
          </div>
          <div className="control-actions">
            <div className="segmented" role="group" aria-label="Weergave">
              <button aria-pressed={!state.table} onClick={() => update({ table: false })}>
                Kaart
              </button>
              <button aria-pressed={state.table} onClick={() => update({ table: true })}>
                Tabel
              </button>
            </div>
            <button className="button" onClick={copyLink}>
              {copied ? "Link gekopieerd" : "Link kopiëren"}
            </button>
            <button className="button" onClick={() => downloadCsv(data, resolved, opts)}>
              CSV
            </button>
          </div>
        </div>
      </section>

      <div className="layout">
        <section className="card map-card">
          {state.table ? (
            <DataTable data={data} resolved={resolved} opts={opts} fmt={fmt} selectedId={state.country} onSelect={select} />
          ) : (
            <>
              <WorldMap data={data} resolved={resolved} fmt={fmt} selectedId={state.country} onSelect={select} />
              <div className="legend">
                <span>
                  <i className="swatch swatch--uit" /> Nederland → land
                </span>
                <span>
                  <i className="swatch swatch--in" /> Land → Nederland
                </span>
                <span className="muted">Lijndikte = omvang · lijnen voor de 25 grootste landen</span>
                <span className="muted hint hint--desktop">Scroll om te zoomen · sleep om te verschuiven · klik op een land</span>
                <span className="muted hint hint--touch">Zoom en verschuif met twee vingers · tik op een land</span>
              </div>
            </>
          )}
        </section>

        <aside className="card panel">
          {selected ? (
            <CountryDetail country={selected} ctx={ctx} onClose={() => select(null)} />
          ) : (
            <Overview ctx={ctx} onSelect={select} />
          )}
        </aside>
      </div>

      <footer className="card footer">
        <h3>Over de data</h3>
        <ul className="types">
          <li>
            <Badge type="officieel" /> Direct overgenomen uit een officiële statistiek (CBS).
          </li>
          <li>
            <Badge type="berekend" /> Afgeleid uit officiële cijfers, bijvoorbeeld totaal minus energie, of een aandeel wederuitvoer.
          </li>
          <li>
            <Badge type="schatting" /> Afgeleid uit Kamerstukken, jaarverslagen of journalistiek onderzoek. Altijd met bron.
          </li>
        </ul>
        <ul className="muted small notes">
          {data.meta.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>
            Schattingen die al in een CBS-cijfer zitten (zoals defensie-aankopen binnen goederen) worden daarvan afgetrokken,
            zodat niets dubbel telt. Totalen nemen het zwakste datatype over.
          </li>
        </ul>
        <p className="muted small">
          Bronnen:{" "}
          {Object.entries(data.sources).map(([k, s], i, arr) => (
            <span key={k}>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.publisher}: {s.name}
                </a>
              ) : (
                `${s.publisher}: ${s.name}`
              )}
              {i < arr.length - 1 ? " · " : ""}
            </span>
          ))}
          . Data gegenereerd op {data.meta.generated}.
        </p>
      </footer>
    </main>
  );
}
