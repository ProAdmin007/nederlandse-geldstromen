// Bouwt public/data/geldstromen.json uit:
//   data/bronnen/cbs-*.json    ruwe CBS-tabellen (npm run data:fetch)
//   data/bronnen/extra-*.json  andere bronnen, al omgezet naar rijen (npm run data:fetch)
//   data/schattingen.json      handmatige schattingen en ontvangers, elk met bron
//   data/landen.json           koppeling CBS-landnaam → ISO-code/kaartpositie
//
// Gebruik: npm run data:build
//
// Uitgangspunt: officiële cijfers blijven intact. Wederuitvoer en schattingen worden als
// "waarvan"-regels (partOf) opgeslagen; de app trekt ze er pas vanaf als de gebruiker
// daarom vraagt. Bedragen in miljoen euro. Toelichtingen staan in het Nederlands en Engels.

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { geoArea, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), "utf8"));
const require = createRequire(import.meta.url);
const iso = require("i18n-iso-countries");
iso.registerLocale(require("i18n-iso-countries/langs/nl.json"));
iso.registerLocale(require("i18n-iso-countries/langs/en.json"));

const T = {
  goederen: await read("data/bronnen/cbs-goederen.json"),
  goederenOud: await read("data/bronnen/cbs-goederen-2002.json"),
  gebruik: await read("data/bronnen/cbs-invoer-gebruik.json"),
  diensten: await read("data/bronnen/cbs-diensten.json"),
  diensten14: await read("data/bronnen/cbs-diensten-2014.json"),
  diensten03: await read("data/bronnen/cbs-diensten-2003.json"),
  bevolking: await read("data/bronnen/cbs-bevolking.json"),
  bbp: await read("data/bronnen/cbs-bbp.json"),
};
const schattingen = await read("data/schattingen.json");
const belasting = await read("data/belasting.json");
const landen = await read("data/landen.json");
const world = await read("node_modules/world-atlas/countries-110m.json");
const extras = [];
for (const f of (await readdir(join(ROOT, "data/bronnen"))).filter((f) => f.startsWith("extra-")).sort()) {
  extras.push(await read(`data/bronnen/${f}`));
}

/** Regio-totalen en restposten in de CBS-tabellen; geen land. */
const AGGREGATE = /Totaal|EU|Europ|Afrika|Amerika|Azië|Oceanië|Overig|Niet |Boordprovisie|Zeegebied|Eurozone|instellingen|organisaties|Oosten|Antillen/;

/** Landen met in enig jaar minder handel dan dit (mln euro, beide richtingen) laten we weg... */
const MIN_TRADE = 1000;
/** ...tenzij er in enig jaar minstens zoveel andere geldstromen zijn (hulp, uitkeringen, overmakingen). */
const MIN_OTHER = 25;

const DIRECTIONS = ["uit", "in"];
const SECTORS = ["overheid", "bedrijven", "consumenten"];
const CATEGORIES = ["it", "energie", "goederen", "diensten", "defensie", "ie", "hulp", "eu", "uitkeringen", "overmakingen"];
const DATATYPES = ["officieel", "berekend", "schatting"];

/** Kortere Engelse namen waar de ISO-naam onhandig lang is. */
const EN_NAMES = {
  840: "United States", 643: "Russia", 826: "United Kingdom", 410: "South Korea", 408: "North Korea",
  364: "Iran", 760: "Syria", 704: "Vietnam", 418: "Laos", 498: "Moldova", 834: "Tanzania", 862: "Venezuela",
  "068": "Bolivia", 158: "Taiwan", 180: "DR Congo", 178: "Congo", 112: "Belarus", 784: "United Arab Emirates",
  203: "Czechia", 807: "North Macedonia", 384: "Côte d'Ivoire", 275: "Palestinian territories",
};

const year = (p) => Number(p.slice(0, 4));
/** Alleen volledige jaren ("2026 januari-juli" valt af). */
const fullYears = (t) =>
  Object.entries(t.dimensions.Perioden)
    .filter(([k, v]) => k.includes("JJ") && /^\d{4}\*?$/.test(v.trim()))
    .map(([k]) => year(k));

// Welke tabel voor welk jaar: de nieuwste reeks heeft voorrang.
const goodsNewYears = fullYears(T.goederen);
const goodsFrom = Math.min(...goodsNewYears);
const goodsOldYears = fullYears(T.goederenOud).filter((y) => y < goodsFrom);
const svcNewYears = fullYears(T.diensten);
const svc14Years = fullYears(T.diensten14).filter((y) => y < Math.min(...svcNewYears));
const svc03Years = fullYears(T.diensten03).filter((y) => y < Math.min(...svc14Years));
const shareYears = fullYears(T.gebruik);
const lastShareYear = Math.max(...shareYears);
const serviceYears = [...svc03Years, ...svc14Years, ...svcNewYears].sort();

// ---- Bronnen ------------------------------------------------------------
const cbs = (t, nameEn) => ({
  name: `${t.title} (${t.id})`,
  nameEn: `${nameEn} (${t.id})`,
  publisher: "CBS StatLine",
  url: t.url,
});
const sources = {
  "cbs-goederen": cbs(T.goederen, "International trade in goods; transfer of ownership"),
  "cbs-goederen-2002": cbs(T.goederenOud, "Imports and (re-)exports of goods by country, 2002–2022 (old method)"),
  "cbs-invoer-gebruik": cbs(T.gebruik, "Imports of goods by use and country of origin"),
  "cbs-diensten": cbs(T.diensten, "International trade in services by country"),
  "cbs-diensten-2014": cbs(T.diensten14, "International trade in services, 2014–2020"),
  "cbs-diensten-2003": cbs(T.diensten03, "International trade in services by country, 2003–2013 (old classification)"),
  "cbs-bevolking": cbs(T.bevolking, "Population; key figures"),
  "cbs-bbp": cbs(T.bbp, "GDP, output and expenditure"),
  ...schattingen.sources,
  ...belasting.sources,
};
for (const e of extras) Object.assign(sources, e.sources);
const sourceKeys = Object.keys(sources);

const notes = [];
const noteKeys = new Map();
/** Toelichting als { nl, en }; dubbele worden één keer opgeslagen. */
const noteIdx = (n) => {
  if (!n) return -1;
  const k = JSON.stringify(n);
  if (!noteKeys.has(k)) noteKeys.set(k, notes.push(n) - 1);
  return noteKeys.get(k);
};
const N = (nl, en) => ({ nl, en });

// ---- Indexeren -------------------------------------------------------------
const index = (t, keyFn) => new Map(t.data.map((r) => [keyFn(r), r]));
const keyByName = (t, dim) => {
  const m = {};
  for (const [k, v] of Object.entries(t.dimensions[dim])) m[v.trim()] = k;
  return m;
};
const G = index(T.goederen, (r) => `${r.Landen}|${r.SITC}|${year(r.Perioden)}`);
const GO = index(T.goederenOud, (r) => `${r.LandenGroepen}|${r.SITC}|${year(r.Perioden)}`);
const U = index(T.gebruik, (r) => `${r.Landen}|${r.Verbruiksbestemming}|${year(r.Perioden)}`);
const S = index(T.diensten, (r) => `${r.Landen}|${r.Diensten}|${year(r.Perioden)}`);
const S14 = index(T.diensten14, (r) => `${r.Landen}|${r.Diensten}|${year(r.Perioden)}`);
const S03 = index(T.diensten03, (r) => `${r.Landen}|${r.InvoerUitvoerEnSaldo}|${year(r.Perioden)}`);
const K = {
  goederen: keyByName(T.goederen, "Landen"),
  goederenOud: keyByName(T.goederenOud, "LandenGroepen"),
  gebruik: keyByName(T.gebruik, "Landen"),
  diensten: keyByName(T.diensten, "Landen"),
  diensten14: keyByName(T.diensten14, "Landen"),
  diensten03: keyByName(T.diensten03, "Landen"),
};

const SITC_TOTAAL = "T001082";
const SITC_ENERGIE = "A018591"; // 3 Minerale brandstoffen, smeermiddelen e.d.
const D = { totaal: "T001039", it: "A007856", ie: "A007847", prive: "A007827", overheid: "A007903" };

// ---- Kaartposities -------------------------------------------------------
const shapes = feature(world, world.objects.countries).features;
function centroid(id) {
  const f = shapes.find((x) => x.id === id);
  if (!f) return null;
  let g = f;
  if (f.geometry.type === "MultiPolygon") {
    // Middelpunt van het grootste deel (anders belandt Frankrijk in zee door Frans-Guyana).
    const parts = f.geometry.coordinates.map((c) => ({ type: "Polygon", coordinates: c }));
    parts.sort((a, b) => geoArea(b) - geoArea(a));
    g = parts[0];
  }
  return geoCentroid(g).map((v) => Math.round(v * 10) / 10);
}

// ---- Rijen ---------------------------------------------------------------------
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

function makeRow(r) {
  return [
    r.year,
    DIRECTIONS.indexOf(r.direction),
    SECTORS.indexOf(r.sector ?? "bedrijven"),
    CATEGORIES.indexOf(r.category),
    r.amount >= 100 ? Math.round(r.amount) : Math.round(r.amount * 10) / 10,
    DATATYPES.indexOf(r.dataType),
    sourceKeys.indexOf(r.source),
    noteIdx(r.note),
    r.partOf ? CATEGORIES.indexOf(r.partOf) : -1,
    r.reexport ? 1 : 0,
  ];
}

const NOTE_GOODS_EXCL = N("Totale goederenhandel minus energie (SITC 3)", "Total trade in goods minus energy (SITC 3)");
const NOTE_ENERGY = N("SITC 3: minerale brandstoffen, smeermiddelen", "SITC 3: mineral fuels, lubricants");
const NOTE_OLD = N("Oude CBS-methode (voor 2015): niet volledig vergelijkbaar met latere jaren", "Old CBS method (before 2015): not fully comparable with later years");

function goodsRows(name, add) {
  const imports = (y, rec, impE) => {
    // Wederuitvoer aan de invoerkant: aandeel uit 85940NED (alleen nieuwe reeks).
    const uk = K.gebruik[name];
    if (!uk || rec.imp == null) return;
    const sy = Math.min(y, lastShareYear);
    const t = num(U.get(`${uk}|T001678|${sy}`)?.InvoerGoederenNaarEigendomsoverdracht_1);
    const w = num(U.get(`${uk}|A052674|${sy}`)?.InvoerGoederenNaarEigendomsoverdracht_1);
    if (!t || w == null || t <= 0) return;
    const share = Math.min(1, w / t);
    const pct = Math.round(share * 100);
    const note =
      y > lastShareYear
        ? N(`Ingevoerd voor wederuitvoer; aandeel ${pct}% uit ${lastShareYear} (laatst beschikbaar) toegepast`, `Imported for re-export; ${pct}% share from ${lastShareYear} (latest available) applied`)
        : N(`Ingevoerd voor wederuitvoer; aandeel ${pct}% volgens CBS 85940NED`, `Imported for re-export; ${pct}% share according to CBS 85940NED`);
    const base = { year: y, sector: "bedrijven", source: "cbs-invoer-gebruik", dataType: "berekend", reexport: true, note };
    add({ ...base, direction: "uit", category: "goederen", amount: (rec.imp - impE) * share, partOf: "goederen" });
    add({ ...base, direction: "uit", category: "energie", amount: impE * share, partOf: "energie" });
  };

  const emit = (y, source, tot, en, old) => {
    const imp = num(tot.imp);
    const exp = num(tot.exp);
    const impE = num(en.imp) ?? 0;
    const expE = num(en.exp) ?? 0;
    const wed = num(tot.wed);
    const wedE = num(en.wed) ?? 0;
    const base = { year: y, source, sector: "bedrijven" };
    const goodsNote = old ? N(`${NOTE_GOODS_EXCL.nl}. ${NOTE_OLD.nl}`, `${NOTE_GOODS_EXCL.en}. ${NOTE_OLD.en}`) : NOTE_GOODS_EXCL;
    const energyNote = old ? N(`${NOTE_ENERGY.nl}. ${NOTE_OLD.nl}`, `${NOTE_ENERGY.en}. ${NOTE_OLD.en}`) : NOTE_ENERGY;
    if (imp != null) {
      add({ ...base, direction: "uit", category: "goederen", amount: imp - impE, dataType: "berekend", note: goodsNote });
      add({ ...base, direction: "uit", category: "energie", amount: impE, dataType: "officieel", note: energyNote });
    }
    if (exp != null) {
      add({ ...base, direction: "in", category: "goederen", amount: exp - expE, dataType: "berekend", note: goodsNote });
      add({ ...base, direction: "in", category: "energie", amount: expE, dataType: "officieel", note: energyNote });
    }
    if (wed != null) {
      const n = N("Wederuitvoer naar dit land", "Re-exports to this country");
      add({ ...base, direction: "in", category: "goederen", amount: wed - wedE, dataType: "berekend", partOf: "goederen", reexport: true, note: n });
      add({ ...base, direction: "in", category: "energie", amount: wedE, dataType: "officieel", partOf: "energie", reexport: true, note: n });
    }
    if (!old) imports(y, { imp }, impE);
  };

  const gk = K.goederen[name];
  if (gk)
    for (const y of goodsNewYears) {
      const t = G.get(`${gk}|${SITC_TOTAAL}|${y}`);
      if (!t) continue;
      const e = G.get(`${gk}|${SITC_ENERGIE}|${y}`) ?? {};
      const pick = (r) => ({ imp: r.TotaleInvoerwaarde_1, exp: r.TotaleUitvoerwaarde_2, wed: r.Wederuitvoerwaarde_3 });
      emit(y, "cbs-goederen", pick(t), pick(e), false);
    }
  const ok = K.goederenOud[name];
  if (ok)
    for (const y of goodsOldYears) {
      const t = GO.get(`${ok}|${SITC_TOTAAL}|${y}`);
      if (!t) continue;
      const e = GO.get(`${ok}|${SITC_ENERGIE}|${y}`) ?? {};
      const pick = (r) => ({ imp: r.Invoerwaarde_1, exp: r.TotaleUitvoerwaarde_2, wed: r.Wederuitvoerwaarde_3 });
      emit(y, "cbs-goederen-2002", pick(t), pick(e), true);
    }
}

function serviceRows(name, add) {
  const emit = (y, source, direction, v, old) => {
    if (v.total == null) return;
    const it = v.it ?? 0;
    const ie = v.ie ?? 0;
    const gov = v.gov ?? 0;
    // Privé reisverkeer: NL → land = Nederlanders op vakantie (consumenten). Andersom ontvangen
    // Nederlandse bedrijven (hotels e.d.) het geld; dat blijft in "diensten".
    const prive = direction === "uit" ? v.prive ?? 0 : 0;
    const suffix = (n) => (old ? N(`${n.nl}. Oude indeling (BPM5), niet volledig vergelijkbaar met latere jaren`, `${n.en}. Old classification (BPM5), not fully comparable with later years`) : n);
    const base = { year: y, source, direction };
    add({ ...base, sector: "bedrijven", category: "it", amount: it, dataType: "officieel", note: suffix(N("Telecommunicatie-, computer- en informatiediensten", "Telecommunications, computer and information services")) });
    add({ ...base, sector: "bedrijven", category: "ie", amount: ie, dataType: "officieel", note: suffix(N("Vergoedingen voor gebruik van intellectueel eigendom (royalty's, licenties)", "Charges for the use of intellectual property (royalties, licences)")) });
    add({ ...base, sector: "consumenten", category: "diensten", amount: prive, dataType: "officieel", note: suffix(N("Privé reisverkeer: uitgaven van Nederlanders in het buitenland", "Personal travel: spending by Dutch residents abroad")) });
    add({ ...base, sector: "overheid", category: "diensten", amount: gov, dataType: "officieel", note: suffix(N("Overheidsdiensten", "Government services")) });
    add({ ...base, sector: "bedrijven", category: "diensten", amount: v.total - it - ie - prive - gov, dataType: "berekend", note: suffix(N("Overige diensten: totaal minus IT, intellectueel eigendom, privé reisverkeer en overheid", "Other services: total minus IT, intellectual property, personal travel and government")) });
  };

  for (const [tbl, idx, years, source] of [
    [K.diensten, S, svcNewYears, "cbs-diensten"],
    [K.diensten14, S14, svc14Years, "cbs-diensten-2014"],
  ]) {
    const sk = tbl[name];
    if (!sk) continue;
    for (const y of years) {
      const get = (code) => idx.get(`${sk}|${code}|${y}`) ?? {};
      for (const [field, direction] of [["InvoerVanDiensten_1", "uit"], ["UitvoerVanDiensten_2", "in"]]) {
        emit(y, source, direction, {
          total: num(get(D.totaal)[field]),
          it: num(get(D.it)[field]),
          ie: num(get(D.ie)[field]),
          prive: num(get(D.prive)[field]),
          gov: num(get(D.overheid)[field]),
        }, false);
      }
    }
  }
  const ok = K.diensten03[name];
  if (ok)
    for (const y of svc03Years) {
      for (const [code, direction] of [["I", "uit"], ["E", "in"]]) {
        const r = S03.get(`${ok}|${code}|${y}`);
        if (!r) continue;
        const tel = num(r.Telecommunicatiediensten_31);
        const comp = num(r.TotaalComputerEnInformatiediensten_37);
        emit(y, "cbs-diensten-2003", direction, {
          total: num(r.TotaalDiensten_1),
          it: tel == null && comp == null ? null : (tel ?? 0) + (comp ?? 0),
          ie: num(r.TotaalRoyaltySEnLicentierechten_40),
          prive: num(r.Prive_28),
          gov: num(r.OverheidsdienstenNietEldersGenoemd_60),
        }, true);
      }
    }
}

// ---- Landen ---------------------------------------------------------------------
const countries = new Map();
const unmapped = new Set();

function country(id, cbsName) {
  if (!countries.has(id)) {
    const map = Object.values(landen).find((m) => m && m.id === id && m.naam) ?? {};
    const coords = Object.values(landen).find((m) => m && m.id === id && m.coords)?.coords;
    const atlas = shapes.find((s) => s.id === id)?.properties.name;
    countries.set(id, {
      id,
      name: map.naam ?? cbsName ?? iso.getName(id, "nl") ?? atlas ?? id,
      nameEn: EN_NAMES[id] ?? EN_NAMES[Number(id)] ?? iso.getName(id, "en") ?? atlas ?? cbsName ?? id,
      coords: coords ?? centroid(id),
      rows: [],
      trade: {},
      other: {},
    });
  }
  return countries.get(id);
}

const names = new Set(Object.values(K).flatMap((k) => Object.keys(k)));
for (const name of names) {
  const map = landen[name];
  if (!map || typeof map !== "object") {
    if (AGGREGATE.test(name)) continue;
    // Alleen melden als het gebied genoeg handel heeft om op de kaart te horen.
    const perYear = {};
    const tally = (r) => {
      if (!r.partOf && r.amount > 0) perYear[r.year] = (perYear[r.year] ?? 0) + r.amount;
    };
    goodsRows(name, tally);
    serviceRows(name, tally);
    if (Math.max(0, ...Object.values(perYear)) >= MIN_TRADE) unmapped.add(name);
    continue;
  }
  const c = country(map.id, map.naam ?? name);
  const add = (r) => {
    if (r.amount == null || r.amount < 0.05) return;
    c.rows.push(makeRow(r));
    if (!r.partOf) c.trade[r.year] = (c.trade[r.year] ?? 0) + r.amount;
  };
  goodsRows(name, add);
  serviceRows(name, add);
}

// Andere bronnen (ontwikkelingshulp, EU-begroting, SVB, overmakingen), al omgezet door de fetch-scripts.
for (const e of extras) {
  for (const r of e.rows) {
    const id = r.country;
    if (id !== "EU" && !iso.isValid(id) && !shapes.some((s) => s.id === id)) {
      unmapped.add(`${e.key}:${id}`);
      continue;
    }
    const c = country(id);
    if (id === "EU") Object.assign(c, { name: "Europese Unie (begroting)", nameEn: "European Union (budget)", coords: [4.37, 50.84] });
    c.rows.push(makeRow(r));
    c.other[r.year] = (c.other[r.year] ?? 0) + r.amount;
    c.forced ||= id === "EU";
  }
}

for (const e of schattingen.flows) {
  const c = countries.get(e.country);
  if (!c) throw new Error(`Schatting voor onbekend land ${e.country}`);
  for (const y of e.years ?? [e.year]) {
    c.rows.push(makeRow({ ...e, year: y, amount: e.amounts?.[y] ?? e.amount, note: N(e.note, e.note_en ?? e.note) }));
  }
  c.forced = true;
}

const via = {};
for (const v of schattingen.via ?? []) {
  (via[v.country] ??= []).push({
    category: v.category,
    direction: v.direction,
    country: v.to,
    share: v.share,
    dataType: v.dataType,
    source: v.source,
    note: N(v.note, v.note_en ?? v.note),
  });
}

const max = (o) => Math.max(0, ...Object.values(o));
const out = [...countries.values()]
  .filter((c) => c.forced || max(c.trade) >= MIN_TRADE || max(c.other) >= MIN_OTHER)
  .sort((a, b) => max(b.trade) + max(b.other) - (max(a.trade) + max(a.other)))
  .map((c) => {
    for (const r of c.rows) {
      if (r[6] < 0) throw new Error(`Onbekende bron in rij voor ${c.name}: ${JSON.stringify(r)}`);
      if (r.slice(1, 6).some((v) => v < 0)) throw new Error(`Ongeldige rij voor ${c.name}: ${JSON.stringify(r)}`);
    }
    return {
      id: c.id,
      name: c.name,
      nameEn: c.nameEn,
      coords: c.coords,
      rows: c.rows.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[3] - b[3]),
      ...(via[c.id] ? { via: via[c.id] } : {}),
    };
  });

const missingCoords = out.filter((c) => !c.coords).map((c) => `${c.name} (${c.id})`);
if (missingCoords.length) throw new Error(`Geen kaartpositie voor: ${missingCoords.join(", ")} (vul coords in data/landen.json)`);

const pick = (t, field) =>
  Object.fromEntries(t.data.filter((r) => r.Perioden.includes("JJ") && num(r[field])).map((r) => [year(r.Perioden), r[field]]));

const allYears = new Set([...goodsOldYears, ...goodsNewYears, ...serviceYears]);
const years = [...allYears].sort();
const range = (ys) => `${Math.min(...ys)}–${Math.max(...ys)}`;

const dataset = {
  format: 3,
  meta: {
    title: "Nederlandse Geldstromen",
    unit: "miljoen euro",
    // Laatste wijzigingsdatum van de CBS-bronnen (niet "vandaag"), zodat ongewijzigde data een identiek bestand geeft.
    generated: Object.values(T).map((t) => t.modified?.slice(0, 10) ?? "").sort().pop(),
    years,
    serviceYears,
    population: pick(T.bevolking, "TotaleBevolking_1"),
    gdp: pick(T.bbp, "BrutoBinnenlandsProduct_2"),
    /** Officiële uit- en invoer van goederen en diensten (nationale rekeningen), ter controle. */
    nationalAccounts: Object.fromEntries(
      T.bbp.data
        .filter((r) => r.Perioden.includes("JJ") && num(r.Totaal_15) && num(r.Totaal_3))
        .map((r) => [year(r.Perioden), { exp: r.Totaal_15, imp: r.Totaal_3 }]),
    ),
    /** Jaren waarin een reeks van methode wisselt; de trendlijn breekt daar af. */
    breaks: [
      { year: Math.min(...svc14Years), ...N("Diensten: nieuwe indeling (BPM6)", "Services: new classification (BPM6)") },
      { year: goodsFrom, ...N("Goederen: nieuwe CBS-reeks (eigendomsoverdracht)", "Goods: new CBS series (transfer of ownership)") },
      { year: Math.min(...svcNewYears), ...N("Diensten: herziene reeks", "Services: revised series") },
    ],
    notes: [
      N(
        `Goederen ${range(goodsNewYears)}: CBS ${T.goederen.id}, volgens eigendomsoverdracht (het concept van de betalingsbalans). ${range(goodsOldYears)}: CBS ${T.goederenOud.id}, oude methode; kleinere landen staan daar alleen als regio.`,
        `Goods ${range(goodsNewYears)}: CBS ${T.goederen.id}, by transfer of ownership (the balance-of-payments concept). ${range(goodsOldYears)}: CBS ${T.goederenOud.id}, old method; smaller countries only appear as regions.`,
      ),
      N(
        `Diensten: CBS ${T.diensten.id} (${range(svcNewYears)}), ${T.diensten14.id} (${range(svc14Years)}) en ${T.diensten03.id} (${range(svc03Years)}, oude indeling). Op de overgangen is de reeks niet volledig vergelijkbaar.`,
        `Services: CBS ${T.diensten.id} (${range(svcNewYears)}), ${T.diensten14.id} (${range(svc14Years)}) and ${T.diensten03.id} (${range(svc03Years)}, old classification). The series is not fully comparable across these transitions.`,
      ),
      N(
        `Invoer voor wederuitvoer per herkomstland: CBS ${T.gebruik.id} (${range(shareYears)}); latere jaren gebruiken het aandeel van ${lastShareYear}. Voor ${goodsFrom} kan wederuitvoer alleen aan de uitvoerkant worden afgetrokken.`,
        `Imports for re-export by country of origin: CBS ${T.gebruik.id} (${range(shareYears)}); later years use the ${lastShareYear} share. Before ${goodsFrom}, re-exports can only be removed on the export side.`,
      ),
      ...extras.map((e) => e.meta).filter(Boolean),
      N(
        "Inkomens uit beleggingen (dividend, rente) zijn bewust weggelaten: die worden in Nederland sterk vertekend door brievenbusfirma's.",
        "Investment income (dividends, interest) is deliberately left out: in the Netherlands it is heavily distorted by special purpose entities.",
      ),
      N(
        `Landen met minder dan €${MIN_TRADE / 1000} mld handel per jaar zijn weggelaten, tenzij er andere geldstromen van minstens €${MIN_OTHER} mln zijn.`,
        `Countries with less than €${MIN_TRADE / 1000} bn of trade per year are left out, unless other flows reach at least €${MIN_OTHER} m.`,
      ),
    ],
  },
  netherlands: { id: "528", coords: [5.3, 52.2] },
  dict: { directions: DIRECTIONS, sectors: SECTORS, categories: CATEGORIES, dataTypes: DATATYPES, sources: sourceKeys, notes },
  sources,
  countries: out,
  taxContext: (belasting.context ?? []).map(({ source, nl, en }) => ({ source, ...N(nl, en) })),
  taxes: belasting.records.map(({ note_en, ...r }) => ({ ...r, note: r.note && N(r.note, note_en ?? r.note) })),
  recipients: (schattingen.recipients ?? []).map(({ note_en, name_en, ...r }) => ({ ...r, nameEn: name_en, note: r.note && N(r.note, note_en ?? r.note) })),
};

await mkdir(join(ROOT, "public", "data"), { recursive: true });
const json = JSON.stringify(dataset);
await writeFile(join(ROOT, "public", "data", "geldstromen.json"), json);

console.log(`${out.length} landen, ${out.reduce((n, c) => n + c.rows.length, 0)} rijen, ${Math.round(json.length / 1024)} kB`);
console.log(`Jaren: ${range(years)} (diensten ${range(serviceYears)}); extra bronnen: ${extras.map((e) => e.key).join(", ") || "geen"}`);
if (unmapped.size) console.warn(`Let op, niet gekoppeld: ${[...unmapped].join(", ")}`);
