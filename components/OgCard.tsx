// Deelafbeelding (1200×630) voor sociale media, gerenderd tijdens de build met next/og.
// Satori ondersteunt alleen inline stijlen en flexbox.
import type { Facts } from "@/lib/share";

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

export default function OgCard({ title, subtitle, facts, footer }: { title: string; subtitle: string; facts: Facts; footer: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: C.bg, padding: 56, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, color: C.accent, fontSize: 26, fontWeight: 700 }}>
        <div style={{ width: 18, height: 18, borderRadius: 9, background: "#f08a24" }} />
        Nederlandse Geldstromen
      </div>
      <div style={{ display: "flex", fontSize: 58, fontWeight: 800, color: C.text, marginTop: 24, lineHeight: 1.1, letterSpacing: -1 }}>{title}</div>
      <div style={{ display: "flex", fontSize: 26, color: C.muted, marginTop: 14, lineHeight: 1.35 }}>{subtitle}</div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: "auto",
          background: C.card,
          border: `2px solid ${C.border}`,
          borderRadius: 20,
          padding: "22px 28px",
        }}
      >
        <div style={{ display: "flex", fontSize: 22, color: C.muted, marginBottom: 10 }}>{facts.heading}</div>
        <div style={{ display: "flex", gap: 36 }}>
          {facts.lines.map((l) => (
            <div key={l.label} style={{ display: "flex", flexDirection: "column", borderLeft: `6px solid ${l.tone === "uit" ? C.uit : l.tone === "in" ? C.in : C.accent}`, paddingLeft: 14 }}>
              <div style={{ display: "flex", fontSize: 22, color: C.muted }}>{l.label}</div>
              <div style={{ display: "flex", fontSize: 40, fontWeight: 800, color: C.text }}>{l.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", fontSize: 20, color: C.muted, marginTop: 18 }}>{footer}</div>
    </div>
  );
}
