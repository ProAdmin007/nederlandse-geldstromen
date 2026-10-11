"use client";

import type { Facts } from "./share";

const C = {
  bg: "#f5f6f4",
  card: "#ffffff",
  text: "#1c2321",
  muted: "#66706c",
  accent: "#23423a",
  uit: "#d9622b",
  in: "#1e8f7e",
  border: "#e2e5e1",
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Breekt tekst af op woordgrenzen zodat hij binnen `max` pixels past. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Tekent een deelafbeelding (1200×630) van het huidige beeld en downloadt hem als PNG. */
export async function downloadShareImage(opts: { title: string; subtitle: string; facts: Facts; footer: string; filename: string }) {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Merk
  ctx.fillStyle = "#f08a24";
  ctx.beginPath();
  ctx.arc(64, 70, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.accent;
  ctx.font = `700 26px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.fillText("Nederlandse Geldstromen", 84, 71);

  // Titel en ondertitel
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = C.text;
  ctx.font = `800 54px ${FONT}`;
  let y = 160;
  for (const l of wrap(ctx, opts.title, W - 112).slice(0, 2)) {
    ctx.fillText(l, 56, y);
    y += 62;
  }
  ctx.fillStyle = C.muted;
  ctx.font = `400 26px ${FONT}`;
  for (const l of wrap(ctx, opts.subtitle, W - 112).slice(0, 2)) {
    ctx.fillText(l, 56, y);
    y += 36;
  }

  // Kaart met kerncijfers
  const cardY = 372;
  ctx.fillStyle = C.card;
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(56, cardY, W - 112, 170, 20);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.muted;
  ctx.font = `400 22px ${FONT}`;
  ctx.fillText(opts.facts.heading, 84, cardY + 44);
  const colW = (W - 168) / Math.max(1, opts.facts.lines.length);
  opts.facts.lines.forEach((l, i) => {
    const x = 84 + i * colW;
    ctx.fillStyle = l.tone === "uit" ? C.uit : l.tone === "in" ? C.in : C.accent;
    ctx.fillRect(x, cardY + 66, 6, 80);
    ctx.fillStyle = C.muted;
    ctx.font = `400 21px ${FONT}`;
    ctx.fillText(wrap(ctx, l.label, colW - 40)[0] ?? "", x + 18, cardY + 88);
    ctx.fillStyle = C.text;
    ctx.font = `800 38px ${FONT}`;
    ctx.fillText(l.value, x + 18, cardY + 136);
  });

  ctx.fillStyle = C.muted;
  ctx.font = `400 19px ${FONT}`;
  ctx.fillText(opts.footer, 56, H - 40);

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = opts.filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
