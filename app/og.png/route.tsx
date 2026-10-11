import { ImageResponse } from "next/og";
import OgCard from "@/components/OgCard";
import { loadDataset } from "@/lib/serverData";
import { factsFor } from "@/lib/share";
import { DEFAULT_OPTIONS } from "@/lib/calc";

// Deelafbeelding voor de startpagina, tijdens de build gemaakt als echt .png-bestand
// (statische hosts zoals GitHub Pages serveren dan het juiste bestandstype).
export const dynamic = "force-static";

export function GET() {
  const data = loadDataset("nl");
  // Het laatste jaar waarin alle bronnen compleet zijn.
  const year = Math.max(...data.meta.years) - 1;
  return new ImageResponse(
    <OgCard
      title="Hoeveel geld stroomt er tussen Nederland en de wereld?"
      subtitle="Handel, hulp, EU, pensioenen en Big Tech: 121 landen, 2002–2025, met bron bij elk bedrag."
      facts={factsFor(data, { ...DEFAULT_OPTIONS, year }, "840", "nl")}
      footer="Bron: CBS, OESO, Eurostat, Europese Commissie · open data"
    />,
    { width: 1200, height: 630 },
  );
}
