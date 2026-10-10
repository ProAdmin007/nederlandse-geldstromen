import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_OPTIONS,
  convert,
  format,
  ranked,
  recipientsFor,
  resolveAll,
  resolveYear,
  toCsv,
  totals,
  type Options,
} from "./calc";
import { expandDataset, type RawDataset } from "./dataset";
import type { Dataset, Flow } from "./types";

const flow = (f: Partial<Flow>): Flow => ({
  direction: "uit",
  sector: "bedrijven",
  category: "goederen",
  amount: 100,
  year: 2024,
  dataType: "officieel",
  source: "cbs",
  ...f,
});

const opts = (o: Partial<Options> = {}): Options => ({ ...DEFAULT_OPTIONS, year: 2024, ...o });

describe("resolveYear", () => {
  const flows = [
    flow({ amount: 1000, dataType: "berekend" }),
    flow({ amount: 300, partOf: "goederen", reexport: true, dataType: "berekend" }),
    flow({ amount: 50, sector: "overheid", category: "defensie", partOf: "goederen", dataType: "schatting" }),
    flow({ direction: "in", amount: 400 }),
    flow({ year: 2023, amount: 999 }),
  ];

  it("laat het officiële cijfer intact bij inclusief wederuitvoer zonder schattingen", () => {
    const rows = resolveYear(flows, { year: 2024, reexport: true, estimates: false });
    expect(totals(rows)).toEqual({ uit: 1000, in: 400, netto: -600 });
  });

  it("trekt schattingen af van het cijfer waar ze in zitten, zodat het totaal gelijk blijft", () => {
    const rows = resolveYear(flows, { year: 2024, reexport: true, estimates: true });
    expect(totals(rows).uit).toBe(1000);
    expect(rows.find((r) => r.category === "goederen" && r.direction === "uit")!.amount).toBe(950);
    expect(rows.find((r) => r.category === "defensie")!.amount).toBe(50);
  });

  it("trekt wederuitvoer af als daarom gevraagd wordt", () => {
    const rows = resolveYear(flows, { year: 2024, reexport: false, estimates: false });
    expect(totals(rows).uit).toBe(700);
    const goods = rows.find((r) => r.category === "goederen" && r.direction === "uit")!;
    expect(goods.dataType).toBe("berekend");
    expect(goods.adjustments?.[0]).toMatchObject({ label: "wederuitvoer", amount: 300 });
  });

  it("wordt nooit negatief", () => {
    const rows = resolveYear([flow({ amount: 10 }), flow({ amount: 50, partOf: "goederen", reexport: true })], {
      year: 2024,
      reexport: false,
      estimates: true,
    });
    expect(totals(rows).uit).toBe(0);
  });

  it("maakt een officieel cijfer 'berekend' zodra er iets van af gaat", () => {
    const rows = resolveYear([flow({}), flow({ amount: 10, partOf: "goederen", reexport: true })], {
      year: 2024,
      reexport: false,
      estimates: true,
    });
    expect(rows[0].dataType).toBe("berekend");
  });
});

const mini: Dataset = {
  meta: {
    title: "",
    unit: "miljoen euro",
    generated: "",
    years: [2024],
    serviceYears: [2024],
    population: { 2024: 18_000_000 },
    gdp: { 2024: 1_000_000 },
    breaks: [],
    notes: [],
  },
  netherlands: { id: "528", coords: [5, 52] },
  sources: { cbs: { name: "test", publisher: "CBS" }, est: { name: "schatting", publisher: "eigen" } },
  countries: [
    {
      id: "372",
      name: "Ierland",
      coords: [-8, 53],
      flows: [
        flow({
          category: "it",
          amount: 1000,
          via: { country: "840", share: 0.9, dataType: "schatting", source: "est" },
        }),
      ],
    },
    { id: "840", name: "Verenigde Staten", coords: [-98, 39], flows: [flow({ category: "it", amount: 500 })] },
  ],
  recipients: [
    { name: "X", country: "840", billedFrom: "372", category: "it", sector: "bedrijven", amount: 5, year: 2023, dataType: "schatting", source: "est" },
  ],
};

describe("resolveAll", () => {
  it("verplaatst bij 'uiteindelijke ontvanger' een deel van Ierland naar de VS, zonder geld te verliezen", () => {
    const factuur = resolveAll(mini, opts());
    const ultiem = resolveAll(mini, opts({ ultimate: true }));
    const sum = (m: Map<string, Flow[]>) => [...m.values()].flat().reduce((n, f) => n + f.amount, 0);
    expect(sum(ultiem)).toBeCloseTo(sum(factuur));
    expect(totals(ultiem.get("372")!).uit).toBeCloseTo(100);
    expect(totals(ultiem.get("840")!).uit).toBeCloseTo(1400);
    const moved = ultiem.get("840")!.find((f) => f.movedFrom)!;
    expect(moved.movedFrom).toBe("Ierland");
    expect(moved.dataType).toBe("schatting");
  });

  it("verplaatst niets als schattingen uit staan en de toerekening een schatting is", () => {
    const r = resolveAll(mini, opts({ ultimate: true, estimates: false }));
    expect(totals(r.get("372")!).uit).toBe(1000);
  });

  it("filtert op categorie en sector", () => {
    expect(totals(resolveAll(mini, opts({ category: "energie" })).get("840")!).uit).toBe(0);
    expect(totals(resolveAll(mini, opts({ sector: "overheid" })).get("840")!).uit).toBe(0);
  });

  it("rangschikt landen op omvang", () => {
    expect(ranked(mini, resolveAll(mini, opts())).map((r) => r.country.id)).toEqual(["372", "840"]);
  });
});

describe("recipientsFor", () => {
  it("toont een ontvanger bij het factuurland of bij het moederland", () => {
    expect(recipientsFor(mini, opts(), "372")).toHaveLength(1);
    expect(recipientsFor(mini, opts(), "840")).toHaveLength(0);
    expect(recipientsFor(mini, opts({ ultimate: true }), "840")).toHaveLength(1);
  });

  it("gebruikt het laatste cijfer tot en met het jaar en markeert het als ouder", () => {
    const [r] = recipientsFor(mini, opts(), "372");
    expect(r.stale).toBe(true);
    expect(recipientsFor(mini, opts({ year: 2022 }), "372")).toHaveLength(0);
  });
});

describe("eenheden", () => {
  it("rekent om naar per inwoner en % bbp", () => {
    expect(convert(18, "pp", 2024, mini.meta)).toBeCloseTo(1);
    expect(convert(10_000, "bbp", 2024, mini.meta)).toBeCloseTo(1);
  });

  it("formatteert in het Nederlands", () => {
    expect(format(50_900, "eur", 2024, mini.meta)).toBe("€50,9 mld");
    expect(format(250, "eur", 2024, mini.meta)).toBe("€250 mln");
    expect(format(-2_700, "eur", 2024, mini.meta, true)).toBe("−€2,7 mld");
    expect(format(36_000, "pp", 2024, mini.meta)).toBe("€2.000 p.p.");
  });
});

describe("CSV", () => {
  it("heeft een kop en één regel per stroom", () => {
    const csv = toCsv(mini, resolveAll(mini, opts()), opts()).split("\n");
    expect(csv[0]).toMatch(/^jaar;land;/);
    expect(csv).toHaveLength(3);
  });
});

// ---- Controle van de echte data tegen de ruwe CBS-tabellen ------------------------

const root = join(__dirname, "..");
const real = expandDataset(JSON.parse(readFileSync(join(root, "public/data/geldstromen.json"), "utf8")) as RawDataset);
const cbsGoods = JSON.parse(readFileSync(join(root, "data/bronnen/cbs-goederen.json"), "utf8"));
const cbsServices = JSON.parse(readFileSync(join(root, "data/bronnen/cbs-diensten.json"), "utf8"));

const cbsRow = (t: { dimensions: { Landen: Record<string, string> }; data: Record<string, unknown>[] }, name: string, filter: (r: Record<string, unknown>) => boolean) => {
  const key = Object.entries(t.dimensions.Landen).find(([, v]) => v === name)![0];
  return t.data.find((r) => r.Landen === key && filter(r))!;
};

describe("echte data", () => {
  it("bevat genoeg landen en jaren", () => {
    expect(real.countries.length).toBeGreaterThan(50);
    expect(real.meta.years).toContain(2024);
    for (const c of ["840", "372", "643", "634"]) expect(real.countries.some((x) => x.id === c)).toBe(true);
  });

  it.each([
    ["Verenigde Staten", "840"],
    ["Duitsland", "276"],
    ["China", "156"],
    ["Ierland", "372"],
  ])("NL → %s in 2024 is precies CBS-goederen + CBS-diensten (standaardweergave, zonder schattingen)", (name, id) => {
    const g = cbsRow(cbsGoods, name, (r) => r.Perioden === "2024JJ00" && r.SITC === "T001082");
    const s = cbsRow(cbsServices, name, (r) => r.Perioden === "2024JJ00" && r.Diensten === "T001039");
    // Alleen CBS-regels: andere bronnen (overmakingen, hulp) komen er los bij.
    const flows = resolveAll(real, opts({ estimates: false })).get(id)!.filter((f) => f.source.startsWith("cbs-"));
    const t = totals(flows);
    // Afronding per regel op hele miljoenen: kleine afwijking toegestaan.
    expect(t.uit).toBeCloseTo((g.TotaleInvoerwaarde_1 as number) + (s.InvoerVanDiensten_1 as number), -1);
    expect(t.in).toBeCloseTo((g.TotaleUitvoerwaarde_2 as number) + (s.UitvoerVanDiensten_2 as number), -1);
  });

  it("schattingen veranderen het totaal niet (ze worden van het CBS-cijfer afgetrokken)", () => {
    for (const year of real.meta.years) {
      const a = resolveAll(real, opts({ year, estimates: false })).get("840")!;
      const b = resolveAll(real, opts({ year, estimates: true })).get("840")!;
      expect(totals(b).uit).toBeCloseTo(totals(a).uit, 0);
    }
  });

  it("zonder wederuitvoer is altijd kleiner of gelijk", () => {
    for (const year of real.meta.years) {
      const a = [...resolveAll(real, opts({ year })).values()].flat();
      const b = [...resolveAll(real, opts({ year, reexport: false })).values()].flat();
      expect(totals(b).uit).toBeLessThanOrEqual(totals(a).uit);
      expect(totals(b).in).toBeLessThan(totals(a).in);
    }
  });

  it("heeft voor elke regel een bestaande bron", () => {
    for (const c of real.countries) for (const f of c.flows) expect(real.sources[f.source]).toBeDefined();
    for (const r of real.recipients) expect(real.sources[r.source]).toBeDefined();
  });
});

// ---- Uitbreidingen: talen, vergelijken, trends, nieuwe bronnen, verhalen ---------------------

import { formatChange, trend } from "./calc";
import { STORIES } from "./stories";
import { STRINGS } from "./i18n";

describe("talen en vergelijken", () => {
  it("formatteert ook in het Engels", () => {
    expect(format(50_900, "eur", 2024, mini.meta, false, "en")).toBe("€50.9 bn");
    expect(format(250, "eur", 2024, mini.meta, false, "en")).toBe("€250 m");
    expect(format(36_000, "pp", 2024, mini.meta, false, "en")).toBe("€2,000 per person");
  });

  it("geeft procentuele verandering", () => {
    expect(formatChange(100, 150)).toBe("+50%");
    expect(formatChange(100, 95)).toBe("−5,0%");
    expect(formatChange(100, 95, "en")).toBe("−5.0%");
    expect(formatChange(0, 10)).toBe("nieuw");
  });

  it("heeft dezelfde vertaalsleutels in beide talen", () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.nl).sort());
  });

  it("pakt de data uit in de gekozen taal", () => {
    const raw = JSON.parse(readFileSync(join(root, "public/data/geldstromen.json"), "utf8")) as RawDataset;
    const en = expandDataset(raw, "en");
    const us = en.countries.find((c) => c.id === "840")!;
    expect(us.name).toBe("United States");
    expect(us.altName).toBe("Verenigde Staten");
    expect(en.meta.notes[0]).toMatch(/Goods/);
  });
});

describe("trend", () => {
  it("geeft een gat (null) in jaren zonder data, geen nul", () => {
    const data: Dataset = { ...mini, meta: { ...mini.meta, years: [2023, 2024] } };
    const points = trend(data, DEFAULT_OPTIONS);
    expect(points[0].t).toBeNull();
    expect(points[1].t?.uit).toBe(1500);
  });
});

describe("nieuwe bronnen (echte data)", () => {
  const sum = (id: string, year: number, category: string, direction: string) =>
    resolveAll(real, opts({ year, category: category as never }))
      .get(id)!
      .filter((f) => f.direction === direction)
      .reduce((n, f) => n + f.amount, 0);

  it("EU-begroting 2019: nationale bijdrage en invoerrechten zoals de Europese Commissie publiceert", () => {
    expect(sum("EU", 2019, "eu", "uit")).toBeCloseTo(5326.0 + 2729.1, -1);
    expect(sum("EU", 2019, "eu", "in")).toBeCloseTo(2557.1, -1);
  });

  it("pensioenen naar EU/EFTA/VK in 2024 tellen op tot het totaal van HIVA-tabel 8 (€1.581 mln)", () => {
    const total = real.countries.reduce((n, c) => n + sum(c.id, 2024, "uitkeringen", "uit"), 0);
    expect(total).toBeCloseTo(1581, -1);
  });

  it("ontwikkelingshulp en overmakingen staan bij de juiste landen", () => {
    expect(sum("804", 2023, "hulp", "uit")).toBeGreaterThan(100); // Oekraïne
    expect(sum("504", 2024, "overmakingen", "uit")).toBeGreaterThan(100); // Marokko
  });
});

describe("verhalen", () => {
  it("verwijzen naar bestaande landen, jaren en categorieën", () => {
    for (const s of STORIES) {
      if (s.state.country) expect(real.countries.some((c) => c.id === s.state.country), s.id).toBe(true);
      if (s.state.year) expect(real.meta.years, s.id).toContain(s.state.year);
      if (s.state.compare) expect(real.meta.years, s.id).toContain(s.state.compare);
      if (s.needs) expect(real.countries.some((c) => c.flows.some((f) => f.category === s.needs)), s.id).toBe(true);
    }
  });
});

describe("overheid", () => {
  it("heeft elk jaar sinds 2020 bekende uitgaven aan de VS (IT en defensie)", () => {
    for (const year of [2020, 2021, 2022, 2023, 2024, 2025]) {
      const flows = resolveAll(real, opts({ year, sector: "overheid" })).get("840")!;
      expect(totals(flows).uit, String(year)).toBeGreaterThan(100);
      expect(flows.some((f) => f.category === "it"), String(year)).toBe(true);
    }
  });
});
