// Haalt de benodigde CBS-tabellen op en bewaart ze als ruwe JSON in data/bronnen/.
// Gebruik: npm run data:fetch   (daarna npm run data:build)
//
// Bronnen (CBS StatLine, open data, geen API-sleutel nodig):
//   85427NED  Internationale goederenhandel; eigendomsoverdracht (land × SITC, incl. wederuitvoer)
//   85940NED  Invoer van goederen; gebruik (o.a. bestemd voor wederuitvoer), herkomstland
//   84765NED  Internationale handel; invoer en uitvoer van diensten naar land
//   85496NED  Bevolking; kerncijfers
//   85879NED  Bbp, productie en bestedingen; waarden

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "bronnen");
const FEED = "https://opendata.cbs.nl/ODataFeed/odata";

/** Haalt alle rijen op en volgt de paginering van de CBS-feed. */
async function fetchAll(url) {
  const rows = [];
  let next = url;
  while (next) {
    const res = await fetch(next, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} voor ${next}`);
    const json = await res.json();
    rows.push(...json.value);
    next = json["odata.nextLink"] ?? null;
  }
  return rows;
}

async function table(id, { filter, select, dims }) {
  const q = new URLSearchParams({ $format: "json" });
  if (filter) q.set("$filter", filter);
  if (select) q.set("$select", select);
  const data = await fetchAll(`${FEED}/${id}/TypedDataSet?${q}`);
  const dimensions = {};
  for (const d of dims) {
    const values = await fetchAll(`${FEED}/${id}/${d}?$format=json`);
    dimensions[d] = Object.fromEntries(values.map((v) => [v.Key, v.Title.trim()]));
  }
  const meta = await (await fetch(`${FEED}/${id}/TableInfos?$format=json`)).json();
  const info = meta.value[0];
  return {
    id,
    title: info.Title,
    modified: info.Modified,
    url: `https://opendata.cbs.nl/statline/#/CBS/nl/dataset/${id}/table`,
    dimensions,
    data,
  };
}

const yearly = "substringof('JJ',Perioden)";

const TABLES = {
  "cbs-goederen": () =>
    table("85427NED", {
      filter: `${yearly} and (SITC eq 'T001082' or SITC eq 'A018591')`,
      select: "Landen,SITC,Perioden,TotaleInvoerwaarde_1,TotaleUitvoerwaarde_2,Wederuitvoerwaarde_3,UitvoerwaardeProductNL_4",
      dims: ["Landen", "SITC", "Perioden"],
    }),
  "cbs-invoer-gebruik": () =>
    table("85940NED", {
      filter: `${yearly} and CPA2008 eq 'T001026' and (Verbruiksbestemming eq 'T001678' or Verbruiksbestemming eq 'A052674')`,
      select: "Landen,Verbruiksbestemming,Perioden,InvoerGoederenNaarEigendomsoverdracht_1",
      dims: ["Landen", "Verbruiksbestemming", "Perioden"],
    }),
  "cbs-diensten": () =>
    table("84765NED", {
      filter: `${yearly} and (Diensten eq 'T001039' or Diensten eq 'A007856' or Diensten eq 'A007847' or Diensten eq 'A007827' or Diensten eq 'A007903')`,
      select: "Landen,Diensten,Perioden,InvoerVanDiensten_1,UitvoerVanDiensten_2",
      dims: ["Landen", "Diensten", "Perioden"],
    }),
  "cbs-bevolking": () =>
    table("85496NED", { filter: "Perioden ge '2014JJ00'", select: "Perioden,TotaleBevolking_1", dims: [] }),
  "cbs-bbp": () =>
    table("85879NED", {
      filter: `${yearly} and SoortGegevens eq 'A045297' and Perioden ge '2014JJ00'`,
      select: "Perioden,BrutoBinnenlandsProduct_2",
      dims: [],
    }),
};

await mkdir(OUT, { recursive: true });
for (const [name, load] of Object.entries(TABLES)) {
  process.stdout.write(`${name} ... `);
  const t = await load();
  await writeFile(join(OUT, `${name}.json`), JSON.stringify(t));
  console.log(`${t.data.length} rijen (${t.id}, bijgewerkt ${t.modified.slice(0, 10)})`);
}
