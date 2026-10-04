import type { NextConfig } from "next";

// Statische export: `npm run build` maakt een map `out/` die op elke webserver werkt
// (GitHub Pages, Netlify, Cloudflare Pages, een gewone webhost). Geen server nodig.
// Draait de site in een submap (bv. gebruiker.github.io/geldstromen), zet dan
// NEXT_PUBLIC_BASE_PATH=/geldstromen tijdens het bouwen.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  devIndicators: false,
};

export default nextConfig;
