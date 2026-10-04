// Korte "verhalen": één klik zet de kaart op een vast jaar, land en filter.
// De tekst stelt een vraag; het antwoord staat in de (echte) cijfers op de kaart.
import type { ViewState } from "./urlState";
import type { Category, Lang } from "./types";

export interface Story {
  id: string;
  title: Record<Lang, string>;
  text: Record<Lang, string>;
  /** Wordt over de standaardinstellingen gelegd. */
  state: Partial<Omit<ViewState, "lang" | "story">>;
  /** Alleen tonen als er data is voor deze categorie. */
  needs?: Category;
}

export const STORIES: Story[] = [
  {
    id: "energiecrisis",
    title: { nl: "De energiecrisis van 2022", en: "The 2022 energy crisis" },
    text: {
      nl: "Energie-invoer in 2022 vergeleken met 2021. Welke landen leverden de duurdere energie, en hoeveel meer betaalde Nederland?",
      en: "Energy imports in 2022 compared with 2021. Which countries supplied the more expensive energy, and how much more did the Netherlands pay?",
    },
    state: { year: 2022, compare: 2021, category: "energie" },
  },
  {
    id: "rusland",
    title: { nl: "Russische sancties", en: "Sanctions on Russia" },
    text: {
      nl: "De handel met Rusland in 2023, vergeleken met 2021, het jaar voor de inval in Oekraïne. Speel de jaren af om het verloop te zien.",
      en: "Trade with Russia in 2023, compared with 2021, the year before the invasion of Ukraine. Play the years to see how it developed.",
    },
    state: { year: 2023, compare: 2021, country: "643" },
  },
  {
    id: "bigtech",
    title: { nl: "Wat betalen we aan Big Tech?", en: "What do we pay Big Tech?" },
    text: {
      nl: "IT-diensten toegerekend aan het land van het moederbedrijf. Veel van wat via Ierland wordt gefactureerd, komt terecht bij Amerikaanse techbedrijven.",
      en: "IT services attributed to the parent company's country. Much of what is billed from Ireland ends up with American tech companies.",
    },
    state: { year: 2024, category: "it", ultimate: true, country: "840" },
  },
  {
    id: "doorvoer",
    title: { nl: "Rotterdam als doorvoerhaven", en: "Rotterdam as a transit port" },
    text: {
      nl: "De handel met China zonder wederuitvoer. Hoeveel van wat Nederland uit China invoert, gebruikt het zelf?",
      en: "Trade with China without re-exports. How much of what the Netherlands imports from China does it actually use?",
    },
    state: { year: 2024, reexport: false, country: "156" },
  },
  {
    id: "hulp",
    title: { nl: "Ontwikkelingshulp", en: "Development aid" },
    text: {
      nl: "Naar welke landen gaat Nederlandse hulp die aan een land is toe te wijzen? Vergeleken met tien jaar eerder.",
      en: "Which countries receive Dutch aid that can be attributed to a country? Compared with ten years earlier.",
    },
    state: { year: 2024, compare: 2014, category: "hulp" },
    needs: "hulp",
  },
  {
    id: "eu",
    title: { nl: "Nederland en de EU-begroting", en: "The Netherlands and the EU budget" },
    text: {
      nl: "Hoeveel draagt Nederland af aan de EU-begroting, en hoeveel geeft de EU in Nederland uit?",
      en: "How much does the Netherlands pay into the EU budget, and how much does the EU spend in the Netherlands?",
    },
    state: { category: "eu", country: "EU" },
    needs: "eu",
  },
  {
    id: "vakantie",
    title: { nl: "Waar gaat het vakantiegeld heen?", en: "Where does holiday money go?" },
    text: {
      nl: "Uitgaven van Nederlanders op reis in het buitenland, per land.",
      en: "Spending by Dutch residents travelling abroad, by country.",
    },
    state: { year: 2024, sector: "consumenten", category: "diensten" },
  },
  {
    id: "overmakingen",
    title: { nl: "Geld naar familie", en: "Money sent to family" },
    text: {
      nl: "Overmakingen van huishoudens in Nederland naar familie in het buitenland, volgens de betalingsbalans.",
      en: "Transfers from households in the Netherlands to family abroad, according to the balance of payments.",
    },
    state: { year: 2024, category: "overmakingen" },
    needs: "overmakingen",
  },
];
