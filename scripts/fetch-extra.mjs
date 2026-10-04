// Haalt geldstromen op die niet bij CBS staan en zet ze om naar rijen voor build-data.mjs.
// Elk bestand data/bronnen/extra-<naam>.json heeft: key, sources, meta (toelichting) en rows.
// Gebruik: npm run data:fetch (draait ook fetch-cbs.mjs)
//
//   extra-hulp.json          OESO CRS: Nederlandse ontwikkelingshulp per ontvangend land (USD → EUR via ECB)
//   extra-overmakingen.json  Eurostat bop_rem6: persoonlijke overdrachten naar het buitenland (betalingsbalans)
//   extra-eu.json            Europese Commissie: afdrachten aan en uitgaven van de EU-begroting
//   extra-uitkeringen.json   uitkeringen aan mensen in het buitenland (zie functie)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "bronnen");
const require = createRequire(import.meta.url);
const iso = require("i18n-iso-countries");

const N = (nl, en) => ({ nl, en });

async function get(url, as = "text") {
  const res = await fetch(url, { headers: { Accept: as === "json" ? "application/json" : "text/csv,*/*" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} voor ${url}`);
  return as === "json" ? res.json() : res.text();
}

/** Eenvoudige CSV-parser (velden tussen aanhalingstekens mogen komma's bevatten). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** ECB-referentiekoers: dollars per euro, per jaar. */
async function usdPerEur() {
  const rows = parseCsv(await get("https://data-api.ecb.europa.eu/service/data/EXR/A.USD.EUR.SP00.A?format=csvdata&startPeriod=2000"));
  return Object.fromEntries(rows.map((r) => [Number(r.TIME_PERIOD), Number(r.OBS_VALUE)]));
}

// ---- Ontwikkelingshulp ----------------------------------------------------------------
async function hulp() {
  const url =
    "https://sdmx.oecd.org/dcd-public/rest/data/OECD.DCD.FSD,DSD_CRS@DF_CRS,/NLD..1000.100._T._T.D.V._T.0.USD?startPeriod=2002&format=csv";
  const [rows, fx] = await Promise.all([get(url).then(parseCsv), usdPerEur()]);
  const out = [];
  const skipped = new Set();
  for (const r of rows) {
    const id = iso.alpha3ToNumeric(r.RECIPIENT); // regio's en "niet toewijsbaar" vallen hier af
    const year = Number(r.TIME_PERIOD);
    const usd = Number(r.OBS_VALUE);
    if (!id) {
      skipped.add(r.RECIPIENT);
      continue;
    }
    if (!fx[year] || !(usd > 0)) continue;
    out.push({
      country: id,
      year,
      direction: "uit",
      sector: "overheid",
      category: "hulp",
      amount: usd / fx[year],
      dataType: "berekend",
      source: "oeso-crs",
      note: N(
        `Bilaterale ontwikkelingshulp, bruto uitbetaald: $${usd.toFixed(1)} mln omgerekend met de ECB-jaarkoers (${fx[year].toFixed(4)})`,
        `Bilateral development aid, gross disbursements: $${usd.toFixed(1)} m converted at the ECB annual rate (${fx[year].toFixed(4)})`,
      ),
    });
  }
  return {
    key: "hulp",
    sources: {
      "oeso-crs": {
        name: "Creditor Reporting System (CRS): ODA naar ontvangend land, donor Nederland",
        nameEn: "Creditor Reporting System (CRS): ODA by recipient country, donor Netherlands",
        publisher: "OESO",
        url: "https://data-explorer.oecd.org/",
      },
    },
    meta: N(
      "Ontwikkelingshulp: OESO CRS, omgerekend naar euro met de ECB-jaarkoers. Alleen hulp die aan een land is toe te wijzen; dat is ongeveer 15% van alle Nederlandse hulp. De rest gaat naar internationale organisaties, regio's of wordt in Nederland besteed (zoals eerstejaars asielopvang).",
      "Development aid: OECD CRS, converted to euro at the ECB annual rate. Only aid attributable to a country; that is roughly 15% of all Dutch aid. The rest goes to international organisations, regions or is spent in the Netherlands (such as first-year asylum reception).",
    ),
    rows: out,
    skipped: [...skipped].sort(),
  };
}

// ---- Overmakingen --------------------------------------------------------------------
/** Eurostat JSON-stat → lijst van { dim: code, ..., value }. */
function jsonStat(j) {
  const dims = j.id;
  const codes = dims.map((d) => {
    const idx = j.dimension[d].category.index;
    const arr = [];
    for (const [code, i] of Object.entries(idx)) arr[i] = code;
    return arr;
  });
  const out = [];
  for (const [k, value] of Object.entries(j.value)) {
    let rest = Number(k);
    const rec = { value, status: j.status?.[k] };
    for (let d = dims.length - 1; d >= 0; d--) {
      rec[dims[d]] = codes[d][rest % j.size[d]];
      rest = Math.floor(rest / j.size[d]);
    }
    out.push(rec);
  }
  return out;
}

const EUROSTAT_ALPHA2 = { EL: "GR", UK: "GB", XK: null };

async function overmakingen() {
  const url =
    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/bop_rem6?geo=NL&currency=MIO_EUR&stk_flow=DEB&bop_item=D752&format=JSON&lang=en";
  const data = jsonStat(await get(url, "json"));
  const out = [];
  for (const r of data) {
    const a2 = r.partner in EUROSTAT_ALPHA2 ? EUROSTAT_ALPHA2[r.partner] : r.partner;
    const id = a2 && a2.length === 2 ? iso.alpha2ToNumeric(a2) : null;
    if (!id || !(r.value > 0)) continue;
    out.push({
      country: id,
      year: Number(r.time),
      direction: "uit",
      sector: "consumenten",
      category: "overmakingen",
      amount: r.value,
      dataType: "officieel",
      source: "eurostat-rem6",
      note: N(
        "Persoonlijke overdrachten van huishoudens in Nederland naar huishoudens in dit land (betalingsbalans)",
        "Personal transfers from households in the Netherlands to households in this country (balance of payments)",
      ),
    });
  }
  return {
    key: "overmakingen",
    sources: {
      "eurostat-rem6": {
        name: "Persoonlijke overdrachten naar partnerland (bop_rem6), op basis van de betalingsbalans van DNB",
        nameEn: "Personal transfers by partner country (bop_rem6), based on the DNB balance of payments",
        publisher: "Eurostat",
        url: "https://ec.europa.eu/eurostat/databrowser/view/bop_rem6/default/table",
      },
    },
    meta: N(
      "Overmakingen door migranten: officiële betalingsbalanscijfers (Eurostat bop_rem6). Contant meegenomen of informeel overgemaakt geld zit er niet in; de Wereldbank schat het werkelijke bedrag op ruim USD 7,8 mld (2021), tegenover ca. €0,6 mld in de statistiek. Een deel van de landverdeling is door de statistiekbureaus zelf geschat; vertrouwelijke waarden ontbreken.",
      "Migrant remittances: official balance-of-payments figures (Eurostat bop_rem6). Cash carried or sent informally is not included; the World Bank estimates the true amount at over USD 7.8 bn (2021), compared with about €0.6 bn in the statistics. Part of the country split is estimated by the statistical offices themselves; confidential values are missing.",
    ),
    rows: out,
  };
}

// ---- EU-begroting ---------------------------------------------------------------------
const EU_XLSX =
  "https://commission.europa.eu/document/download/9f334bee-d097-4b68-8f93-2225eabeb631_en?filename=eu_budget_spending_and_revenue_2000-2025.xlsx";

/** Leest per jaar (tabblad) de kolom "NL" onder de laatste kopregel met landcodes. */
async function euFigures() {
  const ExcelJS = require("exceljs");
  const res = await fetch(EU_XLSX);
  if (!res.ok) throw new Error(`${res.status} voor ${EU_XLSX}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const cell = (v) => {
    const x = v && typeof v === "object" ? (v.result ?? v.richText?.map((r) => r.text).join("") ?? null) : v;
    return typeof x === "string" ? x.trim() : x;
  };
  const years = {};
  for (const ws of wb.worksheets) {
    const year = Number(ws.name);
    if (!year) continue;
    let col = null;
    const got = {};
    ws.eachRow((row) => {
      const vals = row.values.map(cell);
      const idx = vals.indexOf("NL");
      if (idx > 0 && vals.includes("BE")) col = idx;
      // Het label staat (afhankelijk van het jaar) in kolom 1 t/m 5, soms herhaald.
      const label = [...new Set(vals.slice(1, 6).filter((v) => typeof v === "string" && v))]
        .join(" ")
        .replace(/\s+/g, " ")
        .toLowerCase();
      const v = vals[col];
      if (!col || !label || typeof v !== "number") return;
      const set = (k) => (got[k] ??= v);
      if (label.startsWith("total expenditure")) set("exp");
      else if (label.startsWith("total ngeu")) set("ngeu");
      else if (label.startsWith("total national contribution")) set("nat");
      else if (label.startsWith("traditional own resources")) set("tor");
      else if (label === "customs duties") set("tor");
      else if (label.startsWith("own resources based on vat")) set("vat");
      else if (label.startsWith("own resources based on gni")) set("gni");
      else if (label.startsWith("gross reduction")) set("red");
      else if (label.includes("plastic")) set("plastic");
      else if (label.startsWith("total balances and adjustments")) set("bal");
    });
    years[year] = got;
  }
  return years;
}

async function eu() {
  const figures = await euFigures();
  const rows = [];
  const base = { country: "EU", category: "eu", sector: "overheid", source: "ec-eu-begroting" };
  for (const [y, f] of Object.entries(figures)) {
    const year = Number(y);
    if (f.nat != null) {
      rows.push({
        ...base,
        year,
        direction: "uit",
        amount: f.nat,
        dataType: "officieel",
        note: N(
          "Nationale bijdrage aan de EU-begroting (btw- en bni-afdracht, inclusief kortingen)",
          "National contribution to the EU budget (VAT and GNI-based, including rebates)",
        ),
      });
    } else if (f.gni != null) {
      const parts = [f.vat, f.gni, f.red, f.plastic, f.bal].map((v) => v ?? 0);
      rows.push({
        ...base,
        year,
        direction: "uit",
        amount: parts.reduce((a, b) => a + b, 0),
        dataType: "berekend",
        note: N(
          "Nationale bijdrage: som van btw-, bni- en plasticafdracht, korting en verrekeningen",
          "National contribution: sum of VAT, GNI and plastics contributions, rebate and adjustments",
        ),
      });
    }
    if (f.tor != null)
      rows.push({
        ...base,
        year,
        direction: "uit",
        sector: "bedrijven",
        amount: f.tor,
        dataType: "officieel",
        note: N(
          "Invoerrechten die Nederland voor de EU int (deel voor de EU, na inningskosten). Betaald door importeurs; een groot deel hoort bij goederen die via Rotterdam naar andere EU-landen gaan.",
          "Customs duties the Netherlands collects for the EU (EU share, after collection costs). Paid by importers; much of it relates to goods passing through Rotterdam to other EU countries.",
        ),
      });
    if (f.exp != null)
      rows.push({
        ...base,
        year,
        direction: "in",
        amount: f.exp,
        dataType: "officieel",
        note: N(
          "Uitgaven van de EU-begroting in Nederland (o.a. landbouw, onderzoek, regio's)",
          "EU budget spending in the Netherlands (e.g. agriculture, research, regions)",
        ),
      });
    if (f.ngeu)
      rows.push({
        ...base,
        year,
        direction: "in",
        amount: f.ngeu,
        dataType: "officieel",
        note: N("NextGenerationEU: herstelfonds na corona", "NextGenerationEU: post-COVID recovery fund"),
      });
  }
  return {
    key: "eu",
    sources: {
      "ec-eu-begroting": {
        name: "EU-uitgaven en -inkomsten per lidstaat 2000–2025",
        nameEn: "EU spending and revenue by Member State 2000–2025",
        publisher: "Europese Commissie",
        url: "https://commission.europa.eu/strategy-and-policy/eu-budget/long-term-eu-budget/2021-2027/spending-and-revenue_en",
      },
    },
    meta: N(
      "EU-begroting: Europese Commissie. De EU staat op de kaart als één punt (Brussel). Invoerrechten staan apart: die betalen importeurs, vaak voor goederen die doorgaan naar andere EU-landen. Pieken en dalen komen soms door eenmalige verrekeningen (zoals 2009 en 2016).",
      "EU budget: European Commission. The EU is shown on the map as a single point (Brussels). Customs duties are listed separately: importers pay them, often for goods continuing to other EU countries. Some peaks and dips come from one-off adjustments (such as 2009 and 2016).",
    ),
    rows,
  };
}

// ---- Uitkeringen en pensioenen over de grens ---------------------------------------------
// Er is geen open bron met SVB-bedragen per land. Wel heeft de Europese Commissie (via HIVA, KU Leuven)
// de wettelijke pensioenen (ouderdom, nabestaanden, invaliditeit) tussen EU/EFTA-landen en het VK in
// kaart gebracht. Tabel 8 staat als tekst in data/bronnen/hiva-tabel8-2024.txt (uit de PDF gehaald).
async function uitkeringen() {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(join(OUT, "hiva-tabel8-2024.txt"), "utf8");
  const COLS = "BE BG CZ DK DE EE IE EL ES FR HR IT CY LV LT LU HU MT NL AT PL PT RO SI SK FI SE IS LI NO CH UK".split(" ");
  const NL = COLS.indexOf("NL");
  const toId = (code) => iso.alpha2ToNumeric({ EL: "GR", UK: "GB" }[code] ?? code);
  // Getallen met één decimaal; duizendtallen staan met een spatie ("1 495.1").
  const nums = (s) => {
    const t = s.trim().split(/\s+/);
    const out = [];
    for (let i = 0; i < t.length; i++) {
      if (/^\d{1,3}$/.test(t[i]) && /^\d{3}\.\d$/.test(t[i + 1] ?? "")) out.push(Number(t[i] + t[++i]));
      else if (/^\d+(\.\d)?$/.test(t[i])) out.push(Number(t[i]));
    }
    return out;
  };
  const rows = [];
  const year = 2024;
  const base = { year, category: "uitkeringen", dataType: "officieel", source: "hiva-pensioenen" };
  const re = new RegExp(`\\b(${COLS.join("|")})\\s+([\\d .]+)$`);
  for (const line of text.split("\n")) {
    const m = line.match(re);
    if (!m) continue;
    const r = COLS.indexOf(m[1]);
    const v = nums(m[2]); // eigen kolom ontbreekt; laatste getal is het totaal
    if (m[1] === "NL") {
      // Pensioenen uit andere landen aan mensen die in Nederland wonen.
      COLS.forEach((code, c) => {
        if (c === NL) return;
        const amount = v[c - (c > NL ? 1 : 0)];
        if (amount > 0)
          rows.push({
            ...base,
            country: toId(code),
            direction: "in",
            sector: "consumenten",
            amount,
            note: N("Wettelijke pensioenen uit dit land aan mensen die in Nederland wonen", "Statutory pensions from this country to people living in the Netherlands"),
          });
      });
      continue;
    }
    const amount = v[NL - (r < NL ? 1 : 0)];
    if (amount > 0)
      rows.push({
        ...base,
        country: toId(m[1]),
        direction: "uit",
        sector: "overheid",
        amount,
        note: N(
          "Nederlandse wettelijke pensioenen (AOW, Anw, arbeidsongeschiktheid) aan mensen die in dit land wonen",
          "Dutch statutory pensions (state pension, survivors, disability) paid to people living in this country",
        ),
      });
  }
  return {
    key: "uitkeringen",
    sources: {
      "hiva-pensioenen": {
        name: "Cross-border old-age, survivors' and invalidity pensions, referentiejaar 2024 (tabel 8)",
        nameEn: "Cross-border old-age, survivors' and invalidity pensions, reference year 2024 (table 8)",
        publisher: "Europese Commissie / HIVA KU Leuven",
        url: "https://hiva.kuleuven.be/nl/onderzoeksmap/thema/verzorgingsstaat/p/Docs/network-statistics-ry-2024/cross-border-pensions-reference-year-2024.pdf",
      },
    },
    meta: N(
      "Uitkeringen: wettelijke pensioenen tussen EU/EFTA-landen en het VK in 2024 (Europese Commissie / HIVA). AOW aan mensen in bijvoorbeeld Marokko of Turkije, kinderbijslag en UWV-uitkeringen (in 2023 samen €568 mln naar het buitenland) zijn niet per land beschikbaar. SVB publiceert geen bedragen per land.",
      "Benefits: statutory pensions between EU/EFTA countries and the UK in 2024 (European Commission / HIVA). State pensions paid to people in e.g. Morocco or Turkey, child benefit and UWV benefits (€568 m abroad in total in 2023) are not available by country. The SVB does not publish amounts by country.",
    ),
    rows,
  };
}

const SERIES = { hulp, overmakingen, eu, uitkeringen };
const only = process.argv.slice(2);

await mkdir(OUT, { recursive: true });
for (const [name, load] of Object.entries(SERIES)) {
  if (only.length && !only.includes(name)) continue;
  process.stdout.write(`extra-${name} ... `);
  const s = await load();
  await writeFile(join(OUT, `extra-${name}.json`), JSON.stringify(s));
  const years = s.rows.map((r) => r.year);
  console.log(`${s.rows.length} rijen, ${Math.min(...years)}–${Math.max(...years)}${s.skipped ? `, overgeslagen: ${s.skipped.length} regio's/codes` : ""}`);
}
