// Alleen tijdens de build (server): leest de gegenereerde dataset van schijf.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expandDataset, type RawDataset } from "./dataset";
import type { Dataset, Lang } from "./types";

export function loadDataset(lang: Lang = "nl"): Dataset {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "geldstromen.json"), "utf8")) as RawDataset;
  return expandDataset(raw, lang);
}
