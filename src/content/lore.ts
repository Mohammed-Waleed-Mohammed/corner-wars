// 25 — the in-game Codex. Mirrors description/25-world-and-story.md (the canon). Entries are
// grouped by category. An entry with `unlock` stays hidden until the campaign grants that key
// (28 §A progress), so story spoilers stay hidden. DOM-free data.

import { BIOME_IDS } from "../config/biomes";
import { COMMANDER_IDS, COMMANDERS, FACTION_IDS } from "../config/commanders";
import { BIOMES } from "./biomes";
import { CHARACTERS, COMMANDER_INFO, FACTIONS, abilityText, doctrineText, fullName } from "./factions";

export type CodexCategory = "world" | "timeline" | "citadel" | "factions" | "commanders" | "people" | "regions";

export interface CodexEntry {
  id: string;
  category: CodexCategory;
  title: string;
  subtitle?: string;
  body: string[]; // paragraphs
  portrait?: string; // character id → portrait
  faction?: string; // faction id → emblem
  biome?: string; // biome id → swatch
  unlock?: string; // hidden until this key is unlocked by the campaign
}

export const CODEX_CATEGORIES: { id: CodexCategory; label: string }[] = [
  { id: "world", label: "The World" },
  { id: "timeline", label: "Timeline" },
  { id: "citadel", label: "The Citadel" },
  { id: "factions", label: "Factions" },
  { id: "commanders", label: "Commanders" },
  { id: "people", label: "People" },
  { id: "regions", label: "Regions" },
];

export interface TimelineEvent { year: string; title: string; text: string; unlock?: string }

export const TIMELINE: TimelineEvent[] = [
  { year: "2039–2046", title: "The Grid Wars", text: "Energy scarcity and collapsing power grids bring a decade of proxy wars. The world is exhausted and poor." },
  { year: "2047", title: "The Emergence", text: "On 3 March a three-kilometre spire of black glass breaks through the salt flats of the Saltglass Basin. The quake is felt on three continents, and the Hum begins." },
  { year: "2048", title: "The Salt Wars", text: "Three powers race to claim the Basin. After eleven weeks of fighting, a tactical warhead fails to mark the Citadel's surface. Dr Amara Osei publishes the Osei Coupling, the first way to draw power from Resonance." },
  { year: "2049", title: "The Accord of the Basin", text: "The exhausted states found the Concord, a custodial authority with its own army, the Custodian Corps, to hold the Citadel in trust for all humanity. Halcyon Dynamics wins the contract to build the Resonance Grid." },
  { year: "2050–2061", title: "The Bright Decade", text: "The Grid powers the world and famine ends. The Concord builds Basin City, launches the Lance satellites and the Hammer mass-drivers, seeds Waypost caches on every continent, and becomes a world government in all but name." },
  { year: "2058", title: "Patterns in the Hum", text: "Concord xenolinguist Ysolde Rhee argues that Resonance is structured like language. She is quietly reassigned." },
  { year: "2061", title: "The Heart", text: "A deep scan finds a chamber at the Citadel's core with an output millions of times the surface field. First Director Aurelian Kade convenes the Ascension Programme." },
  { year: "2063", title: "The Fall", text: "On 11 November the Ascension Protocol opens the Heart. A Resonance cascade lasts 41 hours, and the Citadel sheds its outer lattice. Twelve great shards arc into the sky and come down across the continents. Basin City is erased, the Grid fails worldwide, and Kade is listed as missing." },
  { year: "2063–2066", title: "The Dimming", text: "Blackouts, famine and migration. Survivors gather around the Fallen, which give warmth, power and gold." },
  { year: "2064", title: "The Remnant", text: "Ilsa Varga gathers the surviving Custodian Corps as the Concord Remnant." },
  { year: "2065", title: "Halcyon Sovereign", text: "Halcyon Dynamics declares the Grid its intellectual property and becomes a corporate power with its own army." },
  { year: "2066", title: "The Ashby Charter", text: "The river towns of the Mirelands and the Verdant Reach found the Free Cantons. In the same year Ysolde Rhee walks out of the Scar, three years after she was declared dead." },
  { year: "2067", title: "The Choir", text: "The Choir of the Hollow Sun forms around the Cantor's teaching of the Reconvergence." },
  { year: "2068", title: "The Spire Wars", text: "The Shard Accords collapse at the Battle of Ashby Ford. Open war for the Fallen begins." },
  { year: "2069", title: "The Penitent", text: "A masked war-leader takes command of the Choir's armies, the Ashen Host." },
  { year: "2070", title: "The Chorus", text: "The Fallen begin to pulse in unison every 41 hours, the same length as the Fall itself." },
  { year: "2071", title: "Present day", text: "The Spire Wars rage on four fronts. The pulses are growing stronger." },
  { year: "11 Nov 2071", title: "Reconvergence", text: "At Ground Zero the Custody Protocol quiets the Chorus. The Heart is sealed, with one man still inside it.", unlock: "finale" },
];

const WORLD: CodexEntry[] = [
  {
    id: "premise", category: "world", title: "The Fall of the Citadel", subtitle: "Eight years after the sky broke",
    body: [
      "In 2047 something older than humanity broke through the salt floor of the Saltglass Basin: a black-glass spire three kilometres high, humming with an energy no instrument could name. For sixteen years it powered the world, and a new order, the Concord, rose to guard it.",
      "In 2063 the Concord tried to open the spire's Heart. The Citadel broke. Twelve great shards fell across the continents, took root, and grew into lesser Citadels. Each one is a fortune in gold and a key to the Concord's orbital weapons. The old order fell with it.",
      "Eight years later four powers fight over the shards. And the shards have begun to sing to one another.",
    ],
  },
  {
    id: "spirewars", category: "world", title: "The Spire Wars", subtitle: "2068 — present",
    body: [
      "The Shard Accords were meant to share the Fallen. They lasted two years. At Ashby Ford, in 2068, a Halcyon survey team, a Canton militia and a Concord patrol met at the same river crossing on the same morning, and nobody fired first, as everybody tells it.",
      "Since then every Fallen has been fought over. Whoever holds a shard's Uplink holds its gold, its warmth and its line to the sky. Nobody holds one for long.",
    ],
  },
];

const CITADEL: CodexEntry[] = [
  {
    id: "citadel", category: "citadel", title: "The Citadels",
    body: [
      "Each of the twelve Fallen regrew within days of landing into a smaller copy of the original spire. Nothing humans have built can scratch one.",
      "A Citadel answers to presence. Hold the ground around its Uplink, unchallenged, for twelve seconds and it accepts your command codes. The Concord called this the Custody Rule. Nobody knows why it works.",
    ],
  },
  {
    id: "resonance", category: "citadel", title: "Resonance",
    body: [
      "The Citadels' energy: purple-white to the eye, felt as a hum in the teeth, and impossible to measure with any instrument except the Uplinks themselves.",
      "Near a Citadel, Resonance speeds up fabrication (holders build 20% faster) and draws gold-bearing ore up through the crust. The richest veins lie nearest the spire, which is why 'Citadel gold' became the currency of the world after the Fall.",
      "Long exposure causes the Hearing: vivid dreams at first, then a constant sense of a voice just below sound. The Choir calls this grace.",
    ],
  },
  {
    id: "uplink", category: "citadel", title: "The Uplink & the sky",
    body: [
      "Resonance charge banks in a held Uplink as Command Energy. The Concord's orbital network still obeys any Uplink. The Hammer's mass-driver slugs answer as an Artillery Strike, the Waypost drop-pods as Reinforcements, and the Lances as the Ion Strike. The same charge can drive a Resonance surge through soldiers' combat rigs (Battle Frenzy) or wake the nanites dormant in Concord equipment (Repair Surge).",
      "That is why every faction wants a Citadel. The shards are the keys to the sky.",
    ],
  },
  {
    id: "heart", category: "citadel", title: "The Heart",
    body: [
      "A chamber at the core of the original Citadel, found by deep scan in 2061. Opening it caused the Fall. Ground Zero, the Heart's crater, is not one of the Fallen. It is the wound they fell from.",
    ],
  },
  {
    id: "chorus", category: "citadel", title: "The Chorus",
    body: [
      "Since 2070 the Fallen have pulsed together every 41 hours, the same length as the Fall itself. The pulses are getting stronger. The Concord calls it a warning, Halcyon a resource, the Cantons a nuisance and the Choir a hymn.",
    ],
  },
  {
    id: "countdown", category: "citadel", title: "The Countdown", unlock: "countdown",
    body: [
      "Juniper, a seventeen-year-old Canton signals operator, decoded the Chorus at Deepfen: each pulse is shorter than the one before. Extrapolated, the cycle reaches zero on 11 November 2071, the eighth anniversary of the Fall. Something at Ground Zero means to open again.",
    ],
  },
  {
    id: "penitent_identity", category: "citadel", title: "The Penitent's Face", unlock: "penitent_identity",
    body: [
      "Under the mask is First Director Aurelian Kade, the man who ordered the Ascension Protocol. He survived the Fall inside the Heart. He does not want to free the Citadel, as the Choir believes. He wants to open it again, properly this time, and become the voice it answers to.",
    ],
  },
];

function factionEntries(): CodexEntry[] {
  return FACTION_IDS.map((id) => {
    const f = FACTIONS[id];
    return {
      id: `faction_${id}`, category: "factions" as const, title: f.name, subtitle: `"${f.motto}"`, faction: id,
      body: [f.description, `They believe: ${f.belief}`, `They want: ${f.want}`],
    };
  });
}

function commanderEntries(): CodexEntry[] {
  return COMMANDER_IDS.map((id) => {
    const c = COMMANDER_INFO[id];
    return {
      id: `cmd_${id}`, category: "commanders" as const, title: fullName(c), subtitle: `${FACTIONS[c.faction].name}${c.born ? ` · born ${c.born}` : ""}`,
      portrait: id, faction: c.faction,
      body: [
        c.bio,
        ...(c.quote ? [`“${c.quote}”`] : []),
        `${c.doctrineName} (passive): ${doctrineText(id)}`,
        `${c.abilityName} (ability): ${abilityText(COMMANDERS[id].ability)}`,
      ],
    };
  });
}

function peopleEntries(): CodexEntry[] {
  return Object.values(CHARACTERS)
    .filter((c) => c.id !== "narrator" && c.id !== "severance")
    .map((c) => ({
      id: `person_${c.id}`, category: "people" as const, title: c.name, subtitle: c.title, portrait: c.id,
      faction: c.faction === "none" ? undefined : c.faction,
      body: [c.bio, ...(c.quote ? [`“${c.quote}”`] : [])],
    }));
}

function regionEntries(): CodexEntry[] {
  return BIOME_IDS.map((id) => {
    const b = BIOMES[id];
    return {
      id: `region_${id}`, category: "regions" as const, title: b.name, subtitle: `${b.region} · ${b.tagline}`, biome: id,
      body: [b.description, `Fallen in this region: ${b.shards.join(", ")}.`],
    };
  });
}

export function codexEntries(): CodexEntry[] {
  return [...WORLD, ...CITADEL, ...factionEntries(), ...commanderEntries(), ...peopleEntries(), ...regionEntries()];
}
