import { ImageResponse } from "next/og";
import OgCard from "@/components/OgCard";
import { loadDataset } from "@/lib/serverData";
import { storyFacts } from "@/lib/share";
import { STORIES } from "@/lib/stories";

// Deelafbeelding per verhaal, tijdens de build gemaakt als echt .png-bestand.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return STORIES.map((s) => ({ id: s.id }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = STORIES.find((s) => s.id === id) ?? STORIES[0];
  const data = loadDataset("nl");
  return new ImageResponse(
    <OgCard title={story.title.nl} subtitle={story.text.nl} facts={storyFacts(data, story, "nl")} footer="Bron: CBS, OESO, Eurostat, Europese Commissie · open data" />,
    { width: 1200, height: 630 },
  );
}
