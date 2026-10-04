// Bouwt public/data/geldstromen.json uit:
//   data/bronnen/*.json   ruwe CBS-tabellen (npm run data:fetch)
//   data/schattingen.json handmatige schattingen en ontvangers, elk met bron
//   data/landen.json      koppeling CBS-landnaam → ISO-code/kaartpositie
//
// Gebruik: npm run data:build
//
// Uitgangspunt: officiële CBS-cijfers blijven intact. Wederuitvoer en schattingen
// worden als "waarvan"-regels (partOf) opgeslagen; de app trekt ze er pas vanaf als
// de gebruiker daarom vraagt. Bedragen in miljoen euro.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), "utf8"));

const goederen = await read("data/bronnen/cbs-goederen.json");
const gebruik = await read("data/bronnen/cbs-invoer-gebruik.json");
const diensten = await read("data/bronnen/cbs-diensten.json");
const bevolking = await read("data/bronnen/cbs-bevolking.json");
const bbp = await read("data/bronnen/cbs-bbp.json");
const schattingen = await read("data/schattingen.json");
const landen = await read("data/landen.json");
const world = await read("node_modules/world-atlas/countries-110m.json");

/** Regio-totalen en restposten in de CBS-tabellen; geen land. */
const AGGREGATE = /Totaal|EU|Europ|Afrika|Amerika|Azië|Oceanië|Overig|Niet |Boordprovisie|Zeegebied|Eurozone|instellingen|organisaties|Oosten/;

/** Landen met in enig jaar minder handel dan dit (mln euro, beide richtingen) laten we weg. */
const MIN_TRADE = 1000;

const DIRECTIONS = ["uit", "in"];
const SECTORS = ["overheid", "bedrijven", "consumenten"];
const CATEGORIES = ["it", "energie", "goederen", "diensten", "defensie", "ie"];
const DATATYPES = ["officieel", "berekend", "schatting"];

const SITC_TOTAAL = "T001082";
const SITC_ENERGIE = "A018591"; // 3 Minerale brandstoffen, smeermiddelen e.d.
const GEBRUIK_TOTAAL = "T001678";
const GEBRUIK_WEDERUITVOER = "A052674";
const D = {
  totaal: "T001039",
  it: "A007856", // SI Telecommunicatie-, computer- en informatiediensten
  ie: "A007847", // SH Gebruik intellectueel eigendom
  prive: "A007827", // SDB Privé reisverkeer
  overheid: "A007903", // SL Overheidsdiensten
};

const year = (p) => Number(p.slice(0, 4));
/** Alleen volledige jaren ("2026 januari-juli" valt af). */
const fullYears = (t) =>
  Object.entries(t.dimensions.Perioden)
    .filter(([k, v]) => k.includes("JJ") && /^\d{4}\*?$/.test(v))
    .map(([k]) => year(k));

const goodsYears = fullYears(goederen);
const serviceYears = fullYears(diensten);
const shareYears = fullYears(gebruik);
const lastShareYear = Math.max(...shareYears);
const years = [...new Set([...goodsYears, ...serviceYears])].sort();

// ---- Bronnen ------------------------------------------------------------
const sources = {
  "cbs-goederen": {
    name: `${goederen.title} (${goederen.id})`,
    publisher: "CBS StatLine",
    url: goederen.url,
  },
  "cbs-invoer-gebruik": {
    name: `${gebruik.title} (${gebruik.id})`,
    publisher: "CBS StatLine",
    url: gebruik.url,
  },
  "cbs-diensten": {
    name: `${diensten.title} (${diensten.id})`,
    publisher: "CBS StatLine",
    url: diensten.url,
  },
  "cbs-bevolking": { name: `${bevolking.title} (${bevolking.id})`, publisher: "CBS StatLine", url: bevolking.url },
  "cbs-bbp": { name: `${bbp.title} (${bbp.id})`, publisher: "CBS StatLine", url: bbp.url },
  ...schattingen.sources,
};
const sourceKeys = Object.keys(sources);
const notes = [];
const noteIdx = (n) => {
  if (!n) return -1;
  let i = notes.indexOf(n);
  if (i < 0) i = notes.push(n) - 1;
  return i;
};

// ---- Indexeren van de ruwe tabellen per land/jaar -------------------------
const byKey = (rows, keyFn) => {
  const m = new Map();
  for (const r of rows) m.set(keyFn(r), r);
  return m;
};
const g = byKey(goederen.data, (r) => `${r.Landen}|${r.SITC}|${year(r.Perioden)}`);
const u = byKey(gebruik.data, (r) => `${r.Landen}|${r.Verbruiksbestemming}|${year(r.Perioden)}`);
const s = byKey(diensten.data, (r) => `${r.Landen}|${r.Diensten}|${year(r.Perioden)}`);

// CBS gebruikt per tabel eigen sleutels; we koppelen via de landnaam.
const keyByName = (t) => Object.fromEntries(Object.entries(t.dimensions.Landen).map(([k, v]) => [v, k]));
const gKey = keyByName(goederen);
const uKey = keyByName(gebruik);
const sKey = keyByName(diensten);

// ---- Kaartposities -------------------------------------------------------
const shapes = feature(world, world.objects.countries).features;
function centroid(id) {
  const f = shapes.find((x) => x.id === id);
  if (!f) return null;
  if (f.geometry.type === "MultiPolygon") {
    // Middelpunt van het grootste deel (anders belandt Frankrijk in zee door Frans-Guyana).
    const parts = f.geometry.coordinates.map((c) => ({ type: "Polygon", coordinates: c }));
    parts.sort((a, b) => geoArea(b) - geoArea(a));
    return geoCentroid(parts[0]).map((v) => Math.round(v * 10) / 10);
  }
  return geoCentroid(f).map((v) => Math.round(v * 10) / 10);
}

// ---- Rijen opbouwen --------------------------------------------------------
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const round = (v) => Math.round(v);

function rowsForCountry(name) {
  const rows = [];
  const add = (r) => {
    if (r.amount == null || Math.round(r.amount) <= 0) return;
    rows.push([
      r.year,
      DIRECTIONS.indexOf(r.direction),
      SECTORS.indexOf(r.sector ?? "bedrijven"),
      CATEGORIES.indexOf(r.category),
      round(r.amount),
      DATATYPES.indexOf(r.dataType),
      sourceKeys.indexOf(r.source),
      noteIdx(r.note),
      r.partOf ? CATEGORIES.indexOf(r.partOf) : -1,
      r.reexport ? 1 : 0,
    ]);
  };

  const gk = gKey[name];
  const uk = uKey[name];
  const sk = sKey[name];

  for (const y of goodsYears) {
    if (!gk) break;
    const tot = g.get(`${gk}|${SITC_TOTAAL}|${y}`);
    if (!tot) continue;
    const en = g.get(`${gk}|${SITC_ENERGIE}|${y}`) ?? {};
    const imp = num(tot.TotaleInvoerwaarde_1);
    const exp = num(tot.TotaleUitvoerwaarde_2);
    const impE = num(en.TotaleInvoerwaarde_1) ?? 0;
    const expE = num(en.TotaleUitvoerwaarde_2) ?? 0;
    const wed = num(tot.Wederuitvoerwaarde_3);
    const wedE = num(en.Wederuitvoerwaarde_3) ?? 0;

    const base = { year: y, source: "cbs-goederen", sector: "bedrijven" };
    if (imp != null) {
      add({ ...base, direction: "uit", category: "goederen", amount: imp - impE, dataType: "berekend", note: "Totale goedereninvoer minus energie (SITC 3)" });
      add({ ...base, direction: "uit", category: "energie", amount: impE, dataType: "officieel", note: "SITC 3: minerale brandstoffen, smeermiddelen" });
    }
    if (exp != null) {
      add({ ...base, direction: "in", category: "goederen", amount: exp - expE, dataType: "berekend", note: "Totale goederenuitvoer minus energie (SITC 3)" });
      add({ ...base, direction: "in", category: "energie", amount: expE, dataType: "officieel", note: "SITC 3: minerale brandstoffen, smeermiddelen" });
    }

    // Wederuitvoer: uitvoerkant direct uit CBS; invoerkant via het aandeel uit 85940NED.
    if (wed != null) {
      add({ ...base, direction: "in", category: "goederen", amount: wed - wedE, dataType: "berekend", partOf: "goederen", reexport: true, note: "Wederuitvoer naar dit land (excl. energie)" });
      add({ ...base, direction: "in", category: "energie", amount: wedE, dataType: "officieel", partOf: "energie", reexport: true, note: "Wederuitvoer van energie naar dit land" });
    }
    if (imp != null && uk) {
      const sy = Math.min(y, lastShareYear);
      const t = num(u.get(`${uk}|${GEBRUIK_TOTAAL}|${sy}`)?.InvoerGoederenNaarEigendomsoverdracht_1);
      const w = num(u.get(`${uk}|${GEBRUIK_WEDERUITVOER}|${sy}`)?.InvoerGoederenNaarEigendomsoverdracht_1);
      if (t && w != null && t > 0) {
        const share = Math.min(1, w / t);
        const note =
          y > lastShareYear
            ? `Ingevoerd voor wederuitvoer; aandeel ${Math.round(share * 100)}% uit ${lastShareYear} (laatst beschikbaar) toegepast`
            : `Ingevoerd voor wederuitvoer; aandeel ${Math.round(share * 100)}% volgens CBS 85940NED`;
        const src = { ...base, source: "cbs-invoer-gebruik", dataType: "berekend", reexport: true, note };
        add({ ...src, direction: "uit", category: "goederen", amount: (imp - impE) * share, partOf: "goederen" });
        add({ ...src, direction: "uit", category: "energie", amount: impE * share, partOf: "energie" });
      }
    }
  }

  for (const y of serviceYears) {
    if (!sk) break;
    const get = (code) => s.get(`${sk}|${code}|${y}`) ?? {};
    const tot = get(D.totaal);
    const base = { year: y, source: "cbs-diensten" };
    for (const [field, direction] of [
      ["InvoerVanDiensten_1", "uit"],
      ["UitvoerVanDiensten_2", "in"],
    ]) {
      const total = num(tot[field]);
      if (total == null) continue;
      const it = num(get(D.it)[field]) ?? 0;
      const ie = num(get(D.ie)[field]) ?? 0;
      const gov = num(get(D.overheid)[field]) ?? 0;
      // Privé reisverkeer: NL → land = Nederlanders op vakantie (consumenten).
      // Andersom ontvangen Nederlandse bedrijven (hotels e.d.) het geld; dat blijft in "diensten".
      const prive = direction === "uit" ? num(get(D.prive)[field]) ?? 0 : 0;
      add({ ...base, direction, sector: "bedrijven", category: "it", amount: it, dataType: "officieel", note: "Telecommunicatie-, computer- en informatiediensten" });
      add({ ...base, direction, sector: "bedrijven", category: "ie", amount: ie, dataType: "officieel", note: "Vergoedingen voor gebruik van intellectueel eigendom (royalty's, licenties)" });
      add({ ...base, direction, sector: "consumenten", category: "diensten", amount: prive, dataType: "officieel", note: "Privé reisverkeer: uitgaven van Nederlanders in het buitenland" });
      add({ ...base, direction, sector: "overheid", category: "diensten", amount: gov, dataType: "officieel", note: "Overheidsdiensten" });
      add({ ...base, direction, sector: "bedrijven", category: "diensten", amount: total - it - ie - prive - gov, dataType: "berekend", note: "Overige diensten: totaal minus IT, intellectueel eigendom, privé reisverkeer en overheid" });
    }
  }
  return rows;
}

// ---- Landen samenstellen ---------------------------------------------------
const names = new Set([...Object.keys(gKey), ...Object.keys(sKey)]);
const countries = new Map();
const unmapped = [];
for (const name of names) {
  const map = landen[name];
  const rows = rowsForCountry(name);
  if (!rows.length) continue;
  const perYear = {};
  for (const r of rows) if (r[8] < 0) perYear[r[0]] = (perYear[r[0]] ?? 0) + r[4];
  const max = Math.max(0, ...Object.values(perYear));
  if (!map) {
    if (max >= MIN_TRADE && !AGGREGATE.test(name)) unmapped.push(name);
    continue;
  }
  const existing = countries.get(map.id);
  if (existing) {
    existing.rows.push(...rows); // zelfde land onder twee namen (bv. Saudi-/Saoedi-Arabië)
    existing.max = Math.max(existing.max, max);
    continue;
  }
  countries.set(map.id, {
    id: map.id,
    name: map.naam ?? name,
    coords: map.coords ?? centroid(map.id),
    rows,
    max,
  });
}

// Schattingen toevoegen (die kunnen ook landen afdwingen die onder de drempel zitten).
for (const e of schattingen.flows) {
  const c = countries.get(e.country);
  if (!c) throw new Error(`Schatting voor onbekend land ${e.country}`);
  for (const y of e.years ?? [e.year]) {
    c.rows.push([
      y,
      DIRECTIONS.indexOf(e.direction),
      SECTORS.indexOf(e.sector),
      CATEGORIES.indexOf(e.category),
      round(e.amounts?.[y] ?? e.amount),
      DATATYPES.indexOf(e.dataType),
      sourceKeys.indexOf(e.source),
      noteIdx(e.note),
      e.partOf ? CATEGORIES.indexOf(e.partOf) : -1,
      0,
    ]);
  }
  c.forced = true;
}
for (const c of countries.values()) {
  for (const r of c.rows) {
    if (r[6] < 0) throw new Error(`Onbekende bron in rij voor ${c.name}: ${JSON.stringify(r)}`);
    if (r.slice(1, 6).some((v) => v < 0)) throw new Error(`Ongeldige rij voor ${c.name}: ${JSON.stringify(r)}`);
  }
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
    note: v.note,
  });
}

const out = [...countries.values()]
  .filter((c) => c.max >= MIN_TRADE || c.forced)
  .sort((a, b) => b.max - a.max)
  .map((c) => ({
    id: c.id,
    name: c.name,
    coords: c.coords,
    rows: c.rows.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[3] - b[3]),
    ...(via[c.id] ? { via: via[c.id] } : {}),
  }));

const missingCoords = out.filter((c) => !c.coords).map((c) => c.name);
if (missingCoords.length) throw new Error(`Geen kaartpositie voor: ${missingCoords.join(", ")} (vul coords in data/landen.json)`);

const pick = (t, field) =>
  Object.fromEntries(t.data.filter((r) => r.Perioden.includes("JJ") && num(r[field])).map((r) => [year(r.Perioden), r[field]]));

const dataset = {
  format: 2,
  meta: {
    title: "Nederlandse Geldstromen",
    unit: "miljoen euro",
    generated: new Date().toISOString().slice(0, 10),
    years,
    serviceYears,
    population: pick(bevolking, "TotaleBevolking_1"),
    gdp: pick(bbp, "BrutoBinnenlandsProduct_2"),
    notes: [
      `Goederen: CBS ${goederen.id}, eigendomsoverdracht (${Math.min(...goodsYears)}–${Math.max(...goodsYears)}). Dit is het concept van de betalingsbalans: wie eigenaar wordt, niet waar de goederen de grens over gaan.`,
      `Diensten: CBS ${diensten.id} (${Math.min(...serviceYears)}–${Math.max(...serviceYears)}). Voor eerdere jaren zijn er geen dienstencijfers per land in deze reeks.`,
      `Invoer voor wederuitvoer per herkomstland: CBS ${gebruik.id} (${Math.min(...shareYears)}–${lastShareYear}); latere jaren gebruiken het aandeel van ${lastShareYear}.`,
      "Inkomens uit beleggingen (dividend, rente) zijn bewust weggelaten: die worden in Nederland sterk vertekend door brievenbusfirma's.",
      `Landen met minder dan €${MIN_TRADE / 1000} mld handel per jaar zijn weggelaten.`,
    ],
  },
  netherlands: { id: "528", coords: [5.3, 52.2] },
  dict: { directions: DIRECTIONS, sectors: SECTORS, categories: CATEGORIES, dataTypes: DATATYPES, sources: sourceKeys, notes },
  sources,
  countries: out,
  recipients: schattingen.recipients ?? [],
};

await mkdir(join(ROOT, "public", "data"), { recursive: true });
const json = JSON.stringify(dataset);
await writeFile(join(ROOT, "public", "data", "geldstromen.json"), json);

console.log(`${out.length} landen, ${out.reduce((n, c) => n + c.rows.length, 0)} rijen, ${Math.round(json.length / 1024)} kB`);
console.log(`Jaren: ${years.join(", ")} (diensten vanaf ${Math.min(...serviceYears)})`);
if (unmapped.length) console.warn(`Let op, niet gekoppeld (≥ €1 mld): ${unmapped.join(", ")}`);
