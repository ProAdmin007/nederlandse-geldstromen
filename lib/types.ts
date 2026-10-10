// Datamodel voor public/data/geldstromen.json (gegenereerd door scripts/build-data.mjs).
// Alle bedragen zijn in miljoen euro (EUR mln).

/** Richting vanuit Nederlands perspectief. */
export type Direction = "uit" | "in"; // uit = NL → land, in = land → NL

/**
 * De Nederlandse partij die betaalt (uit) of ontvangt (in).
 * CBS splitst handel niet uit naar betaler: handel die niet aan overheid of
 * consumenten is toe te rekenen, staat onder "bedrijven".
 */
export type Sector = "overheid" | "bedrijven" | "consumenten";

export type Category =
  | "it"
  | "energie"
  | "goederen"
  | "diensten"
  | "defensie"
  | "ie"
  | "hulp" // ontwikkelingshulp
  | "eu" // EU-begroting: afdrachten en EU-uitgaven in Nederland
  | "uitkeringen" // AOW e.d. betaald aan mensen in het buitenland
  | "overmakingen"; // geld dat migranten naar familie sturen

/**
 * officieel  = direct overgenomen uit een officiële statistiek
 * berekend   = afgeleid uit officiële cijfers (aandeel × totaal, totaal − onderdeel)
 * schatting  = eigen schatting of afgeleid uit jaarverslagen, aanbestedingen, pers
 */
export type DataType = "officieel" | "berekend" | "schatting";

export type Lang = "nl" | "en";

export interface Source {
  name: string;
  nameEn?: string;
  publisher: string;
  url?: string;
}

export interface Flow {
  direction: Direction;
  sector: Sector;
  category: Category;
  amount: number;
  year: number;
  dataType: DataType;
  source: string; // sleutel in `sources`
  note?: string;
  /** Goederen die Nederland alleen doorvoert (ingevoerd voor wederuitvoer, of wederuitgevoerd). */
  reexport?: boolean;
  /**
   * Deze regel zit al in het cijfer van de genoemde categorie (zelfde land, richting en jaar;
   * sector bedrijven). Bijvoorbeeld wederuitvoer, of geschatte defensie-aankopen binnen goederen.
   * De app trekt hem daar alleen van af als dat nodig is, zodat niets dubbel telt.
   */
  partOf?: Category;
  /** Deel van dit bedrag dat uiteindelijk bij een bedrijf uit een ander land terechtkomt. */
  via?: Via;
  /** Alleen in weergaveregels: wat er van het oorspronkelijke cijfer is afgetrokken. */
  adjustments?: Adjustment[];
  /** Alleen in weergaveregels: verplaatst vanaf dit land (weergave "uiteindelijke ontvanger"). */
  movedFrom?: string;
}

export interface Adjustment {
  label: string;
  amount: number;
  dataType: DataType;
}

export interface Via {
  country: string; // id van het land van de uiteindelijke ontvanger
  share: number; // 0..1
  dataType: DataType;
  source: string;
  note?: string;
}

export interface Recipient {
  name: string;
  nameEn?: string;
  /** Land waar de ontvanger (moederbedrijf) gevestigd is. */
  country: string;
  /** Land waar de factuur vandaan komt, als dat afwijkt (bv. Ierland). */
  billedFrom?: string;
  category: Category;
  sector: Sector;
  amount: number;
  year: number;
  dataType: DataType;
  source: string;
  note?: string;
}

export interface Country {
  /** ISO 3166-1 numeriek als string met voorloopnullen (bv. "056"); koppelt aan de kaart. "EU" = EU-begroting. */
  id: string;
  name: string;
  /** Naam in de andere taal, voor het zoekveld. */
  altName?: string;
  /** [lengtegraad, breedtegraad] van het eindpunt op de kaart. */
  coords: [number, number];
  flows: Flow[];
}

export interface Dataset {
  meta: {
    title: string;
    unit: string;
    generated: string;
    years: number[];
    /** Jaren waarvoor diensten (CBS 84765NED) beschikbaar zijn. */
    serviceYears: number[];
    population: Record<string, number>;
    /** Bbp in miljoen euro, werkelijke prijzen. */
    gdp: Record<string, number>;
    /** Jaren waarin een reeks van methode wisselt; trendlijnen breken daar af. */
    breaks: { year: number; label: string }[];
    notes: string[];
  };
  netherlands: { id: string; coords: [number, number] };
  sources: Record<string, Source>;
  countries: Country[];
  recipients: Recipient[];
  taxes: TaxRecord[];
  /** Korte, officiële contextpunten over belasting (tekst in de gekozen taal). */
  taxContext: { text: string; source: string }[];
}

/** Omzet, winst en belasting van een concern in één land (context, geen geldstroom). */
export interface TaxRecord {
  company: string;
  /** Land van de vestiging (ISO numeriek). */
  country: string;
  /** Land van het moederbedrijf. */
  parent: string;
  /** Jaar waarin het boekjaar eindigt. */
  year: number;
  period?: string;
  currency: "USD" | "EUR";
  /** Bedragen in miljoenen van `currency`. */
  revenue?: number;
  revenueRelated?: number;
  profit?: number;
  taxPaid?: number;
  taxAccrued?: number;
  employees?: number;
  dataType: DataType;
  source: string;
  note?: string;
}
