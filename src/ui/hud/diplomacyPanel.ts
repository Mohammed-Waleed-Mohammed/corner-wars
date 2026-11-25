// 38 deals, the player's side: the offer card (the weakest picks whom to send a Peacemaker to, or lets the
// chance pass), the letter card (the receiver accepts or declines), one status line per deal or treaty of
// mine (with Escort while my treaty cart is on the road), and the deal events as HUD alerts. Every
// button is an order (DEAL_SEND / DEAL_DECLINE / DEAL_ANSWER / ESCORT) through the controller; the sim
// checks each again. Reads state.diplomacy only.

import { DEALS, ownerColor } from "../../config/constants";
import type { Deal, DiploEvent, GameState, PlayerId } from "../../core/types";
import { recipients } from "../../engine/diplomacy";
import { onScreenNumbers } from "../spectator/logFeed";
import type { Alerts } from "./alerts";
import type { HudControls } from "./controls";
import { setText } from "./domWrite";
import "./diplomacy.css";

const PHASE_TEXT: Record<Deal["phase"], string> = {
  prep: "Peacemaker readying at your yard", walk: "Peacemaker on the road", letter: "letter thrown — awaiting the answer",
  enter: "accepted — Peacemaker walking to their yard", cartPrep: "treaty cart being readied", cart: "treaty cart on the road", home: "declined — Peacemaker walking home",
};
const name = (p: PlayerId): string => `P${p + 1}`;
const secs = (s: number): string => `${Math.max(0, Math.ceil(s))} s`;
const clock = (s: number): string => { const v = Math.max(0, Math.ceil(s)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`; };

export class DiplomacyPanel {
  private root: HTMLElement;
  private offerEl: HTMLElement;
  private letterEl: HTMLElement;
  private statusEl: HTMLElement;
  private ctrl: HudControls | null = null;
  private offerSig = "";
  private letterSig = "";
  private statusSig = "";
  private seq = 0;
  private local: PlayerId;
  private alerts: Alerts;

  constructor(parent: HTMLElement, local: PlayerId, alerts: Alerts) {
    this.local = local;
    this.alerts = alerts;
    this.root = document.createElement("div");
    this.root.className = "dip";
    this.offerEl = document.createElement("div");
    this.letterEl = document.createElement("div");
    this.statusEl = document.createElement("div");
    this.statusEl.className = "dip-status";
    this.root.append(this.offerEl, this.letterEl, this.statusEl);
    parent.append(this.root);
  }

  bind(c: HudControls): void { this.ctrl = c; }

  update(state: GameState): void {
    const d = state.diplomacy;
    const t = state.time;
    this.events(state);
    // ── the offer ──
    const offer = d?.offer && d.offer.to === this.local && !state.players[this.local].eliminated ? d.offer : null;
    const can = offer ? recipients(state, this.local) : [];
    const gold = state.players[this.local].gold;
    const oSig = offer ? `${offer.until}|${can.join(",")}|${gold >= DEALS.ENVOY_COST}` : "";
    if (oSig !== this.offerSig) {
      this.offerSig = oSig;
      this.offerEl.replaceChildren();
      this.offerEl.className = offer ? "dip-card hud-chamfer" : "";
      if (offer) {
        const h = el("div", "dip-title", "A chance for peace");
        const cd = el("span", "dip-cd", "");
        cd.dataset.cd = "offer";
        h.append(cd);
        const p = el("div", "dip-text", `${name(offer.dominant)} has grown dominant and you are the weakest. Send a Peacemaker (${DEALS.ENVOY_COST.toLocaleString("en-US")} g) to one rival: if they accept and your treaty cart reaches them with ${DEALS.TRIBUTE} g of tribute, you two hold a ceasefire against ${name(offer.dominant)}.`);
        const row = el("div", "dip-row", "");
        for (const r of can) {
          const b = button(`Send to ${name(r)}`, () => this.ctrl?.dealSend(r));
          b.style.borderColor = ownerColor(r);
          if (gold < DEALS.ENVOY_COST) { b.disabled = true; b.title = `Needs ${DEALS.ENVOY_COST} g`; }
          row.append(b);
        }
        row.append(button("Not now", () => this.ctrl?.dealDecline(), "dip-no"));
        this.offerEl.append(h, p, row);
      }
    }
    if (offer) this.countdown(this.offerEl, offer.until - t);

    // ── a letter to me ──
    const letter = d?.deals.find((x) => x.to === this.local && x.phase === "letter") ?? null;
    const lSig = letter ? `${letter.id}` : "";
    if (lSig !== this.letterSig) {
      this.letterSig = lSig;
      this.letterEl.replaceChildren();
      this.letterEl.className = letter ? "dip-card dip-letter hud-chamfer" : "";
      if (letter) {
        const h = el("div", "dip-title", `A peace letter from ${name(letter.from)}`);
        const cd = el("span", "dip-cd", "");
        h.append(cd);
        const p = el("div", "dip-text", `A ceasefire against ${name(letter.dominant)}, sealed by a treaty cart with up to ${DEALS.TRIBUTE} g of tribute. Accept, and the Peacemaker walks to your yard. Your units leave it alone; striking it, or a partner, ends the deal.`);
        const row = el("div", "dip-row", "");
        row.append(button("Accept", () => this.ctrl?.dealAnswer(letter.id, true), "dip-yes"), button("Decline", () => this.ctrl?.dealAnswer(letter.id, false), "dip-no"));
        this.letterEl.append(h, p, row);
      }
    }
    if (letter) this.countdown(this.letterEl, DEALS.LETTER_S - (t - letter.at));

    // ── my deals and treaties ──
    const mine = (d?.deals ?? []).filter((x) => (x.from === this.local || x.to === this.local) && !(x.to === this.local && x.phase === "letter"));
    const treaties = (d?.treaties ?? []).filter((x) => x.a === this.local || x.b === this.local);
    const sSig = mine.map((x) => `${x.id}:${x.phase}`).join(",") + "|" + treaties.map((x) => `${x.a}${x.b}${x.warned}`).join(",");
    if (sSig !== this.statusSig) {
      this.statusSig = sSig;
      this.statusEl.replaceChildren();
      for (const x of mine) {
        const other = x.from === this.local ? x.to : x.from;
        const line = el("div", "dip-line hud-chamfer-sm", "");
        line.style.borderLeftColor = ownerColor(other);
        const txt = el("span", "", "");
        txt.dataset.deal = String(x.id);
        line.append(txt);
        if (x.from === this.local && x.phase === "cart") line.append(button("Escort", () => this.ctrl?.escortSelected(), "dip-small", "Selected units guard the cart all the way"));
        this.statusEl.append(line);
      }
      for (const tr of treaties) {
        const other = tr.a === this.local ? tr.b : tr.a;
        const line = el("div", `dip-line hud-chamfer-sm${tr.warned ? " warn" : ""}`, "");
        line.style.borderLeftColor = ownerColor(other);
        const txt = el("span", "", "");
        txt.dataset.treaty = String(other);
        line.append(txt);
        this.statusEl.append(line);
      }
    }
    for (const x of mine) {
      const s = this.statusEl.querySelector<HTMLElement>(`[data-deal="${x.id}"]`);
      if (!s) continue;
      const other = x.from === this.local ? x.to : x.from;
      const left = x.phase === "letter" ? ` (${secs(DEALS.LETTER_S - (t - x.at))})` : x.phase === "cartPrep" ? ` (${secs(DEALS.CART_PREP_S - (t - x.at))})` : x.phase === "prep" ? ` (${secs(DEALS.PREP_S - (t - x.at))})` : "";
      const cart = x.phase === "cart" && x.cartId != null ? state.entities.find((e) => e.id === x.cartId) : undefined;
      const hp = cart ? ` · cart ${Math.round((100 * cart.hp) / cart.maxHp)}%` : "";
      setText(s, `Deal with ${name(other)}: ${x.from === this.local ? PHASE_TEXT[x.phase] : x.phase === "cart" ? "their treaty cart is on its way to you" : x.phase === "cartPrep" ? "their treaty cart is being readied" : x.phase === "enter" ? "their Peacemaker is walking to your yard" : PHASE_TEXT[x.phase]}${left}${hp}`);
    }
    for (const tr of treaties) {
      const other = tr.a === this.local ? tr.b : tr.a;
      const s = this.statusEl.querySelector<HTMLElement>(`[data-treaty="${other}"]`);
      if (s) setText(s, `Treaty with ${name(other)} against ${name(tr.dominant)} — ${tr.warned ? `ends in ${secs(tr.until - t)}` : `${clock(tr.until - t)} left`}`);
    }
  }

  private countdown(card: HTMLElement, s: number): void {
    const cd = card.querySelector<HTMLElement>(".dip-cd");
    if (cd) setText(cd, secs(s));
  }

  /** The deal events I'm told of, as alerts (a ping where it happened). */
  private events(state: GameState): void {
    const log = state.diplomacy?.log ?? [];
    for (const e of log) {
      if (e.seq <= this.seq) continue;
      this.seq = e.seq;
      if (e.to && !e.to.includes(this.local)) continue;
      if (e.kind === "offer" && e.to?.includes(this.local)) continue; // the card says it
      this.alerts.push(onScreenNumbers(e.text), sevOf(e, this.local), e.x, e.y);
    }
  }
}

function sevOf(e: DiploEvent, me: PlayerId): "good" | "warn" | "bad" {
  if (e.kind === "sealed" && (e.from === me || e.on === me)) return "good";
  if (e.kind === "envoyKilled" || e.kind === "cartKilled" || e.kind === "broken" || e.kind === "failed" || e.kind === "declined") return e.from === me || e.on === me ? "bad" : "warn";
  if (e.kind === "sealed" || e.kind === "dominant") return e.on === me ? "bad" : "warn";
  return "warn";
}

function el(tag: string, cls: string, text: string): HTMLElement {
  const x = document.createElement(tag);
  if (cls) x.className = cls;
  if (text) x.textContent = text;
  return x;
}

function button(label: string, on: () => void, cls = "", title = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `dip-btn hud-chamfer-sm ${cls}`.trim();
  b.textContent = label;
  if (title) b.title = title;
  b.addEventListener("click", (ev) => { ev.stopPropagation(); on(); });
  return b;
}
