import type { Metadata } from "next";
import { notFound } from "next/navigation";
import StoryRedirect from "@/components/StoryRedirect";
import { STORIES, storyQuery } from "@/lib/stories";

// Eén statische pagina per verhaal, zodat een gedeelde link een eigen titel en afbeelding krijgt.
export const dynamicParams = false;

export function generateStaticParams() {
  return STORIES.map((s) => ({ id: s.id }));
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const story = STORIES.find((s) => s.id === id);
  if (!story) return {};
  const title = `${story.title.nl} · Nederlandse Geldstromen`;
  const image = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/verhaal/${story.id}/og.png`;
  return {
    title,
    description: story.text.nl,
    openGraph: {
      title,
      description: story.text.nl,
      type: "article",
      locale: "nl_NL",
      siteName: "Nederlandse Geldstromen",
      images: [{ url: image, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description: story.text.nl, images: [image] },
  };
}

export default async function StoryPage({ params }: Props) {
  const { id } = await params;
  const story = STORIES.find((s) => s.id === id);
  if (!story) notFound();
  const href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/${storyQuery(story)}`;
  return (
    <main className="page">
      <StoryRedirect href={href} />
      <h1>{story.title.nl}</h1>
      <p className="muted">{story.text.nl}</p>
      <p>
        <a href={href}>Bekijk dit verhaal op de kaart →</a>
      </p>
    </main>
  );
}
