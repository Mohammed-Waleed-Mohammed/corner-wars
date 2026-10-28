// 28 — the campaign "The Spire Wars": twelve missions as DATA (map, biome, seats, objectives,
// scripted events, briefing/dialogue/debrief text). The DOM-free director (engine/campaign/
// director.ts) runs objectives + events inside the sim step; the UI (ui/campaign/*) renders
// briefings, the tracker, the dialogue bar and debriefs. Structure + numbers mirror
// description/28-campaign.md; the dialogue text lives only here.

import type {
  AIPersonality, BiomeId, BuildingType, CommanderId, PlayerId, ResearchKey, StoryLine, UnitType,
} from "../core/types";

export type CampaignDifficulty = "story" | "commander" | "veteran";

export interface MissionSeat {
  slot: 1 | 2 | 3;
  commander: CommanderId;
  difficulty: "easy" | "medium" | "hard";
  personality?: AIPersonality;
  name?: string; // display-name override (e.g. "Deacon Vex")
}

export type ObjectiveDef = { id: string; primary: boolean; label: string; hidden?: boolean; by?: number } & (
  | { type: "capture" }
  | { type: "hold"; seconds: number }
  | { type: "eliminate"; players: PlayerId[] }
  | { type: "destroy"; owner: PlayerId; building: BuildingType; count: number }
  | { type: "protect"; tag: string }
  | { type: "survive"; seconds: number } // seconds since the objective became active
  | { type: "mine"; gold: number }
  | { type: "controlAt"; seconds: number } // absolute match clock
  | { type: "lossesUnder"; count: number }
);

export type Trigger =
  | { type: "start" }
  | { type: "at"; t: number }
  | { type: "every"; t: number; from?: number; until?: number }
  | { type: "objective"; id: string; status: "done" | "failed" }
  | { type: "captured"; player: PlayerId }
  | { type: "eliminated"; player: PlayerId };

export interface UnitBatch { type: UnitType; n: number }

export type Action =
  | { type: "say"; lines: StoryLine[] }
  | { type: "spawn"; player: PlayerId; units: UnitBatch[]; near: "base" | "citadel"; attack?: "base0" | "citadel" }
  | { type: "gold"; player: PlayerId; amount: number }
  | { type: "shardfall"; seconds: number; rate: number; r: number; damage: number; within: number }
  | { type: "pulse"; damage: number; within: number }
  | { type: "reveal"; objective: string }
  | { type: "unlock"; codex: string }
  | { type: "victory" }
  | { type: "defeat" };

export interface MissionEvent {
  when: Trigger;
  delay?: number; // seconds after the trigger first fires (one-shot triggers only)
  do: Action[];
}

export interface MissionExtra {
  player: PlayerId;
  units?: UnitBatch[];
  buildings?: { type: BuildingType; tag?: string; dx: number; dy: number }[]; // offset from the start yard's top-left
  research?: ResearchKey[];
}

export interface MissionDef {
  id: string;
  number: number; // 1..12
  act: 0 | 1 | 2 | 3;
  title: string;
  date: string;
  place: string;
  mapId: string;
  biome: BiomeId;
  commander: CommanderId;
  playerName?: string; // name override for the player (prologue: "Captain Ilsa Varga")
  seats: MissionSeat[];
  startGold: number;
  extras?: MissionExtra[];
  briefing: { speakers: string[]; text: string[] };
  objectives: ObjectiveDef[];
  events: MissionEvent[];
  debrief: { victory: string[]; defeat: string[] };
  unlocks?: string[]; // codex keys granted on victory
}

export const ACTS: { act: 0 | 1 | 2 | 3; name: string; subtitle: string; faction: string }[] = [
  { act: 0, name: "Prologue", subtitle: "The Night of the Fall · 2063", faction: "concord" },
  { act: 1, name: "Act I — Embers", subtitle: "The Concord Remnant · 2071", faction: "concord" },
  { act: 2, name: "Act II — Currents", subtitle: "The Free Cantons · 2071", faction: "cantons" },
  { act: 3, name: "Act III — Chorus", subtitle: "Halcyon · the Choir · the Heart", faction: "choir" },
];

const L = (speaker: string, text: string): StoryLine => ({ speaker, text });
const say = (...lines: StoryLine[]): Action => ({ type: "say", lines });

export const MISSIONS: MissionDef[] = [
  // ── Prologue ─────────────────────────────────────────────────────────────────────────────────
  {
    id: "custody", number: 1, act: 0, title: "Custody",
    date: "11 November 2063", place: "Basin City, outer perimeter · Saltglass",
    mapId: "duel", biome: "saltglass", commander: "varga", playerName: "Captain Ilsa Varga",
    seats: [{ slot: 1, commander: "okafor", difficulty: "easy", personality: "rusher", name: "Severance Insurgents" }],
    startGold: 5000,
    extras: [{ player: 0, units: [{ type: "rifleman", n: 4 }, { type: "rocket", n: 2 }, { type: "tank", n: 1 }] }],
    briefing: {
      speakers: ["kade", "varga"],
      text: [
        "Tonight First Director Kade opens the Heart. Your company holds the eastern Uplink ring while the Ascension Protocol runs.",
        "Severance insurgents have breached the salt fences. They will try to seize the Uplink and stop the Protocol by force.",
        "Secure the Uplink and hold it until the Protocol completes. Nobody touches that spire tonight but the Concord.",
      ],
    },
    objectives: [
      { id: "secure", primary: true, label: "Secure the Uplink", type: "capture" },
      { id: "hold", primary: true, label: "Hold the Uplink while the Protocol runs", type: "hold", seconds: 90, hidden: true },
      { id: "fall", primary: true, label: "Survive the Fall", type: "survive", seconds: 180, hidden: true },
      { id: "losses", primary: false, label: "Lose no more than 15 units", type: "lossesUnder", count: 15 },
    ],
    events: [
      { when: { type: "start" }, do: [say(
        L("kade", "All stations, this is the First Director. The Protocol begins at 2300. History is watching. Let's not keep it waiting."),
        L("varga", "Eastern ring, by the numbers. Ruiz, get those rifles on the fence line."),
        L("ruiz", "Ma'am. Severance colours on the dunes — they brought tanks this time."),
      )] },
      { when: { type: "at", t: 20 }, do: [say(L("severance", "Concord! You don't open a door you can't close! Stand down or we'll shut it for you!"))] },
      { when: { type: "objective", id: "secure", status: "done" }, do: [
        say(L("varga", "Uplink secured. Eastern ring reports green."), L("kade", "Well done, Captain. Hold it. Ninety seconds and the world changes.")),
        { type: "reveal", objective: "hold" },
      ] },
      { when: { type: "objective", id: "hold", status: "done" }, do: [
        say(
          L("osei", "Captain — the Heart's output is climbing past every model. Tell Kade to stop. Tell him now!"),
          L("kade", "Noted, Doctor. Continue the Protocol."),
          L("narrator", "11 November 2063, 23:41. The Heart opens."),
          L("varga", "Ruiz — what is that light?"),
          L("ruiz", "It's the spire, ma'am. It's… it's coming apart."),
        ),
        { type: "shardfall", seconds: 180, rate: 1.2, r: 2, damage: 70, within: 16 },
        { type: "reveal", objective: "fall" },
      ] },
      { when: { type: "objective", id: "hold", status: "done" }, delay: 30, do: [say(L("osei", "It's throwing shards into the sky. Hundreds of kilometres. Varga, get your people out of the Basin!"))] },
      { when: { type: "objective", id: "hold", status: "done" }, delay: 95, do: [say(L("varga", "All Concord units, this is Captain Varga. Fall back on the extraction column. Carry who you can."))] },
      { when: { type: "objective", id: "fall", status: "done" }, do: [say(L("narrator", "Forty-one hours later the Hum stopped. Twelve lights had fallen across the world."))] },
    ],
    debrief: {
      victory: [
        "Captain Ilsa Varga led three hundred survivors out of Basin City as the Citadel broke apart above them. She carried the Concord flag the whole way.",
        "The First Director's command bunker was never found. Neither was Aurelian Kade.",
      ],
      defeat: ["The eastern ring fell. In the confusion of the Fall, nobody lived to remember who held the Uplink at the end."],
    },
  },

  // ── Act I — Embers ───────────────────────────────────────────────────────────────────────────
  {
    id: "hold_varga", number: 2, act: 1, title: "Hold Varga",
    date: "14 February 2071", place: "Coldwater shard · the Frostmarch",
    mapId: "bastion", biome: "frostmarch", commander: "varga",
    seats: [
      { slot: 1, commander: "penitent", difficulty: "medium", personality: "rusher", name: "Deacon Vex" },
      { slot: 2, commander: "marchetti", difficulty: "easy", personality: "turtle", name: "Halcyon Survey" },
    ],
    startGold: 10000,
    briefing: {
      speakers: ["varga", "ruiz"],
      text: [
        "Eight years after the Fall, the Remnant holds the north. Two nights ago the Ashen Host crossed the ice and dug a war camp beside Coldwater, under a field commander called Deacon Vex.",
        "Halcyon has a survey team on the far ridge, watching and waiting to bid.",
        "Burn out the Choir camp. If you can, take Coldwater's Uplink back into custody.",
      ],
    },
    objectives: [
      { id: "camp", primary: true, label: "Destroy the Ashen Host war camp", type: "eliminate", players: [1] },
      { id: "uplink", primary: false, label: "Take Coldwater's Uplink into custody", type: "capture" },
    ],
    events: [
      { when: { type: "start" }, do: [say(
        L("varga", "Eight years. They still sing when they march."),
        L("ruiz", "Camp's on the north-east shelf, ma'am. Walls of ice and stolen Concord plate."),
      )] },
      { when: { type: "at", t: 60 }, do: [say(
        L("vex", "Marshal Varga. The Song told us you would come. It also told us how you would die."),
        L("varga", "Then it should have told you to leave."),
      )] },
      { when: { type: "at", t: 240 }, do: [say(
        L("marchetti", "Marshal, Celeste Marchetti, Halcyon Dynamics. Coldwater is a liability for you and an asset for us. Let us purchase custody — at a fair valuation."),
        L("varga", "The shards aren't for sale, Director."),
        L("marchetti", "Everything is, Marshal. You simply haven't heard the right number."),
      )] },
      { when: { type: "captured", player: 0 }, do: [say(
        L("ruiz", "Uplink's ours. Custody established."),
        L("osei", "Coldwater is pulsing in rhythm with the others. Forty-one hours, to the second. I don't like it, Ilsa."),
      )] },
      { when: { type: "eliminated", player: 1 }, do: [say(
        L("ruiz", "Camp's burning. Ma'am — you need to see what they were digging for."),
        L("varga", "Excavation charts. Ground Zero… they're digging into the Heart's crater."),
      )] },
    ],
    debrief: {
      victory: [
        "The Ashen Host fled across the ice. In Vex's tent the Remnant found survey charts of Ground Zero, mapping a way down into the Heart's crater. Marshal Varga sent them south to Dr Osei under triple seal.",
        "'They're not worshipping it,' Osei wrote back. 'They're excavating it.'",
      ],
      defeat: ["Coldwater fell to the Choir. The Remnant pulled back to Hold Varga and counted its dead."],
    },
  },
  {
    id: "hammer_anvil", number: 3, act: 1, title: "Hammer and Anvil",
    date: "2 April 2071", place: "Kessel Flats · Saltglass",
    mapId: "divide", biome: "saltglass", commander: "haddad",
    seats: [{ slot: 1, commander: "achterberg", difficulty: "medium", personality: "techer", name: "Halcyon Kessel Division" }],
    startGold: 10000,
    extras: [{ player: 0, units: [{ type: "artillery", n: 2 }], research: ["siegeDoctrine"] }],
    briefing: {
      speakers: ["haddad", "varga"],
      text: [
        "Halcyon has fenced the Kessel shard and is pumping its gold south by the trainload. The Marshal wants Kessel in custody before Halcyon's convoy doubles the garrison.",
        "You command the Remnant's best artillery. The ridge has two chokepoints, and Halcyon is dug in on the far side.",
        "Break Halcyon's Kessel division. Seize the Uplink early if you can.",
      ],
    },
    objectives: [
      { id: "kessel", primary: true, label: "Break Halcyon's Kessel division", type: "eliminate", players: [1] },
      { id: "early", primary: false, label: "Take the Uplink before 10:00", type: "capture", by: 600 },
    ],
    events: [
      { when: { type: "start" }, do: [say(
        L("haddad", "Batteries, this is Hammer Actual. Find me those chokepoints."),
        L("varga", "Captain. Gently. Halcyon pays its mercenaries well and buries them cheaply."),
      )] },
      { when: { type: "at", t: 300 }, do: [
        say(L("meridian", "Convoy KESSEL-7 arriving. Three Atlas units allocated. Probability of holding Kessel rises to sixty-eight percent.")),
        { type: "spawn", player: 1, units: [{ type: "tank", n: 3 }], near: "base" },
      ] },
      { when: { type: "at", t: 480 }, do: [say(
        L("meridian", "Notice: Prism field test scheduled at Pyre. All Halcyon units, disregard local Resonance anomalies."),
        L("haddad", "Prism? Ma'am, what's Prism?"),
        L("varga", "Something Dr Osei hoped she'd never hear about again."),
      )] },
      { when: { type: "captured", player: 0 }, do: [say(
        L("haddad", "Kessel's Uplink is ours. The Hammer is listening, ma'am."),
        L("varga", "Then let it listen. Don't make it speak unless you must."),
      )] },
      { when: { type: "eliminated", player: 1 }, do: [say(
        L("achterberg", "Fascinating. Remnant artillery doctrine hasn't changed in a decade. Mine has."),
        L("haddad", "Kessel is in custody, Marshal."),
      )] },
    ],
    debrief: {
      victory: [
        "Kessel passed into Concord custody. Among the Halcyon wreckage Haddad's gunners found a crate stencilled PRISM. It was empty, but it was humming.",
        "Haddad wrote one line in his log that night: 'If we seal them all, who decides what the light is for?'",
      ],
      defeat: ["Halcyon held the Kessel ridge. The convoy kept running south, full of Citadel gold."],
    },
  },
  {
    id: "ashes", number: 4, act: 1, title: "Ashes of Basin City",
    date: "19 May 2071", place: "Halo shard · the Scar",
    mapId: "quadrant", biome: "scar", commander: "varga",
    seats: [
      { slot: 1, commander: "penitent", difficulty: "hard", personality: "opportunist", name: "The Ashen Host" },
      { slot: 2, commander: "marchetti", difficulty: "medium", personality: "boomer" },
      { slot: 3, commander: "okafor", difficulty: "medium", personality: "rusher" },
    ],
    startGold: 10000,
    briefing: {
      speakers: ["varga", "osei"],
      text: [
        "The Chorus is getting louder. Dr Osei needs a Citadel this close to the Heart to measure it, and Halo, forty kilometres from Ground Zero, is the nearest.",
        "Every power on the continent has come for the same reason. The Choir is here in force, and so is the Penitent.",
        "Seize Halo's Uplink and hold it for two minutes while Osei records.",
      ],
    },
    objectives: [
      { id: "record", primary: true, label: "Hold Halo's Uplink while Osei records", type: "hold", seconds: 120 },
      { id: "plants", primary: false, label: "Destroy 2 Choir Power Plants", type: "destroy", owner: 1, building: "powerPlant", count: 2 },
    ],
    events: [
      { when: { type: "start" }, do: [say(
        L("osei", "Two minutes of clean data, Ilsa. That's all I need. Then we'll know what the Chorus is."),
        L("varga", "Every army on the continent is here, Doctor. Two minutes may be a long time."),
      )] },
      { when: { type: "at", t: 90 }, do: [say(L("osei", "Listen to it. Forty-one hours between pulses. The Fall lasted forty-one hours. That isn't a coincidence; it's a signature."))] },
      { when: { type: "captured", player: 0 }, do: [say(L("osei", "Recording. Hold them off. The Chorus… it's answering us. Every Fallen at once."))] },
      { when: { type: "at", t: 180 }, do: [say(
        L("ruiz", "Marshal. The masked one on the ridge — the Penitent. I had him in my scope. He's wearing a First Director's signet."),
        L("varga", "Say again, Sergeant."),
        L("ruiz", "Kade's signet, ma'am. I'd know it anywhere. I stood guard at his door for six years."),
      )] },
      { when: { type: "at", t: 300 }, do: [say(L("penitent", "Marshal Varga. You held the door for me once. Hold it again."))] },
    ],
    debrief: {
      victory: [
        "Osei got her two minutes. The data showed the twelve Fallen pulsing as a single instrument, with Ground Zero conducting.",
        "Varga filed Ruiz's report on the signet under her own seal. She told no one, and she did not sleep that night.",
      ],
      defeat: ["Halo fell to the Choir. Osei's instruments were lost, and with them the Remnant's best chance to understand the Chorus."],
    },
  },

  // ── Act II — Currents ────────────────────────────────────────────────────────────────────────
  {
    id: "river_rights", number: 5, act: 2, title: "River Rights",
    date: "3 June 2071", place: "Lantern shard · the Mirelands",
    mapId: "riverline", biome: "mire", commander: "okafor",
    seats: [{ slot: 1, commander: "marchetti", difficulty: "medium", personality: "boomer", name: "Halcyon Acquisitions" }],
    startGold: 8000,
    extras: [{
      player: 0,
      buildings: [{ type: "refinery", tag: "mill", dx: 4, dy: 0 }, { type: "pillbox", dx: 7, dy: -1 }, { type: "turret", dx: 7, dy: 2 }],
      units: [{ type: "rifleman", n: 4 }, { type: "rocket", n: 2 }],
    }],
    briefing: {
      speakers: ["okafor", "juniper"],
      text: [
        "Lantern lights eleven Canton towns along the delta. Halcyon calls that 'unmanaged demand' and has sent an acquisition force to fix it.",
        "Ashby Mill, the Cantons' oldest refinery, sits on your bank of the river. Lose the Mill and Lantern's towns go dark this winter.",
        "Drive Halcyon off the river. Keep Ashby Mill standing.",
      ],
    },
    objectives: [
      { id: "drive", primary: true, label: "Drive Halcyon off the river", type: "eliminate", players: [1] },
      { id: "mill", primary: true, label: "Ashby Mill must survive", type: "protect", tag: "mill" },
    ],
    events: [
      { when: { type: "start" }, do: [say(
        L("okafor", "Morning, Lantern. Captain Okafor. Halcyon's on the far bank with a contract and a lot of tanks."),
        L("okafor", "We'll be declining the contract."),
      )] },
      { when: { type: "at", t: 30 }, do: [say(
        L("juniper", "Captain? It's Juniper, signals. The shard's been doing something weird on my radio. Like… counting? Sorry. Not important. Tanks are important."),
        L("okafor", "Keep listening, Juniper. Weird is usually important."),
      )] },
      { when: { type: "at", t: 200 }, do: [say(
        L("marchetti", "Captain Okafor. Halcyon is prepared to guarantee Lantern's eleven towns power at sixty percent of Bright Decade rates. In perpetuity."),
        L("okafor", "And in return?"),
        L("marchetti", "Ownership. It's a small word, Captain. People make it so dramatic."),
      )] },
      { when: { type: "at", t: 400 }, do: [
        say(L("meridian", "Acquisition phase two. Efficiency targets revised upward.")),
        { type: "spawn", player: 1, units: [{ type: "rifleman", n: 4 }, { type: "tank", n: 2 }], near: "base", attack: "base0" },
      ] },
      { when: { type: "objective", id: "mill", status: "failed" }, do: [say(L("okafor", "The Mill… no. Fall back. Fall back!"))] },
    ],
    debrief: {
      victory: [
        "Halcyon withdrew down the delta, citing 'unfavourable market conditions'. Lantern's eleven towns kept their lights.",
        "Juniper kept listening to the shard. Each night she wrote down the strange counting on her radio, and each night the count came out a little shorter.",
      ],
      defeat: ["Ashby Mill burned. Halcyon's acquisition closed by the end of the month, and Lantern's towns paid Halcyon prices that winter."],
    },
  },
  {
    id: "ghost_roads", number: 6, act: 2, title: "Ghost Roads",
    date: "21 June 2071", place: "Greywater shard · the Verdant Reach",
    mapId: "crossfire", biome: "verdant", commander: "lindqvist",
    seats: [{ slot: 1, commander: "haddad", difficulty: "medium", personality: "turtle", name: "Greywater Garrison" }],
    startGold: 10000,
    briefing: {
      speakers: ["lindqvist", "okafor"],
      text: [
        "The Concord Remnant has declared Greywater 'in custody' and garrisoned it, without asking the farmers who live there.",
        "You won't storm a Concord fortress; nobody does. You'll starve it. Its guns, its gates and its factories all run on Power Plants.",
        "Destroy three Concord Power Plants before 15:00 and the garrison will have to withdraw.",
      ],
    },
    objectives: [
      { id: "lights", primary: true, label: "Destroy 3 Concord Power Plants", type: "destroy", owner: 1, building: "powerPlant", count: 3, by: 900 },
      { id: "quiet", primary: false, label: "Lose no more than 12 units", type: "lossesUnder", count: 12 },
    ],
    events: [
      { when: { type: "start" }, do: [say(
        L("lindqvist", "I built half the roads in this valley. Concord engineers built the other half. Mine have better ditches."),
        L("okafor", "Ezra, they're Concord. Not Halcyon. Go easy."),
        L("lindqvist", "I'll go quiet, Captain. That's not the same as easy."),
      )] },
      { when: { type: "at", t: 45 }, do: [say(L("lindqvist", "Custody. They take a thing you love, lock it in a box, and call that keeping it safe. I wore that badge thirty years. Never again."))] },
      { when: { type: "at", t: 420 }, do: [say(
        L("haddad", "Canton commander, this is Captain Haddad. You're hitting our power lines, not our soldiers. Why?"),
        L("lindqvist", "Because I like you better alive, son. Go home."),
      )] },
      { when: { type: "objective", id: "lights", status: "done" }, do: [say(
        L("haddad", "Garrison, stand down. We're withdrawing from Greywater."),
        L("haddad", "…Lindqvist. Was it like this before the Fall? Everyone sure they were the good ones?"),
        L("lindqvist", "Worse, son. We had better uniforms."),
      )] },
    ],
    debrief: {
      victory: [
        "With its lights out, the Greywater garrison withdrew in good order. Nobody on either side died for the shard that week, which in the Spire Wars counts as a miracle.",
        "Haddad's question went up the Remnant chain of command. Varga never answered it.",
      ],
      defeat: ["The Concord's lights stayed on. Greywater stayed in custody, and the farmers stayed outside the wire."],
    },
  },
  {
    id: "the_toll", number: 7, act: 2, title: "The Toll",
    date: "30 July 2071", place: "Ashby shard · the Verdant Reach",
    mapId: "junction", biome: "verdant", commander: "okafor",
    seats: [
      { slot: 1, commander: "varga", difficulty: "medium", personality: "opportunist" },
      { slot: 2, commander: "achterberg", difficulty: "medium", personality: "boomer" },
    ],
    startGold: 10000,
    extras: [{ player: 0, buildings: [{ type: "turret", dx: 5, dy: 4 }, { type: "turret", dx: 4, dy: 5 }] }],
    briefing: {
      speakers: ["okafor", "lindqvist"],
      text: [
        "The Ashby Charter Assembly is voting on the Cantons' answer to the Chorus: share Ashby's data with the Remnant, sell it to Halcyon, or keep it.",
        "Both of them have come to make sure of the outcome. Neither is going to wait politely.",
        "Hold Ashby until the vote ends in 14 minutes. If the Uplink is in Canton hands when the gavel falls, all the better.",
      ],
    },
    objectives: [
      { id: "vote", primary: true, label: "Hold out until the vote ends", type: "survive", seconds: 840 },
      { id: "gavel", primary: false, label: "Hold the Citadel when the vote ends", type: "controlAt", seconds: 840 },
    ],
    events: [
      { when: { type: "start" }, do: [say(L("okafor", "The Assembly's in session. Somebody's always in session. Hold the line, folks."))] },
      { when: { type: "at", t: 60 }, do: [say(L("juniper", "Assembly's started. Old Penn is reading the whole Charter aloud. All of it. We may be here a while."))] },
      { when: { type: "at", t: 360 }, do: [
        say(
          L("lindqvist", "Brought friends, Captain. And a few of the Concord's own tanks. Don't ask."),
          L("okafor", "I never ask, Ezra. It's why we get along."),
        ),
        { type: "spawn", player: 0, units: [{ type: "rifleman", n: 6 }, { type: "rocket", n: 3 }, { type: "tank", n: 2 }], near: "base" },
      ] },
      { when: { type: "at", t: 720 }, do: [say(
        L("varga", "Captain Okafor. This is Marshal Varga. Give Ashby into custody and I'll guarantee your towns' safety."),
        L("okafor", "Marshal, every empire in history guaranteed somebody's safety. Ask me in a hundred years."),
      )] },
      { when: { type: "objective", id: "vote", status: "done" }, do: [say(L("juniper", "The vote's in! Ashby keeps its shard, and the Assembly will share the Chorus data with anyone who asks nicely. Even you, Marshal."))] },
    ],
    debrief: {
      victory: [
        "The Ashby Charter Assembly voted to keep its shard and to share everything it learned about the Chorus. Old Penn insisted on reading out the result twice.",
        "In the archives that night Juniper put the Lantern and Ashby recordings side by side. The counting was the same.",
      ],
      defeat: ["Ashby fell before the vote was counted. The Charter Assembly met in exile for the rest of the war."],
    },
  },
  {
    id: "river_carries", number: 8, act: 2, title: "What the River Carries",
    date: "28 August 2071", place: "Deepfen shard · the Mirelands",
    mapId: "trident", biome: "mire", commander: "lindqvist",
    seats: [
      { slot: 1, commander: "penitent", difficulty: "medium", personality: "rusher", name: "The Ashen Host" },
      { slot: 2, commander: "marchetti", difficulty: "medium", personality: "turtle" },
    ],
    startGold: 10000,
    unlocks: ["countdown"],
    briefing: {
      speakers: ["juniper", "lindqvist"],
      text: [
        "Juniper thinks the Chorus is counting, and Deepfen is the loudest shard in the delta. Give her ninety seconds of clean signal from its Uplink and she can prove it.",
        "The Choir has marched south to stop exactly that.",
        "Take Deepfen's Uplink and hold it for 90 seconds while Juniper records.",
      ],
    },
    objectives: [
      { id: "signal", primary: true, label: "Hold Deepfen's Uplink while Juniper records", type: "hold", seconds: 90 },
      { id: "host", primary: false, label: "Destroy the Ashen Host", type: "eliminate", players: [1] },
    ],
    events: [
      { when: { type: "start" }, do: [say(
        L("juniper", "Ninety seconds, Mr Lindqvist. Ninety seconds and I'll know."),
        L("lindqvist", "Then you'll have them, girl."),
      )] },
      { when: { type: "at", t: 240 }, do: [say(
        L("lindqvist", "Flanking feints, a hammer from the left, reserves held back past sense. I know these tactics. I dug the trenches for the man who wrote them."),
        L("lindqvist", "…Kade. That's Aurelian Kade's war."),
      )] },
      { when: { type: "captured", player: 0 }, do: [say(L("juniper", "Recording! Oh… oh, it's so loud. Keep them off me!"))] },
      { when: { type: "objective", id: "signal", status: "done" }, do: [
        say(
          L("juniper", "Got it. Every pulse is shorter than the last. It's a countdown. It reaches zero on 11 November. The anniversary of the Fall."),
          L("lindqvist", "Get that to everyone. Concord, Halcyon, I don't care who. Everyone."),
        ),
        { type: "unlock", codex: "countdown" },
      ] },
    ],
    debrief: {
      victory: [
        "Juniper's recording travelled the length of the delta by radio before morning, and from there to every Fallen on Earth. The Chorus is a countdown, and it ends at Ground Zero on 11 November, the eighth anniversary of the Fall.",
        "For the first time since Ashby Ford, all four powers were listening to the same thing.",
      ],
      defeat: ["The Ashen Host drove the Cantons from Deepfen before the recording was complete. The Chorus kept counting, and nobody knew what it was counting toward."],
    },
  },

  // ── Act III — Chorus ─────────────────────────────────────────────────────────────────────────
  {
    id: "quarterly", number: 9, act: 3, title: "Quarterly Results",
    date: "22 September 2071", place: "Meridian Flat · Saltglass",
    mapId: "goldrush", biome: "saltglass", commander: "marchetti",
    seats: [
      { slot: 1, commander: "haddad", difficulty: "medium", personality: "turtle" },
      { slot: 2, commander: "okafor", difficulty: "easy", personality: "boomer" },
      { slot: 3, commander: "cantor", difficulty: "medium", personality: "opportunist" },
    ],
    startGold: 8000,
    extras: [{ player: 0, buildings: [{ type: "refinery", dx: 4, dy: 0 }], units: [{ type: "worker", n: 2 }] }],
    briefing: {
      speakers: ["marchetti", "meridian"],
      text: [
        "The board has seen Juniper's countdown and taken a view: whatever happens on 11 November, Halcyon will be the company best capitalised to handle it.",
        "Meridian Flat sits on the richest Citadel gold ever surveyed, and three rivals know it.",
        "Mine 12,000 gold before the quarter closes.",
      ],
    },
    objectives: [
      { id: "quarter", primary: true, label: "Mine 12,000 gold", type: "mine", gold: 12000 },
      { id: "managed", primary: false, label: "Bring Meridian Flat's Uplink under management", type: "capture" },
    ],
    events: [
      { when: { type: "start" }, do: [say(
        L("marchetti", "MERIDIAN, open the quarter."),
        L("meridian", "Quarter open. Competitor presence: Concord, Cantons, Choir. Projected margin: thin."),
      )] },
      { when: { type: "at", t: 60 }, do: [say(L("meridian", "Board briefing. The countdown is now priced in. Shareholder sentiment: anxious. Recommended action: profit."))] },
      { when: { type: "at", t: 300 }, do: [say(
        L("achterberg", "Celeste, I need the Prism budget tripled. If the Chorus is a signal, I can learn to transmit on it."),
        L("marchetti", "Imani, the last time someone tried to talk to the Citadel, a city disappeared."),
        L("achterberg", "And the next time someone tries, it should be someone competent."),
      )] },
      { when: { type: "captured", player: 0 }, do: [say(
        L("marchetti", "…MERIDIAN, is it humming in here?"),
        L("meridian", "No anomalous acoustics detected, Director."),
        L("marchetti", "Then why do I hear it?"),
      )] },
      { when: { type: "objective", id: "quarter", status: "done" }, do: [say(L("meridian", "Quarterly target exceeded. The board extends its congratulations and approves the Prism budget."))] },
    ],
    debrief: {
      victory: [
        "Halcyon closed the quarter with the largest Citadel-gold reserve on Earth, and the board approved Project Prism in full.",
        "Marchetti signed the order without reading it twice. For the first time in thirty years she slept badly. In her dreams something kept trying to say her name.",
      ],
      defeat: ["Meridian Flat's gold went to Halcyon's rivals. The board blamed Marchetti, and Prism lost its funding for a season."],
    },
  },
  {
    id: "prism", number: 10, act: 3, title: "Prism",
    date: "9 October 2071", place: "Pyre shard · the Cinder Coast",
    mapId: "scorched", biome: "cinder", commander: "achterberg",
    seats: [{ slot: 1, commander: "penitent", difficulty: "medium", personality: "rusher", name: "The Ashen Host" }],
    startGold: 10000,
    extras: [{
      player: 0,
      buildings: [
        { type: "lab", tag: "prismA", dx: 4, dy: 0 }, { type: "lab", tag: "prismB", dx: 0, dy: 4 },
        { type: "turret", dx: 7, dy: 1 }, { type: "antiArmorCannon", dx: 2, dy: 7 }, { type: "pillbox", dx: 6, dy: 5 },
      ],
      units: [{ type: "rifleman", n: 4 }, { type: "rocket", n: 3 }, { type: "tank", n: 2 }],
      research: ["advancedDefenses"],
    }],
    briefing: {
      speakers: ["achterberg", "meridian"],
      text: [
        "Project Prism is ready. Two Prism Arrays beside your base can tune themselves to the Chorus, and with twelve minutes of uninterrupted data they can transmit on it.",
        "The Choir calls this blasphemy. The Penitent has brought the Ashen Host to make the point.",
        "Keep both Prism Arrays standing for 12 minutes.",
      ],
    },
    objectives: [
      { id: "alpha", primary: true, label: "Prism Array Alpha must survive", type: "protect", tag: "prismA" },
      { id: "beta", primary: true, label: "Prism Array Beta must survive", type: "protect", tag: "prismB" },
      { id: "run", primary: true, label: "Run the experiment", type: "survive", seconds: 720 },
    ],
    events: [
      { when: { type: "start" }, do: [say(
        L("achterberg", "Arrays are warm. MERIDIAN, log everything. If I die, publish."),
        L("meridian", "Acknowledged. Publication probability noted."),
      )] },
      { when: { type: "at", t: 180 }, do: [
        say(L("vex", "Machines that mock the Song! Burn them!")),
        { type: "spawn", player: 1, units: [{ type: "rifleman", n: 4 }, { type: "rocket", n: 2 }], near: "base", attack: "base0" },
      ] },
      { when: { type: "at", t: 360 }, do: [
        say(L("penitent", "Doctor. You are knocking on a door you do not understand. I know. I knocked first.")),
        { type: "spawn", player: 1, units: [{ type: "rifleman", n: 4 }, { type: "rocket", n: 3 }, { type: "tank", n: 2 }], near: "base", attack: "base0" },
      ] },
      { when: { type: "at", t: 420 }, do: [
        say(
          L("achterberg", "Transmitting. One pulse, Prism to Chorus… and it answered. Every unit on the coast just felt that."),
          L("meridian", "Casualty spike detected. Recommend not doing that again."),
          L("achterberg", "Recommend doing it better."),
        ),
        { type: "pulse", damage: 20, within: 9999 },
      ] },
      { when: { type: "at", t: 540 }, do: [
        say(L("vex", "All of you! Into the fire!")),
        { type: "spawn", player: 1, units: [{ type: "rifleman", n: 5 }, { type: "rocket", n: 3 }, { type: "tank", n: 3 }, { type: "heavyTank", n: 1 }], near: "base", attack: "base0" },
      ] },
      { when: { type: "objective", id: "run", status: "done" }, do: [say(L("achterberg", "Twelve minutes. We have the carrier wave. If someone opens the Heart on the eleventh, Prism can talk to whatever comes out."))] },
    ],
    debrief: {
      victory: [
        "Prism recorded the Chorus's carrier wave and answered it once. The answer still echoes through the Cinder Coast.",
        "Achterberg's report reached Marchetti, Varga and, by a route nobody could trace, the Penitent. All three understood the same thing: whoever stands in the Heart on 11 November will be heard.",
      ],
      defeat: ["The Arrays fell, and the Penitent personally walked through the wreckage. Whatever Prism had learned, the Ashen Host carried it away."],
    },
  },
  {
    id: "the_penitent", number: 11, act: 3, title: "The Penitent",
    date: "27 October 2071", place: "Obsidian Gate · the Cinder Coast",
    mapId: "triad", biome: "cinder", commander: "cantor",
    seats: [
      { slot: 1, commander: "varga", difficulty: "medium", personality: "turtle" },
      { slot: 2, commander: "lindqvist", difficulty: "medium", personality: "opportunist" },
    ],
    startGold: 10000,
    unlocks: ["penitent_identity"],
    briefing: {
      speakers: ["cantor", "penitent"],
      text: [
        "Fifteen days until the Reconvergence. The Song is so loud now that the faithful weep in their sleep.",
        "The Remnant holds Obsidian Gate, the last Fallen between the Choir and Ground Zero, and the Cantons are scouting its flank.",
        "Break the Remnant's line at Obsidian Gate. The Penitent marches with you.",
      ],
    },
    objectives: [
      { id: "line", primary: true, label: "Break the Concord Remnant", type: "eliminate", players: [1] },
      { id: "song", primary: false, label: "Return Obsidian Gate to the Song", type: "capture" },
    ],
    events: [
      { when: { type: "start" }, do: [say(L("cantor", "Sisters, brothers. Sing as you go. Let them hear what we hear."))] },
      { when: { type: "at", t: 120 }, do: [say(
        L("penitent", "Cantor. When the Heart opens, it will need a voice. Someone it already knows."),
        L("cantor", "It needs no voice. It is the voice."),
        L("penitent", "So you have always said."),
      )] },
      { when: { type: "at", t: 360 }, do: [
        say(
          L("penitent", "Ysolde. Look at me."),
          L("narrator", "The Penitent removes his mask. The face beneath is older and burned along one side, but the Cantor knows it at once. Every Concord officer would."),
          L("cantor", "…First Director Kade."),
          L("penitent", "I opened the door once, and it took a city. This time I will be standing inside when it opens. It will answer to me."),
          L("cantor", "It answers to no one. That was the whole point. That was always the whole point."),
        ),
        { type: "unlock", codex: "penitent_identity" },
      ] },
      { when: { type: "captured", player: 0 }, do: [say(L("cantor", "Do you hear it, Aurelian? It isn't saying your name."))] },
      { when: { type: "eliminated", player: 1 }, do: [say(L("varga", "Remnant forces, withdraw to Ground Zero. All of you. That's where this ends."))] },
    ],
    debrief: {
      victory: [
        "Obsidian Gate fell, and the road to Ground Zero lay open. The Choir marched south singing.",
        "The Cantor walked at the back of the column for the first time in five years. She had heard the Song all her life. Now, for the first time, she was afraid of who else was listening.",
      ],
      defeat: ["The Remnant held Obsidian Gate. The Penitent withdrew without a word, and the Cantor walked beside him without asking why."],
    },
  },
  {
    id: "reconvergence", number: 12, act: 3, title: "Reconvergence",
    date: "11 November 2071", place: "Ground Zero · the Saltglass Basin",
    mapId: "four_corners", biome: "scar", commander: "varga",
    seats: [
      { slot: 1, commander: "penitent", difficulty: "hard", personality: "opportunist", name: "The Penitent" },
      { slot: 2, commander: "marchetti", difficulty: "medium", personality: "boomer" },
    ],
    startGold: 12000,
    extras: [{ player: 0, units: [{ type: "rifleman", n: 4 }, { type: "rocket", n: 2 }, { type: "tank", n: 2 }] }],
    unlocks: ["finale"],
    briefing: {
      speakers: ["varga", "osei"],
      text: [
        "The Chorus reaches zero tonight, eight years to the day. Dr Osei has built the Custody Protocol, a way to sing the Heart back to sleep instead of opening it. It needs the Heart's Uplink held for two minutes.",
        "Captain Okafor's Cantons hold the passes behind you. The Penitent and Halcyon are already in the crater.",
        "Take the Heart. Hold it for two minutes. Don't let anyone open the door.",
      ],
    },
    objectives: [
      { id: "heart", primary: true, label: "Take the Heart's Uplink", type: "capture" },
      { id: "custody", primary: true, label: "Hold the Heart while the Custody Protocol runs", type: "hold", seconds: 120, hidden: true },
      { id: "host", primary: false, label: "Destroy the Ashen Host", type: "eliminate", players: [1] },
    ],
    events: [
      { when: { type: "start" }, do: [say(
        L("varga", "Eight years ago I held this ground while they opened the door. Tonight we hold it shut."),
        L("okafor", "Cantons are on the passes, Marshal. Nobody gets behind you. Go do your thing."),
        L("osei", "The Protocol can only run when the count reaches zero — four minutes from now. Take the Uplink and keep it. Then two minutes more. Not one second less."),
      )] },
      { when: { type: "every", t: 41, from: 60 }, do: [{ type: "pulse", damage: 25, within: 7 }] },
      { when: { type: "at", t: 62 }, do: [say(L("osei", "That's the Chorus. Every pulse will hit harder near the Heart. Don't bunch up."))] },
      { when: { type: "captured", player: 0 }, do: [say(L("osei", "Uplink is ours. Hold it, Ilsa — every army in the crater is coming for it now."))] },
      { when: { type: "at", t: 240 }, do: [
        say(L("osei", "Zero. The count is at zero. Starting the Custody Protocol — two minutes on the Uplink, Ilsa. Hold them. Hold them!")),
        { type: "reveal", objective: "custody" },
      ] },
      { when: { type: "captured", player: 1 }, do: [say(
        L("penitent", "The Heart is open. Speak to me."),
        L("osei", "He has the Uplink! Retake it, Ilsa, before the count ends!"),
      )] },
      { when: { type: "captured", player: 2 }, do: [say(
        L("marchetti", "Halcyon has the Uplink. Imani — Prism, now!"),
        L("achterberg", "Transmitting!"),
      )] },
      { when: { type: "at", t: 300 }, do: [say(
        L("penitent", "Ilsa. You held the perimeter for me that night. Hold it for me now. Step aside."),
        L("varga", "I held it for the Concord, Aurelian. You were never the Concord."),
      )] },
      { when: { type: "objective", id: "custody", status: "done" }, do: [say(
        L("osei", "Protocol complete. The Chorus is quieting. It's… sleeping. The Heart is closing."),
        L("penitent", "No. No, it's mine. It knows me—"),
        L("narrator", "The Heart seals. Aurelian Kade is inside it when it closes."),
        L("varga", "All units. Custody established. Stand down."),
      )] },
    ],
    debrief: {
      victory: [
        "At 23:41 on 11 November 2071 the Heart of the Citadel closed for the second time in history. This time it closed gently.",
        "Across the world the twelve Fallen fell silent together. The Chorus stopped. Aurelian Kade was never seen again.",
        "The Spire Wars did not end that night. The shards still gave gold, warmth and power, and people still fought over them. But for the first time, every side had listened to the same song and agreed, briefly, to let it sleep.",
        "Dr Osei's last log entry reads: 'It is not sealed. It is resting. Whoever stands here next must know the difference.'",
      ],
      defeat: ["The count reached zero with the Heart in the wrong hands. Far above the Basin, the Lances began to turn."],
    },
  },
];

export const MISSION_BY_ID = new Map(MISSIONS.map((m) => [m.id, m]));

/** 28 §B: shift an AI tier by the campaign difficulty. */
export function adjustTier(base: "easy" | "medium" | "hard", d: CampaignDifficulty): "easy" | "medium" | "hard" {
  const order = ["easy", "medium", "hard"] as const;
  const i = order.indexOf(base) + (d === "story" ? -1 : d === "veteran" ? 1 : 0);
  return order[Math.max(0, Math.min(2, i))];
}
