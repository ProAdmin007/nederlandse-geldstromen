"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import WorldMap from "./WorldMap";
import DataTable, { downloadCsv } from "./DataTable";
import CountrySearch from "./CountrySearch";
import { Badge, CountryDetail, Overview, type Ctx, type Fmt } from "./Panel";
import { format, resolveAll, type CategoryFilter, type Options, type SectorFilter, type Unit } from "@/lib/calc";
import { CATEGORIES, useDataset } from "@/lib/data";
import { CATEGORY_LABELS, SECTOR_LABELS, STRINGS, UNIT_LABELS } from "@/lib/i18n";
import { STORIES } from "@/lib/stories";
import { useUrlState, type ViewState } from "@/lib/urlState";
import type { Lang } from "@/lib/types";

const SECTORS: SectorFilter[] = ["alles", "overheid", "bedrijven", "consumenten"];
const UNITS: Unit[] = ["eur", "pp", "bbp"];

/** Taal uit de URL of de browser, vóórdat de rest van de stand bekend is. */
function initialLang(): Lang {
  if (typeof window === "undefined") return "nl";
  const q = new URLSearchParams(window.location.search).get("lang");
  if (q === "en" || q === "nl") return q;
  return navigator.language?.toLowerCase().startsWith("nl") ? "nl" : "en";
}

export default function App() {
  const [startLang, setStartLang] = useState<Lang>("nl");
  useEffect(() => setStartLang(initialLang()), []);

  const [stateLang, setStateLang] = useState<Lang | null>(null);
  const lang = stateLang ?? startLang;
  const t = STRINGS[lang];
  const { data, error } = useDataset(lang);
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
        compare: null,
        lang: startLang,
        story: null,
      },
    // De standaardstand hoeft niet opnieuw te worden berekend als alleen de taal wisselt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data === null, startLang],
  );
  const [state, update] = useUrlState(fallback, years);
  const [playing, setPlaying] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state && state.lang !== stateLang) setStateLang(state.lang);
    if (state) document.documentElement.lang = state.lang;
  }, [state, stateLang]);

  const opts: Options | null = state && {
    year: state.year,
    sector: state.sector,
    category: state.category,
    reexport: state.reexport,
    estimates: state.estimates,
    ultimate: state.ultimate,
  };
  const optKey = JSON.stringify(opts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolved = useMemo(() => (data && opts ? resolveAll(data, opts) : new Map()), [data, optKey]);
  const compare = useMemo(
    () => (data && opts && state?.compare != null && state.compare !== state.year ? { year: state.compare, resolved: resolveAll(data, { ...opts, year: state.compare }) } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, optKey, state?.compare],
  );

  const fmt: Fmt = useCallback(
    (amount, signed = false, year) => (data && state ? format(amount, state.unit, year ?? state.year, data.meta, signed, lang) : ""),
    [data, state, lang],
  );

  // Afspelen: elk jaar 1,4 seconde, stopt aan het eind.
  useEffect(() => {
    if (!playing || !state) return;
    const next = years.find((y) => y > state.year);
    if (next == null) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => update({ year: next }), 1400);
    return () => clearTimeout(timer);
  }, [playing, state, years]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error)
    return (
      <main className="page">
        <p className="notice">{t.loadError(error)}</p>
      </main>
    );
  if (!data || !state || !opts || !fallback)
    return (
      <main className="page">
        <h1>{t.title}</h1>
        <p className="muted">{t.loading}</p>
      </main>
    );

  const selected = data.countries.find((c) => c.id === state.country) ?? null;
  const select = (id: string | null) => update({ country: id });
  const ctx: Ctx = { data, opts, resolved, compare, fmt, lang, t, onYear: (year) => update({ year }) };
  const minYear = years[0];
  const maxYear = years[years.length - 1];
  const hasCategory = (c: string) => data.countries.some((x) => x.flows.some((f) => f.category === c));
  const stories = STORIES.filter((s) => !s.needs || hasCategory(s.needs));
  const story = stories.find((s) => s.id === state.story) ?? null;

  const applyStory = (id: string) => {
    const s = STORIES.find((x) => x.id === id)!;
    const yr = s.state.year != null ? Math.min(Math.max(s.state.year, minYear), maxYear) : fallback.year;
    setPlaying(false);
    update({ ...fallback, lang, table: state.table, ...s.state, year: yr, story: id });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t.copyPrompt, window.location.href);
    }
  };

  return (
    <main className="page">
      <header className="header">
        <div className="header__top">
          <h1>{t.title}</h1>
          <button className="button lang-button" onClick={() => update({ lang: lang === "nl" ? "en" : "nl" })} aria-label={t.switchLanguageAria} lang={lang === "nl" ? "en" : "nl"}>
            {t.switchLanguage}
          </button>
        </div>
        <p className="muted">{t.intro}</p>
      </header>

      <section className="stories" aria-label={t.stories}>
        <span className="control-label">{t.stories}</span>
        <div className="stories__list">
          {stories.map((s) => (
            <button key={s.id} className={s.id === state.story ? "chip is-active" : "chip"} onClick={() => applyStory(s.id)}>
              {s.title[lang]}
            </button>
          ))}
        </div>
      </section>
      {story && (
        <div className="story-card" role="status">
          <div>
            <strong>{story.title[lang]}</strong>
            <p>{story.text[lang]}</p>
          </div>
          <button className="close" onClick={() => update({ story: null })} aria-label={t.storyClose}>
            ×
          </button>
        </div>
      )}

      <section className="card controls" aria-label={t.settings}>
        <div className="year">
          <label htmlFor="year" className="control-label">
            {t.year}
          </label>
          <button
            className="icon-button"
            onClick={() => {
              if (!playing && state.year === maxYear) update({ year: minYear });
              setPlaying((p) => !p);
            }}
            aria-label={playing ? t.stop : t.play}
            title={playing ? t.stop : t.play}
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
          />
          <output className="year__value" htmlFor="year">
            {state.year}
          </output>
          <label className="compare">
            <span className="control-label">{t.compareWith}</span>
            <select
              className="select"
              value={state.compare ?? ""}
              onChange={(e) => update({ compare: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">{t.noCompare}</option>
              {years
                .filter((y) => y !== state.year)
                .map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="control-row">
          <div className="control">
            <span className="control-label">{t.who}</span>
            <div className="segmented" role="group" aria-label={t.whoAria}>
              {SECTORS.map((s) => (
                <button key={s} aria-pressed={state.sector === s} onClick={() => update({ sector: s })}>
                  {SECTOR_LABELS[lang][s]}
                </button>
              ))}
            </div>
          </div>
          <div className="control">
            <label className="control-label" htmlFor="cat">
              {t.category}
            </label>
            <select id="cat" className="select" value={state.category} onChange={(e) => update({ category: e.target.value as CategoryFilter })}>
              {(["alles", ...CATEGORIES.filter(hasCategory)] as CategoryFilter[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[lang][c]}
                </option>
              ))}
            </select>
          </div>
          <div className="control">
            <span className="control-label">{t.unit}</span>
            <div className="segmented" role="group" aria-label={t.unit}>
              {UNITS.map((u) => (
                <button key={u} aria-pressed={state.unit === u} onClick={() => update({ unit: u })}>
                  {UNIT_LABELS[lang][u]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="control-row">
          <label className="toggle" title={t.reexportTitle}>
            <input type="checkbox" checked={state.reexport} onChange={(e) => update({ reexport: e.target.checked })} />
            {t.reexport}
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={state.estimates}
              onChange={(e) => update({ estimates: e.target.checked, ...(e.target.checked ? {} : { ultimate: false }) })}
            />
            {t.estimates} <Badge type="schatting" lang={lang} />
          </label>
          <div className="control">
            <div className="segmented" role="group" aria-label={t.attribute}>
              <button aria-pressed={!state.ultimate} onClick={() => update({ ultimate: false })} title={t.billingTitle}>
                {t.billing}
              </button>
              <button
                aria-pressed={state.ultimate}
                disabled={!state.estimates}
                onClick={() => update({ ultimate: true })}
                title={state.estimates ? t.ultimateTitle : t.ultimateDisabled}
              >
                {t.ultimate}
              </button>
            </div>
          </div>
          <div className="control-actions">
            <div className="segmented" role="group" aria-label={t.view}>
              <button aria-pressed={!state.table} onClick={() => update({ table: false })}>
                {t.map}
              </button>
              <button aria-pressed={state.table} onClick={() => update({ table: true })}>
                {t.table}
              </button>
            </div>
            <button className="button" onClick={copyLink}>
              {copied ? t.copied : t.copyLink}
            </button>
            <button className="button" onClick={() => downloadCsv(data, resolved, opts, lang)}>
              {t.csv}
            </button>
          </div>
        </div>
      </section>

      <div className="layout">
        <section className="card map-card">
          <CountrySearch countries={data.countries} onSelect={select} t={t} />
          {state.table ? (
            <DataTable ctx={ctx} selectedId={state.country} onSelect={select} />
          ) : (
            <>
              <WorldMap data={data} resolved={resolved} fmt={fmt} compare={compare} t={t} lang={lang} selectedId={state.country} onSelect={select} />
              <div className="legend">
                <span>
                  <i className="swatch swatch--uit" /> {t.legendOut}
                </span>
                <span>
                  <i className="swatch swatch--in" /> {t.legendIn}
                </span>
                <span className="muted">{t.legendWidth}</span>
                <span className="muted hint hint--desktop">{t.hintDesktop}</span>
                <span className="muted hint hint--touch">{t.hintTouch}</span>
              </div>
            </>
          )}
        </section>

        <aside className="card panel">
          {selected ? <CountryDetail country={selected} ctx={ctx} onClose={() => select(null)} /> : <Overview ctx={ctx} onSelect={select} />}
        </aside>
      </div>

      <footer className="card footer">
        <h3>{t.aboutData}</h3>
        <ul className="types">
          <li>
            <Badge type="officieel" lang={lang} /> {t.typeOfficial}
          </li>
          <li>
            <Badge type="berekend" lang={lang} /> {t.typeCalculated}
          </li>
          <li>
            <Badge type="schatting" lang={lang} /> {t.typeEstimate}
          </li>
        </ul>
        <ul className="muted small notes">
          {data.meta.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>{t.noDoubleCount}</li>
        </ul>
        <p className="muted small">
          {t.sources}:{" "}
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
          . {t.generated(data.meta.generated)}
        </p>
        <p className="muted small">
          {t.license}{" "}
          <a href="https://github.com/ProAdmin007/nederlandse-geldstromen" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </p>
      </footer>
    </main>
  );
}
