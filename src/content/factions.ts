// 25 §F/§G + 27 §A — faction and commander CONTENT (names, bios, quotes, portrait traits, unit
// names, tooltip text). Tooltip numbers are TEMPLATED from config/commanders.ts so a balance change
// can never leave stale text. DOM-free.

import { ABILITIES, COMMANDERS } from "../config/commanders";
import type { AbilityId, CommanderId, FactionId, UnitType } from "../core/types";

export type EmblemShape = "custodyBar" | "risingSun" | "threeChevrons" | "hollowSun";

export interface FactionInfo {
  id: FactionId;
  name: string; // full
  short: string; // compact label
  color: string; // default player colour (25 §F)
  colorDeep: string; // emblem background / UI accent
  emblem: EmblemShape;
  motto: string;
  belief: string;
  want: string;
  description: string;
}

export const FACTIONS: Record<FactionId, FactionInfo> = {
  concord: {
    id: "concord", name: "The Concord Remnant", short: "Concord", color: "#3b82f6", colorDeep: "#12305e", emblem: "custodyBar",
    motto: "Order is mercy.",
    belief: "Power this great needs a guardian, and the Fall happened because the guardians opened the door.",
    want: "To secure every shard and seal it, so the Fall never happens again.",
    description: "The last of the Custodian Corps, the army the Concord raised to guard the Citadel. Varga led three hundred survivors out of burning Basin City. Eight years on, the Remnant holds fortresses across the Frostmarch, fields the most disciplined army left in the world, and believes that custody, not ownership, is the only safe answer to the shards.",
  },
  halcyon: {
    id: "halcyon", name: "Halcyon Dynamics", short: "Halcyon", color: "#eab308", colorDeep: "#4a3a06", emblem: "risingSun",
    motto: "Progress has a price.",
    belief: "Civilisation runs on energy, and the Resonance Grid fed the world once.",
    want: "To own the shards, rebuild the Grid, and sell the light back to the world.",
    description: "The corporation that built the Resonance Grid. When the Concord fell, Halcyon declared the Grid its intellectual property and became a sovereign power with its own security divisions, its own Uplink codes and the best logistics on Earth. Halcyon does not hate anyone. It simply invoices them.",
  },
  cantons: {
    id: "cantons", name: "The Free Cantons", short: "Cantons", color: "#22c55e", colorDeep: "#0d3a1e", emblem: "threeChevrons",
    motto: "Nobody owns the light.",
    belief: "The shards' power belongs to the people who live beside them, not to empires.",
    want: "To keep each shard free, and its warmth, power and gold local.",
    description: "A federation of river towns, survivor settlements and militias from the Verdant Reach and the Mirelands, bound by the Ashby Charter of 2066. The Cantons elect their captains, mend everything and waste nothing. They have no orbital codes and no factories worth the name, only numbers, nerve and an intimate knowledge of every road and channel they fight on.",
  },
  choir: {
    id: "choir", name: "The Choir of the Hollow Sun", short: "Choir", color: "#ef4444", colorDeep: "#4a0d14", emblem: "hollowSun",
    motto: "It was never broken. It was born.",
    belief: "The Citadel is alive, and the Fall was its birth-cry.",
    want: "The Reconvergence: to return the Fallen to the Heart, so the Citadel can be born whole.",
    description: "A faith born in the Scar among survivors who hear the Song. The Cantor teaches that the Citadel is alive and the Fall was a birth. Her pilgrims carry stolen Concord hardware into battle singing. Their armies, the Ashen Host, fight under a masked war-leader called the Penitent.",
  },
};

// ── procedural portrait traits (render/portraits.ts draws these until real art exists) ─────────────
export type HairStyle = "bun" | "short" | "crop" | "buzz" | "long" | "braids" | "bald" | "hood" | "none";
export type Headwear = "none" | "beret" | "cap" | "hood" | "mask" | "headset" | "veil";
export type FaceMark = "none" | "scar" | "glasses" | "beard" | "stubble" | "crystal" | "freckles";
export interface PortraitSpec {
  skin: string;
  hair: string; // colour
  hairStyle: HairStyle;
  headwear: Headwear;
  mark: FaceMark;
  uniform: string; // collar/shoulder colour
  trim: string; // insignia colour
  eyes: string;
  age: "young" | "mid" | "old";
  bg: string; // backdrop colour
}

export interface CharacterInfo {
  id: string;
  name: string;
  title: string; // rank / role
  faction: FactionId | "none";
  born?: number;
  bio: string;
  quote?: string;
  portrait: PortraitSpec;
}

export interface CommanderInfo extends CharacterInfo {
  id: CommanderId;
  faction: FactionId;
  short: string; // name on HUD cards
  doctrineName: string;
  abilityName: string;
  abilityIcon: string; // iconRenderer glyph key (or emoji fallback)
  playstyle: string; // one line for the picker
}

export const COMMANDER_INFO: Record<CommanderId, CommanderInfo> = {
  varga: {
    id: "varga", faction: "concord", name: "Ilsa Varga", short: "Varga", title: "Marshal", born: 2013,
    bio: "A Custodian captain at the Basin on the night of the Fall. Varga held the perimeter while the Protocol ran, then carried the Concord flag out of the burning city with three hundred survivors. Stern, precise and incorruptible, she treats custody of the shards as penance for the order she obeyed.",
    quote: "We held it once. We will hold it again — and this time we will not open the door.",
    doctrineName: "Bastion Doctrine", abilityName: "Aegis Field", abilityIcon: "🛡",
    playstyle: "Fortress builder. Tough buildings, harder defenses, a dome that blunts any assault.",
    portrait: { skin: "#d9b49a", hair: "#9a9a9a", hairStyle: "bun", headwear: "beret", mark: "scar", uniform: "#1e3a6e", trim: "#dbe6ff", eyes: "#4a6a8a", age: "old", bg: "#16243e" },
  },
  haddad: {
    id: "haddad", faction: "concord", name: "Yusuf Haddad", short: "Haddad", title: "Captain", born: 2040,
    bio: "A cadet in the Hammer batteries on the night of the Fall, now Varga's protégé and the Remnant's finest artillery officer. He believes in what the Concord was meant to be more than what it was, and he has begun to wonder whether sealing the shards is right.",
    quote: "Give me coordinates and ninety seconds. The sky will do the rest.",
    doctrineName: "Fire Mission", abilityName: "Hammerfall", abilityIcon: "☄",
    playstyle: "Siege specialist. Longer, cheaper artillery and an orbital barrage on demand.",
    portrait: { skin: "#b07e5a", hair: "#1e1a18", hairStyle: "crop", headwear: "headset", mark: "stubble", uniform: "#1e3a6e", trim: "#f5c518", eyes: "#3a2a1e", age: "young", bg: "#16243e" },
  },
  marchetti: {
    id: "marchetti", faction: "halcyon", name: "Celeste Marchetti", short: "Marchetti", title: "Director", born: 2019,
    bio: "Halcyon's Chief Operating Director: impeccable, pragmatic, and never cruel when cruelty is unprofitable. She genuinely believes that rebuilding the Grid will save more lives than any army, and she thinks in quarters and in centuries.",
    quote: "Everything has a price, Marshal. I'm simply the only one who reads the invoice.",
    doctrineName: "Dividends", abilityName: "Supply Drop", abilityIcon: "💰",
    playstyle: "Economy. Faster mining, faster research and a cash injection on call.",
    portrait: { skin: "#e8c8b0", hair: "#2a1a14", hairStyle: "short", headwear: "none", mark: "none", uniform: "#2a2a30", trim: "#eab308", eyes: "#5a4a2a", age: "mid", bg: "#2a2208" },
  },
  achterberg: {
    id: "achterberg", faction: "halcyon", name: "Imani Achterberg", short: "Achterberg", title: "Doctor", born: 2027,
    bio: "Head of Halcyon's skunkworks, Project Prism, which builds weapons that 'tune' Resonance. Brilliant and impatient, she treats ethics as a variable until it becomes data. She was Dr Osei's last doctoral student, and neither of them talks about it.",
    quote: "Fear is just a hypothesis nobody has tested.",
    doctrineName: "Prototype Program", abilityName: "Prism Pulse", abilityIcon: "🔷",
    playstyle: "Technology. Tougher vehicles, cheap research and a field that cripples enemy armies.",
    portrait: { skin: "#6e4a34", hair: "#14100e", hairStyle: "braids", headwear: "none", mark: "glasses", uniform: "#e8e8ec", trim: "#eab308", eyes: "#2a1e14", age: "mid", bg: "#2a2208" },
  },
  okafor: {
    id: "okafor", faction: "cantons", name: "Dara Okafor", short: "Okafor", title: "Captain", born: 2042,
    bio: "Raised on river barges in the Dimming, a medicine smuggler at sixteen, and now the elected war-captain of the Free Cantons. Quick, warm and funny, she will do anything for her people and is suspicious of anyone who says 'for the greater good'.",
    quote: "We don't need your Citadel. We need what it does for us — light, heat, gold. We'll keep it, thanks.",
    doctrineName: "Militia Levy", abilityName: "Rally the Cantons", abilityIcon: "📯",
    playstyle: "Numbers. Cheap, fast infantry and an army-wide surge of speed and fury.",
    portrait: { skin: "#5a3a26", hair: "#0e0a08", hairStyle: "short", headwear: "cap", mark: "freckles", uniform: "#3a4a2a", trim: "#22c55e", eyes: "#2a1a10", age: "young", bg: "#0e2a16" },
  },
  lindqvist: {
    id: "lindqvist", faction: "cantons", name: "Ezra Lindqvist", short: "Lindqvist", title: "\"Old Wolf\"", born: 2004,
    bio: "A Concord combat engineer who quit the Corps in disgust in 2060 and walked into Canton country. He built half their roads and all of their ambushes. He was Aurelian Kade's sapper in the Salt Wars, and nobody alive knows Kade's mind better, or likes it less.",
    quote: "Every road is a trap if you build it right.",
    doctrineName: "Know the Land", abilityName: "Ghost Roads", abilityIcon: "🌫",
    playstyle: "Terrain and ambush. Units that cross rough ground freely and vanish on command.",
    portrait: { skin: "#d8b49c", hair: "#d8d4cc", hairStyle: "short", headwear: "none", mark: "beard", uniform: "#4a3a26", trim: "#22c55e", eyes: "#6a8aa0", age: "old", bg: "#0e2a16" },
  },
  cantor: {
    id: "cantor", faction: "choir", name: "The Cantor", short: "Cantor", title: "Voice of the Hollow Sun", born: 2022,
    bio: "Ysolde Rhee was a Concord xenolinguist inside the Citadel when the Heart opened. Three years after she was declared dead she walked out of Ground Zero, unharmed and hearing the Song. Serene, gentle and absolutely certain, she believes the Reconvergence is a birth, not a weapon.",
    quote: "Listen. It is singing your name. It always was.",
    doctrineName: "Hymn of the Hollow Sun", abilityName: "Sundering Hymn", abilityIcon: "🎶",
    playstyle: "Resonance. Seize Citadels fast, bank energy, and unmake armies with a delayed hymn.",
    portrait: { skin: "#e6ccbc", hair: "#e8e0f0", hairStyle: "long", headwear: "veil", mark: "crystal", uniform: "#3a0c14", trim: "#c084fc", eyes: "#b490ff", age: "mid", bg: "#2a0a12" },
  },
  penitent: {
    id: "penitent", faction: "choir", name: "The Penitent", short: "Penitent", title: "Warlord of the Ashen Host",
    bio: "A masked war-leader who never raises his voice above a whisper and commands the Ashen Host with cold, Concord-trained precision. Nobody has seen his face. Some say he was a Custodian. Some say he was something worse.",
    quote: "I opened the door once. I know what is on the other side. You don't.",
    doctrineName: "Ashen Host", abilityName: "Ashstorm", abilityIcon: "🌪",
    playstyle: "Aggression. Harder-hitting, glass-edged troops hidden inside a storm that blinds the enemy.",
    portrait: { skin: "#8a8078", hair: "#1a1414", hairStyle: "hood", headwear: "mask", mark: "none", uniform: "#1a1416", trim: "#ef4444", eyes: "#ff5040", age: "old", bg: "#2a0a12" },
  },
};

/** 25 §G supporting cast — dialogue speakers + Codex entries. */
export const CHARACTERS: Record<string, CharacterInfo> = {
  osei: {
    id: "osei", name: "Dr Amara Osei", title: "Concord Science Adviser", faction: "concord", born: 1997,
    bio: "The physicist who found a way to draw power from Resonance (the Osei Coupling, 2048). She built the Bright Decade and watched it end. Frail, sharp and unafraid, she is the conscience of the Remnant and the architect of the Custody Protocol.",
    quote: "We didn't understand it then. We don't understand it now. The difference is that now we know it.",
    portrait: { skin: "#4a2e20", hair: "#e8e4dc", hairStyle: "crop", headwear: "none", mark: "glasses", uniform: "#d8dce4", trim: "#3b82f6", eyes: "#2a1a10", age: "old", bg: "#16243e" },
  },
  ruiz: {
    id: "ruiz", name: "Sgt. Tomás Ruiz", title: "Varga's Sergeant", faction: "concord",
    bio: "Varga's NCO since the night of the Fall. Steady, dry and loyal, he keeps the Remnant's soldiers alive and its Marshal honest.",
    quote: "Ma'am, with respect — that's a terrible idea. When do we start?",
    portrait: { skin: "#c49070", hair: "#2a2420", hairStyle: "buzz", headwear: "none", mark: "beard", uniform: "#3a4a5a", trim: "#dbe6ff", eyes: "#3a2a1a", age: "mid", bg: "#16243e" },
  },
  meridian: {
    id: "meridian", name: "MERIDIAN", title: "Halcyon Command Intelligence", faction: "halcyon",
    bio: "Halcyon's corporate command intelligence. Polite and precise, it speaks in risk percentages and quarterly projections. Halcyon insists it is a tool, and MERIDIAN has never disagreed.",
    quote: "Probability of acceptable outcome: 71.4 percent. Recommend proceeding.",
    portrait: { skin: "#eab308", hair: "#eab308", hairStyle: "none", headwear: "none", mark: "none", uniform: "#1a1a20", trim: "#eab308", eyes: "#fff2b0", age: "mid", bg: "#0a0a0c" },
  },
  juniper: {
    id: "juniper", name: "Juniper", title: "Canton Signals Operator", faction: "cantons", born: 2054,
    bio: "Seventeen years old, self-taught, and the only person in the Cantons who can read Resonance pulses on a radio built from salvage. She is the first to realise that the Chorus is counting.",
    quote: "It's not noise. It's a clock. Somebody please tell me why the sky has a clock.",
    portrait: { skin: "#c8a080", hair: "#6a3a1e", hairStyle: "braids", headwear: "headset", mark: "freckles", uniform: "#4a5a3a", trim: "#22c55e", eyes: "#4a6a3a", age: "young", bg: "#0e2a16" },
  },
  vex: {
    id: "vex", name: "Deacon Vex", title: "Field Commander, Ashen Host", faction: "choir",
    bio: "The Penitent's voice on the battlefield: fervent, cruel and unafraid to die. He has burned three Canton towns 'to let the Song be heard'.",
    quote: "Your walls are paper. The Song is fire.",
    portrait: { skin: "#a87a5a", hair: "#2a1a14", hairStyle: "bald", headwear: "none", mark: "scar", uniform: "#3a0c14", trim: "#ef4444", eyes: "#4a1a10", age: "mid", bg: "#2a0a12" },
  },
  kade: {
    id: "kade", name: "Aurelian Kade", title: "First Director of the Concord", faction: "concord", born: 2001,
    bio: "Charismatic, visionary First Director of the Concord from 2056. He was certain the Heart would end scarcity for ever, and he gave the order that opened it. Listed missing after the Fall.",
    quote: "History will not ask whether we were afraid. It will ask whether we were brave.",
    portrait: { skin: "#d8bca4", hair: "#3a3430", hairStyle: "short", headwear: "none", mark: "none", uniform: "#f0f2f6", trim: "#f5c518", eyes: "#3a5a7a", age: "mid", bg: "#1e2a40" },
  },
  severance: {
    id: "severance", name: "Severance Leader", title: "Insurgent Commander", faction: "none",
    bio: "A commander of the Severance, the insurgency that tried to stop the Ascension Protocol by force on the night of the Fall. Wrong about the method, right about the danger.",
    quote: "You don't open a door you can't close!",
    portrait: { skin: "#c49a7a", hair: "#3a2a1e", hairStyle: "short", headwear: "hood", mark: "stubble", uniform: "#5a4a3a", trim: "#d0a060", eyes: "#3a2a1a", age: "mid", bg: "#2a2014" },
  },
  narrator: {
    id: "narrator", name: "", title: "", faction: "none",
    bio: "",
    portrait: { skin: "#000", hair: "#000", hairStyle: "none", headwear: "none", mark: "none", uniform: "#000", trim: "#000", eyes: "#000", age: "mid", bg: "#000" },
  },
};

/** Any speaker id → its info (commanders + supporting cast). */
export function characterInfo(id: string): CharacterInfo | undefined {
  return (COMMANDER_INFO as Record<string, CharacterInfo>)[id] ?? CHARACTERS[id];
}

/** Display name with title, e.g. "Marshal Ilsa Varga". */
export function fullName(c: CharacterInfo): string {
  if (!c.title || c.title.startsWith("Voice") || c.title.startsWith("Warlord") || c.name.startsWith("The ")) return c.name;
  if (c.title.startsWith("\"")) return `${c.name.split(" ")[0]} ${c.title} ${c.name.split(" ").slice(1).join(" ")}`;
  if (["Marshal", "Captain", "Director", "Doctor"].includes(c.title)) return `${c.title === "Doctor" ? "Dr" : c.title} ${c.name}`;
  return c.name;
}

// ── 27 §A unit names ───────────────────────────────────────────────────────────────────────────
export const UNIT_NAMES: Record<FactionId, Record<UnitType, string>> = {
  concord: { worker: "Engineer", rifleman: "Custodian", grenadier: "Breacher", rocket: "Lancer", scoutBuggy: "Outrider", tank: "Bulwark", heavyTank: "Paladin", artillery: "Hammer", medic: "Corpsman" },
  halcyon: { worker: "Technician", rifleman: "Contractor", grenadier: "Shockman", rocket: "Javelin", scoutBuggy: "Skiff", tank: "Atlas", heavyTank: "Colossus", artillery: "Meridian Battery", medic: "Medtech" },
  cantons: { worker: "Hand", rifleman: "Militia", grenadier: "Bombardier", rocket: "Rocketeer", scoutBuggy: "Runner", tank: "Ironside", heavyTank: "Mammoth", artillery: "Long Tom", medic: "Mender" },
  choir: { worker: "Acolyte", rifleman: "Zealot", grenadier: "Censer", rocket: "Seraph", scoutBuggy: "Pilgrim", tank: "Reliquary", heavyTank: "Cathedral", artillery: "Requiem", medic: "Anointer" },
};

// ── 27 §B/§C tooltip text, templated from the numbers ────────────────────────────────────────
const pct = (m: number): string => `${Math.round(Math.abs(m - 1) * 100)}%`;

export function doctrineText(id: CommanderId): string {
  const d = COMMANDERS[id].doctrine;
  const parts: string[] = [];
  if (d.buildingHpMult) parts.push(`Buildings +${pct(d.buildingHpMult)} max HP`);
  if (d.defenseDamageMult) parts.push(`defenses +${pct(d.defenseDamageMult)} damage`);
  if (d.artilleryRangeBonus) parts.push(`Artillery +${d.artilleryRangeBonus} range and −${pct(d.artilleryCostMult ?? 1)} cost`);
  if (d.missileTowerRangeBonus) parts.push(`Missile Towers +${d.missileTowerRangeBonus} range`);
  if (d.miningMult) parts.push(`Workers mine +${pct(d.miningMult)}`);
  if (d.researchTimeMult) parts.push(`research −${pct(d.researchTimeMult)} time`);
  if (d.vehicleHpMult) parts.push(`vehicles +${pct(d.vehicleHpMult)} max HP`);
  if (d.researchCostMult) parts.push(`research −${pct(d.researchCostMult)} cost`);
  if (d.infantryCostMult) parts.push(`infantry −${pct(d.infantryCostMult)} cost`);
  if (d.infantryTimeMult) parts.push(`infantry trains −${pct(d.infantryTimeMult)} faster`);
  if (d.roughTerrainPenaltyMult) parts.push(`forest, hill and shallows slow your units only half as much`);
  if (d.forestSpotRange) parts.push(`your units in forests are spotted only within ${d.forestSpotRange} tiles`);
  if (d.captureSpeedMult) parts.push(`capture Citadels ${Math.round((1 - 1 / d.captureSpeedMult) * 100)}% faster`);
  if (d.energyMult) parts.push(`Command Energy +${pct(d.energyMult)}`);
  if (d.unitDamageMult) parts.push(`units +${pct(d.unitDamageMult)} damage`);
  if (d.unitHpMult) parts.push(`units −${pct(d.unitHpMult)} max HP`);
  const s = parts.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

export function abilityText(id: AbilityId): string {
  const a = ABILITIES[id];
  switch (id) {
    case "aegis": return `Raise a dome (radius ${a.radius}) for ${a.duration} s: your units and buildings inside take −${pct(a.damageTakenMult!)} damage.`;
    case "hammerfall": return `After ${a.delay} s, ${a.impacts!.length} orbital impacts land around the target, each dealing ${a.damage} damage in radius ${a.radius} (buildings take half).`;
    case "supplyDrop": return `Gain ${a.gold} gold now, and your Workers mine +${pct(a.buffMiningMult!)} for ${a.duration} s.`;
    case "prism": return `A Prism field (radius ${a.radius}) for ${a.duration} s: enemy units inside move −${pct(a.enemySpeedMult!)} and enemies inside deal −${pct(a.enemyDamageMult!)} damage.`;
    case "rally": return `All your units gain +${pct(a.buffSpeedMult!)} speed and +${pct(a.buffDamageMult!)} damage for ${a.duration} s.`;
    case "ghostRoads": return `For ${a.duration} s your units inside the area (radius ${a.radius}) are hidden from enemies more than ${a.cloakSpotRange} tiles away.`;
    case "hymn": return `A visible ring: after ${a.delay} s it deals ${a.damage} damage in radius ${a.radius} (buildings take half).`;
    case "ashstorm": return `An ash cloud (radius ${a.radius}) for ${a.duration} s: enemies inside deal −${pct(a.enemyDamageMult!)} damage and move −${pct(a.enemySpeedMult!)}; your units inside are hidden.`;
  }
}

export function abilityCooldownText(id: AbilityId): string {
  const a = ABILITIES[id];
  return `Cooldown ${a.cooldown} s · ready at ${Math.floor(a.initial / 60)}:${String(a.initial % 60).padStart(2, "0")}`;
}
