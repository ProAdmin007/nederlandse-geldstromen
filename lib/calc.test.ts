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
    const flows = resolveAll(real, opts({ estimates: false })).get(id)!;
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
