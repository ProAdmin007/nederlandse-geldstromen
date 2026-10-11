// Controleert of er nieuwe landenrapporten (EU public country-by-country reporting) zijn van de
// gevolgde techbedrijven, voor Nederland, Ierland en Luxemburg, en voegt ze toe aan data/belasting.json.
//
// Bron: Taxplorer (EU Tax Observatory), dat de openbare rapporten verzamelt en naar euro omrekent.
// Licentie CC BY-NC-ND 4.0: vrij voor niet-commercieel gebruik met bronvermelding. We nemen alleen
// de enkele regels over die we tonen, met verwijzing naar Taxplorer; de database zelf bewaren we niet.
//
// Gebruik:
//   node scripts/check-cbcr.mjs           toont wat er nieuw is (verandert niets)
//   node scripts/check-cbcr.mjs --apply   voegt nieuwe regels toe aan data/belasting.json
// In GitHub Actions schrijft het een samenvatting naar $GITHUB_STEP_SUMMARY en zet het
// `new=<aantal>` in $GITHUB_OUTPUT, zodat de workflow een issue kan openen.

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "belasting.json");
const DATA_URL = "https://www.taxplorer.eu/data.json";

/** Taxplorer-naam → naam in de app. */
const COMPANIES = {
  MICROSOFT: "Microsoft",
  APPLE: "Apple",
  ALPHABET: "Google",
  "META PLATFORMS": "Meta",
  META: "Meta",
  AMAZON: "Amazon",
  NETFLIX: "Netflix",
  ORACLE: "Oracle",
  "IBM (INTERNATIONAL BUSINESS MACHINES)": "IBM",
  SALESFORCE: "Salesforce",
  CISCO: "Cisco",
  DELL: "Dell",
  "HP (HEWLETT-PACKARD)": "HP",
  "HPE (HEWLETT PACKARD ENTERPRISE)": "HPE",
};
/** ISO alpha-3 → ISO numeriek (zoals in de rest van de data). */
const COUNTRIES = { NLD: "528", IRL: "372", LUX: "442" };
const NAMES = { NLD: ["Nederland", "Netherlands"], IRL: ["Ierland", "Ireland"], LUX: ["Luxemburg", "Luxembourg"] };

const apply = process.argv.includes("--apply");
const mln = (v) => (typeof v === "number" ? Math.round(v / 1e5) / 10 : undefined);

const res = await fetch(DATA_URL);
if (!res.ok) throw new Error(`${res.status} voor ${DATA_URL}`);
const db = await res.json();
const col = Object.fromEntries(db.schema.map((name, i) => [name, i]));

const belasting = JSON.parse(await readFile(FILE, "utf8"));
const have = new Set(belasting.records.map((r) => `${r.company}|${r.country}|${r.year}`));

const found = [];
for (const row of db.rows) {
  const company = COMPANIES[row[col.mnc]];
  const code = row[col.jurCode];
  if (!company || !COUNTRIES[code]) continue;
  const year = row[col.year];
  const key = `${company}|${COUNTRIES[code]}|${year}`;
  if (have.has(key)) continue; // al aanwezig (ook als we het uit het eigen rapport van het bedrijf hebben)
  have.add(key);
  const [nl, en] = NAMES[code];
  found.push({
    company,
    country: COUNTRIES[code],
    parent: "840",
    year,
    currency: "EUR",
    revenue: mln(row[col.revenue]),
    revenueRelated: mln(row[col.relatedRevenue]),
    profit: mln(row[col.profit]),
    taxPaid: mln(row[col.taxPaid]),
    taxAccrued: mln(row[col.taxAccrued]),
    employees: typeof row[col.employees] === "number" ? row[col.employees] : undefined,
    dataType: "berekend",
    source: "taxplorer",
    note: `${nl}: uit het openbare landenrapport (${row[col.disclosureType] === "public_cbcr" ? "EU-richtlijn 2021/2101" : "vrijwillig"}), via Taxplorer omgerekend naar euro. Automatisch toegevoegd.`,
    note_en: `${en}: from the public country-by-country report (${row[col.disclosureType] === "public_cbcr" ? "EU Directive 2021/2101" : "voluntary"}), converted to euro by Taxplorer. Added automatically.`,
  });
}

const lines = found.map((r) => `- **${r.company}** ${r.year}, ${NAMES[Object.keys(COUNTRIES).find((k) => COUNTRIES[k] === r.country)][0]}: omzet €${r.revenue ?? "?"} mln, winst €${r.profit ?? "?"} mln, belasting €${r.taxPaid ?? r.taxAccrued ?? "?"} mln`);
console.log(found.length ? `Nieuwe landenrapporten (Taxplorer ${db.version}):\n${lines.join("\n")}` : `Niets nieuws (Taxplorer ${db.version}).`);

if (apply && found.length) {
  belasting.sources.taxplorer ??= {
    name: "Taxplorer: openbare landenrapporten van multinationals, omgerekend naar euro (CC BY-NC-ND 4.0)",
    nameEn: "Taxplorer: public country-by-country reports of multinationals, converted to euro (CC BY-NC-ND 4.0)",
    publisher: "EU Tax Observatory",
    url: "https://www.taxplorer.eu/",
  };
  belasting.records.push(...found.map((r) => JSON.parse(JSON.stringify(r)))); // zonder undefined-velden
  await writeFile(FILE, JSON.stringify(belasting, null, 2) + "\n");
  console.log(`${found.length} regel(s) toegevoegd aan data/belasting.json`);
}

if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `new=${found.length}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Landenrapporten\n\n${found.length ? lines.join("\n") : "Niets nieuws."}\n`);
