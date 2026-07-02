# 19 — Combat Overhaul: Formations (v2, enhanced — supersedes the earlier 19)

The single combat overhaul, built on formations — now enhanced with the four things that turn "organized units" into "fun battles": **pacing** (fights last long enough for tactics to happen), **a heart** (the Field Medic — something to protect and to hunt), **identity** (each formation has one signature trait), and **drama you can see** (banners, integrity, alerts). Still one core concept; everything hangs off it.

Design spine (unchanged):
1. Formations are **presets and customizable** (custom ones defined in settings, pre-match).
2. Each formation has **required units**; only qualifying units join; disallowed if minimums missing.
3. Formations are commanded via **control groups** (Ctrl+1 binds, 1 selects).
4. A formation **persists until explicitly broken** — losses never break it.

New in v2 (the fun layer): §B combat pacing · §D Field Medic · §F formation identity traits · §H engagement discipline & Fall Back · §J battle readability.

Consistent with files 14–18; placeholder renderer. Roster: Rifleman, Grenadier, Rocket Soldier, Scout Buggy, Tank, Heavy Tank, Artillery — plus the new Field Medic.

---

## A. Why formations (the point)

A formation is **one command that encodes a whole plan**: it positions every unit type correctly, moves them as a group, and holds the arrangement through combat. Picking "Spear" is a single decision that arranges the entire army.

Formations create a **counter layer from pure positioning** (on top of the unit triangle): Line is devastating frontally but soft if flanked; Spear punches through but has exposed sides; Box answers encirclement but concentrates less firepower; Column travels but must not fight. The better-positioned army wins — that's the tactics combat was missing, in one learnable idea.

---

## B. Combat pacing (NEW — the invisible fix that enables everything)

**Problem this fixes (stated directly by playtesting): battles resolve too fast.** When armies evaporate in seconds there is no time to react, re-form, flank, retreat, or heal — no time for tactics to exist. Formations can't shine inside a 3-second blender.

**Change: all units gain ×1.5 max HP.** Damage, costs, and building HP are unchanged.

```ts
COMBAT_PACE = { UNIT_HP_MULT: 1.5 }   // applied to every unit's base maxHp
```

- Effect: every unit-vs-unit fight takes ~50% longer. A Rifleman (60→90 HP) now survives ~7–11 s under typical fire instead of ~4–7 s. Armies grind and give the player time to see, decide, and act.
- Why HP up rather than damage down: identical pacing result, but healing (§D) and repair math stay legible, and projectile counts don't change (no perf impact).
- Buildings intentionally unchanged: base-race and siege pacing stays as tuned in files 14–16.
- This multiplier stacks with Armor upgrades (file 15) — that's fine; it's a global pace dial, tunable in one place. If fights drag, ease toward 1.3; if still too fast, 1.7.

---

## C. Roles (units → formation positions)

| Role | Filled by | Units | Position |
|---|---|---|---|
| **Front** | Infantry | Rifleman, Grenadier | front line — absorbs hits |
| **Flank** | Heavy | Tank, Heavy Tank | sides — guard the edges |
| **Rear** | Ranged | Rocket Soldier, Scout Buggy | behind the front — fire over it |
| **Artillery** | Siege | Artillery | far rear |
| **Support** | Support | **Field Medic (§D)** | center — protected, healing outward |

---

## D. The Field Medic (NEW — the heart of the formation)

The reserved Support role is now filled. One unit, huge drama payoff: your formation has something to **protect**, and the enemy's has something to **hunt**. "Kill their medics first" and "keep my medic alive" instantly create the focus decisions combat lacked.

| Unit | Type | HP | Attack | Speed | Heal | Heal range | Gold | Build | Built at |
|---|---|---|---|---|---|---|---|---|---|
| **Field Medic** | Support | 50 | **none** | 2.5 | **4 HP/s, single target** | 2.5 | 120 | 14 s | Barracks |

Behavior:
- **Auto-heals** the lowest-HP friendly unit within range (switches targets as needed); a small visible beam/line shows who is being healed.
- **Cannot attack.** Completely dependent on protection — which is the point.
- **Stacking cap:** at most **2** medics can heal the same unit simultaneously (prevents immortality-stacking).
- In formation it sits in the **center** (Support slots); loose medics follow nearby friendlies.

Balance check (why it's strong but fair): 4 HP/s outheals nothing that's actually focused — a Tank's 18-damage shots or three Riflemen easily overwhelm it — but across a long grinding battle (enabled by §B pacing) a protected medic keeps the front line standing dramatically longer. Countered by: focusing it down (50 HP dies fast), flanking to reach the center, splash (Grenadier/Artillery hit it through the line), or killing the front so fast healing can't matter. Cost 120 with zero DPS means an army of medics is throwing gold away — you want ~1 medic per 6–10 combat units.

**One Lab hook (small):** add **"Combat Stims" — Medic heal 4→6 HP/s, cost 450, time 45 s** — to the Lab tree (file 15 §2), so support scales into the late game.

---

## E. Preset formations

Parametric layouts (scale to any army size, §G). Each now has an **identity trait** (§F).

### Spear (assault)
- Tip: Infantry · wedge sides: Heavy · inside: Siege + Medics · rear: Ranged.
- **Required:** Infantry + Ranged. **Use:** punch through a line or into a base.

### Line (engage)
- Wide front row: Infantry · second row: Ranged · both ends: Heavy · far rear: Siege · center-rear: Medics.
- **Required:** Infantry + Ranged. **Use:** the default head-on battle formation.

### Box (defend)
- Perimeter facing outward: Infantry + Heavy · center: Ranged, Siege, Medics.
- **Required:** ≥4 Infantry. **Use:** hold ground, protect fragile units, answer encirclement.

### Column (march)
- Single/double file: fast units front, main body, Siege middle, rearguard.
- **Required:** none. **Use:** travel through chokes. Not a combat shape.

---

## F. Formation identity traits (NEW — one signature each)

Each formation gets **one small passive trait**, replacing the generic cohesion-bonus dial from v1. This is what makes choosing a formation *feel* like choosing a personality, not a diagram — and it gives each preset a moment:

| Formation | Trait | Effect |
|---|---|---|
| **Spear** | **Charge** | +20% move speed while attack-moving toward a target, until first contact — the wedge visibly *charges* |
| **Line** | **Volley Discipline** | +10% damage for all members while the formation is stationary — set your line, hold it, and it hits harder |
| **Box** | **Brace** | −15% damage taken by all members while the formation is stationary — dig in and endure |
| **Column** | **March** | +15% move speed — it exists to travel |

Rules: traits apply only while **in formation** (loose units get nothing — the gentle nudge to form up); Spear's Charge ends at first contact (it's momentum, not a permanent buff); Line/Box traits drop the moment the formation moves (reposition vs hold is now a real decision). Numbers are small on purpose — identity, not power spikes — and all live in config as dials.

---

## G. Required units, filtering & scaling

- Each formation defines **requiredRoles** (minimums). Unmet → greyed in the menu with a hover reason (tooltip system, file 16 §6).
- Commanding a formation on a **mixed selection**: only units matching the formation's slots **join**; the rest are dropped from the selection (they keep their previous orders). Select a blob, press Spear, the Spear forms itself.
- **Parametric scaling:** role areas are rows/ratios that widen/deepen with unit count (a 6-unit and a 60-unit Line both work). Spacing `0.8` tiles, row spacing `1.0`. Slots fill by nearest-matching-unit to minimize shuffling.

---

## H. Engagement discipline & Fall Back (NEW — how formations fight)

This is what makes a formation behave like a disciplined army instead of a shaped blob that dissolves on contact:

- **Hold your slot:** in-formation units have a **leash of 2 tiles** — they fire at what's in range from their slot and may shift up to the leash, but never chase beyond it. The formation only advances when *ordered* (attack-move moves the whole shape).
- **Smart targeting (the triangle finally fires itself):** in-formation units prioritize (1) an enemy they **counter** within range, then (2) the nearest enemy. Artillery prefers buildings and dense clumps. This one rule makes army composition pay off automatically, with zero player micro.
- **Fall Back (new order, hotkey e.g. `V`):** the formation withdraws **in good order** — it keeps facing the enemy, moves away at 80% speed, and everyone keeps firing at what's in range as they go. This creates the missing decision: *commit or save the army*. An ordered fighting withdrawal (covered by your ranged rear) versus a rout is exactly the kind of moment that makes battles memorable.
- Break Formation remains the explicit dissolve; a subset manually pulled out becomes loose units.

---

## I. Facing, cohesion, persistence (core mechanics)

- **Facing:** set toward the move/attack order; the front faces the enemy. Box is omnidirectional.
- **Cohesion:** the formation moves at the **speed of its slowest member**; an anchor follows the pathfinding route and each unit paths to its slot offset (local avoidance from files 15–16 applies). Narrow terrain compresses the shape temporarily; no auto-morphing.
- **Persistence:** moving, attacking, guarding, and losses all keep the formation intact. **Deaths leave holes; survivors hold position** (a bled Spear is still a Spear). **Re-form** (press the formation key again) recompacts survivors into a tight shape. Only **Break Formation** dissolves it.

---

## J. Battle readability (NEW — see the drama)

Tactics you can't see don't feel like tactics. Cheap placeholder-friendly additions:

- **Formation banner:** a small flag at the formation's anchor showing its **control-group number** (a "1" banner on the field = army 1) and formation icon. Your armies become named characters on the map.
- **Integrity ring:** the banner shows % of slots still filled, colored green → amber → red. You can watch a line *holding* or *bleeding* at a glance.
- **"Line breaking" alert:** if a formation loses >30% of its members within 10 s, fire an alert (toast + minimap ping + banner flash) — the "your left flank is collapsing!" moment.
- **Heal beams** (§D) and existing hit-flash/death effects (file 14 Wave-2) carry the rest. Facing indicators on the formation (a subtle front-edge line) show which way the army is oriented.

---

## K. Control groups & commands

- **Ctrl+1..9** binds selection; **1..9** selects; **double-tap** centers camera. The banner displays the bound number (§J).
- **Formation menu** on the command card (hotkey `F`, then `1/2/3/4` for presets or a custom slot); **Re-form** = same formation again; **Break** = `Shift+F`; **Fall Back** = `V`. All in config.
- **Multiplayer:** formations are sim commands (file 17): add `FORM_UP {unitIds, formationId, facing}`, `BREAK_FORMATION {formationInstanceId}`, `FALL_BACK {formationInstanceId}` to the command set. Control-group binding stays **local** (selection only, never sim).

---

## L. Custom formation editor (settings, pre-match)

- A **role-token grid**: drag role tokens (Front/Flank/Rear/Artillery/Support) onto a grid to define relative positions + facing; mark required roles; name and save to `localStorage` (like maps/settings, file 18). Custom formations appear in the menu beside presets.
- Custom formations get **no identity trait** in v1 (traits are preset-only) — keeps balance surface small; revisit later if customs feel flat.

---

## M. AI use of formations

- The AI **forms before fighting**: Line to engage armies, Spear to assault bases, Box when defending or detecting encirclement, Column to travel.
- It **includes medics** in its army composition (~1 per 8 combat units) once it has a Barracks.
- It **re-forms after losses**, sets facing toward targets, and uses **Fall Back** when a fight drops below ~40% odds (simple strength comparison) — retreating armies that live to fight again make the AI feel dramatically smarter.
- Keep it a simple situation→formation mapping; the point is AI armies read as deliberate.

---

## N. Data model & config

```ts
type FormationRole = "front" | "flank" | "rear" | "artillery" | "support";
type FormationId = "spear" | "line" | "box" | "column" | string;
type UnitType = ... | "medic";
type CombatType = "infantry" | "ranged" | "heavy" | "siege" | "support";
// unit state union adds: "inFormation", "fallingBack", "healing"

interface FormationDef {
  id: FormationId; name: string;
  slots: { role: FormationRole; dx: number; dy: number }[];   // parametric template
  requiredRoles: FormationRole[];
  trait?: "charge" | "volley" | "brace" | "march";            // presets only
}

interface Formation {
  id: number; formationDefId: FormationId; owner: 0|1|2|3;
  unitIds: number[]; anchor: {x:number;y:number}; facing: number;
  slotAssignments: { unitId:number; slotIndex:number }[];
  stationarySince: number | null;    // for Volley/Brace
  charging: boolean;                 // Spear pre-contact
}

interface Unit {
  // ...existing...
  formationId: number | null;
  slotOffset?: {dx:number; dy:number};
  healTarget?: number | null;        // medic
}

export const FORMATIONS = {
  SPACING: 0.8, ROW_SPACING: 1.0, LEASH: 2.0,
  MOVE_AT_SLOWEST: true,
  TRAITS: { CHARGE_SPEED: 1.20, VOLLEY_DMG: 1.10, BRACE_TAKEN: 0.85, MARCH_SPEED: 1.15 },
  FALL_BACK_SPEED: 0.8,
  BREAK_ALERT: { LOSS_FRACTION: 0.3, WINDOW_S: 10 },
  HOTKEYS: { open: "f", break: "shift+f", fallBack: "v" },
};
export const COMBAT_PACE = { UNIT_HP_MULT: 1.5 };
export const MEDIC = { HEAL_PER_S: 4, RANGE: 2.5, MAX_HEALERS_PER_TARGET: 2, STIM_HEAL_PER_S: 6 };
```

Protocol additions (file 17): `FORM_UP`, `BREAK_FORMATION`, `FALL_BACK` as above.

---

## O. Build milestones

1. **Pacing + Medic first (quick wins):** apply `UNIT_HP_MULT`; add the Field Medic (unit, auto-heal, stacking cap, heal beam) + the Lab "Combat Stims" entry. *Playable improvement before formations even land.*
2. **Slots & presets:** FormationDef templates, parametric slot generation, unit→slot assignment; render a formation in shape.
3. **Filtering & requirements:** greyed-with-reason menu; mixed-selection filtering.
4. **Movement, facing, cohesion:** anchor pathing, slot offsets, slowest-speed cohesion, facing from orders.
5. **Persistence & control groups:** holes stay, Re-form recompacts, Break dissolves; Ctrl+1..9 binding; banner + integrity ring + break alert (§J).
6. **Engagement discipline:** leash, counter-first targeting, Fall Back; identity traits (Charge/Volley/Brace/March). Wire FORM_UP / BREAK_FORMATION / FALL_BACK as network commands.
7. **Custom editor:** role-token grid in settings, save/load, usable in-match.
8. **AI formations:** situation→formation mapping, medic composition, re-form, AI Fall Back.

---

## P. Scope guard (what this deliberately does NOT add)

No suppressive/zone-fire, no directional back-damage, no super units, no morale system, no stances beyond Fall Back, no ambush/cloak. The bet of this file is that **pacing + formations + a medic + identity + readability** is the complete recipe for fun combat — one concept with a heart and a face. Play it first; add the next layer (a second support unit, or zone fire slotting into the Artillery role) only if battles still feel flat afterward. Every number above is a config dial; tune one at a time.