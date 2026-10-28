// 27 §F — the in-game commander card: portrait, name, faction, and the ability button with a radial
// cooldown and the Z hotkey. Lives in the HUD's left stack (under Resources). Display-only: clicking
// calls the handler (controller.activateAbility), which emits USE_ABILITY through the session.

import "./commanderCard.css";
import { ABILITIES, COMMANDERS } from "../config/commanders";
import { COMMANDER_INFO, FACTIONS, abilityCooldownText, abilityText, doctrineText, fullName } from "../content/factions";
import type { GameState, PlayerId } from "../core/types";
import { emblemCanvas, portraitCanvas, portraitVersion } from "../render/portraits";

export class CommanderCard {
  private root: HTMLElement;
  private portrait: HTMLCanvasElement;
  private name: HTMLElement;
  private faction: HTMLElement;
  private btn: HTMLButtonElement;
  private cd: HTMLElement;
  private label: HTMLElement;
  private shownFor: string | null = null;
  private portraitVer = -1;
  private readonly local: PlayerId;

  constructor(parent: HTMLElement, local: PlayerId, onCast: () => void) {
    this.local = local;
    this.root = document.createElement("div");
    this.root.id = "console-commander";
    this.root.className = "hud-console hud-chamfer";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="hud-console-inner hud-chamfer cmdr-inner">
        <div class="cmdr-portrait hud-well hud-chamfer-sm"><canvas width="96" height="96" data-p></canvas></div>
        <div class="cmdr-info">
          <div class="hud-header cmdr-faction" data-f></div>
          <div class="cmdr-name" data-n></div>
          <button class="cmdr-ability hud-chamfer-sm" data-b>
            <span class="cmdr-ability-label" data-l></span>
            <span class="cmdr-ability-cd" data-c></span>
            <span class="cmdr-key">Z</span>
          </button>
        </div>
      </div>`;
    this.portrait = this.root.querySelector("[data-p]") as HTMLCanvasElement;
    this.name = this.root.querySelector("[data-n]") as HTMLElement;
    this.faction = this.root.querySelector("[data-f]") as HTMLElement;
    this.btn = this.root.querySelector("[data-b]") as HTMLButtonElement;
    this.cd = this.root.querySelector("[data-c]") as HTMLElement;
    this.label = this.root.querySelector("[data-l]") as HTMLElement;
    this.btn.addEventListener("click", onCast);
    // Under the Resources console if the HUD's left stack exists; else float.
    const stack = parent.querySelector("#hud-left-stack");
    const status = parent.querySelector("#console-status");
    if (stack && status) status.after(this.root);
    else parent.append(this.root);
  }

  update(state: GameState, targeting: boolean): void {
    const p = state.players[this.local];
    if (!p?.commander) { this.root.hidden = true; return; }
    this.root.hidden = false;
    const id = p.commander;
    const info = COMMANDER_INFO[id];
    const fac = FACTIONS[info.faction];
    const ver = portraitVersion();
    if (this.shownFor !== id || this.portraitVer !== ver) {
      this.shownFor = id;
      this.portraitVer = ver;
      const g = this.portrait.getContext("2d")!;
      g.clearRect(0, 0, 96, 96);
      g.drawImage(portraitCanvas(id, 192), 0, 0, 96, 96);
      g.drawImage(emblemCanvas(info.faction, 64), 66, 66, 28, 28);
      this.name.textContent = p.displayName ?? fullName(info);
      this.faction.textContent = fac.short;
      this.faction.style.color = fac.color;
      this.root.style.setProperty("--cmdr-accent", fac.color);
      const ab = COMMANDERS[id].ability;
      this.label.textContent = info.abilityName;
      this.btn.title = `${info.abilityName}: ${abilityText(ab)}\n${abilityCooldownText(ab)}\n\n${info.doctrineName} (passive): ${doctrineText(id)}\n\nHotkey: Z`;
    }
    const total = ABILITIES[COMMANDERS[id].ability].cooldown;
    const left = p.abilityCooldown;
    const ready = left <= 0 && !p.eliminated;
    this.btn.classList.toggle("ready", ready);
    this.btn.classList.toggle("targeting", targeting);
    this.btn.style.setProperty("--cd", String(ready ? 0 : Math.min(1, left / total)));
    this.cd.textContent = ready ? (targeting ? "TARGET" : "READY") : `${Math.ceil(left)}s`;
    const buff = p.abilityBuff;
    this.root.classList.toggle("buffed", !!buff && buff.until > state.time);
  }

  destroy(): void {
    this.root.remove();
  }
}
