// Kerncijfers voor deelafbeeldingen en -teksten. Puur (geen React), dus bruikbaar tijdens de build.
import { DEFAULT_OPTIONS, format, ranked, resolveAll, totals, type Options } from "./calc";
import type { Dataset, Lang } from "./types";
import type { Story } from "./stories";
import { CATEGORY_LABELS } from "./i18n";

export interface Facts {
  heading: string;
  lines: { label: string; value: string; tone?: "uit" | "in" }[];
}

/** De belangrijkste getallen voor een stand van de app: een land, of de grootste landen binnen een filter. */
export function factsFor(data: Dataset, opts: Options, countryId: string | null, lang: Lang): Facts {
  const r = resolveAll(data, opts);
  const f = (v: number, signed = false) => format(v, "eur", opts.year, data.meta, signed, lang);
  const country = countryId ? data.countries.find((c) => c.id === countryId) : null;
  const cat = opts.category === "alles" ? "" : ` · ${CATEGORY_LABELS[lang][opts.category]}`;
  if (country) {
    const t = totals(r.get(country.id) ?? []);
    return {
      heading: `${country.name} · ${opts.year}${cat}`,
      lines: [
        { label: lang === "en" ? `Netherlands → ${country.name}` : `Nederland → ${country.name}`, value: f(t.uit), tone: "uit" },
        { label: lang === "en" ? `${country.name} → Netherlands` : `${country.name} → Nederland`, value: f(t.in), tone: "in" },
        { label: lang === "en" ? "Net" : "Netto", value: f(t.netto, true) },
      ],
    };
  }
  const top = ranked(data, r)
    .sort((a, b) => b.t.uit - a.t.uit)
    .slice(0, 3);
  return {
    heading: `${lang === "en" ? "Out of the Netherlands" : "Uit Nederland"} · ${opts.year}${cat}`,
    lines: top.map(({ country, t }) => ({ label: country.name, value: f(t.uit), tone: "uit" as const })),
  };
}

export function storyFacts(data: Dataset, story: Story, lang: Lang): Facts {
  const year = story.state.year ?? Math.max(...data.meta.years);
  const opts: Options = { ...DEFAULT_OPTIONS, ...story.state, year } as Options;
  return factsFor(data, opts, story.state.country ?? null, lang);
}
