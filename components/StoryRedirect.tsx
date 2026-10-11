"use client";

import { useEffect } from "react";

/** Stuurt bezoekers van een verhaalpagina door naar de kaart met dat verhaal (crawlers lezen de metadata). */
export default function StoryRedirect({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return null;
}
