// Lobby UI (17-multiplayer §9). Three screens rendered into #app: the main menu (Single Player /
// Host / Join), the host lobby (room id + editable slots + Start), and the client lobby (read-only
// slots while waiting for the host to Start). The host is the single source of truth for the slot
// list; clients only render the LOBBY_STATE the host broadcasts.
//
// M3 boundary: this delivers create/join + LOBBY_STATE exchange + START carrying the shared seed &
// slots. The actual per-turn command exchange (NetworkSession) is M4 — until then main.ts boots the
// agreed seed through a LocalSession, so every peer starts from the identical world.

import { COLORS } from "../../config/constants";
import type { PlayerId } from "../../core/types";
import { NetPeer } from "../../net/peer";
import { CORNER_LABELS, type MatchConfig, type NetMessage, type SlotInfo, type SlotKind } from "../../net/protocol";

export interface LobbyResult {
  config: MatchConfig;
  slots: SlotInfo[];
  localPlayerId: PlayerId;
  peer: NetPeer;
}

export interface LobbyHandlers {
  onSinglePlayer: () => void;
  onStartMatch: (r: LobbyResult) => void;
}

const NAMES = ["Host", "Player 2", "Player 3", "Player 4"];

/** Escape untrusted text (remote peer names arrive off the network) before it touches innerHTML. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function randomSeed(): number {
  // UI-side randomness (never the sim): the host picks the match seed, then shares it so every
  // peer's createInitialState(seed) builds the identical map.
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function defaultSlots(): SlotInfo[] {
  return [0, 1, 2, 3].map((i) => ({
    playerId: i as PlayerId,
    kind: (i === 0 ? "human" : "open") as SlotKind,
    name: i === 0 ? NAMES[0] : "",
    color: COLORS.players[i],
    corner: CORNER_LABELS[i],
    peerId: null,
  }));
}

const SLOT_KINDS: SlotKind[] = ["human", "ai", "open", "closed"];

/** Rebuild a slots array received off the wire into a trusted shape: exactly 4 seats, playerId
 *  clamped to 0..3, kind validated, name length-capped. color/corner are dropped in favour of the
 *  local tables at render time, so no host-controlled string reaches innerHTML. Also keeps the
 *  localPlayerId we later hand to the sim within range. (§5.2 trusts peers to run the sim honestly,
 *  but a malformed/hostile LOBBY_STATE must never XSS a client or crash it.) */
function sanitizeSlots(raw: unknown): SlotInfo[] {
  const arr = Array.isArray(raw) ? raw : [];
  return [0, 1, 2, 3].map((i) => {
    const o = (arr[i] ?? {}) as Partial<SlotInfo>;
    const pid = (typeof o.playerId === "number" && o.playerId >= 0 && o.playerId <= 3 ? Math.floor(o.playerId) : i) as PlayerId;
    return {
      playerId: pid,
      kind: SLOT_KINDS.includes(o.kind as SlotKind) ? (o.kind as SlotKind) : "open",
      name: typeof o.name === "string" ? o.name.slice(0, 24) : "",
      color: COLORS.players[pid],
      corner: CORNER_LABELS[pid],
      peerId: typeof o.peerId === "string" ? o.peerId : null,
    };
  });
}

export class Lobby {
  private root: HTMLElement;
  private handlers: LobbyHandlers;
  private peer: NetPeer | null = null;
  private slots: SlotInfo[] = defaultSlots();
  private seed = randomSeed();
  private started = false;

  constructor(parent: HTMLElement, handlers: LobbyHandlers) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.className = "lobby";
    parent.appendChild(this.root);
    this.showMenu();
  }

  // ── Menu ────────────────────────────────────────────────────────────────────
  private showMenu(): void {
    this.root.innerHTML = `
      <div class="lobby-card">
        <h1 class="lobby-title">Corner Wars</h1>
        <p class="lobby-sub">4-player free-for-all · capture the Citadel</p>
        <div class="lobby-actions">
          <button class="lobby-btn primary" data-act="sp">Single Player</button>
          <button class="lobby-btn" data-act="host">Host Online Game</button>
          <button class="lobby-btn" data-act="join">Join Online Game</button>
        </div>
        <p class="lobby-note">Online play is peer-to-peer over WebRTC — share the room code with friends.</p>
      </div>`;
    this.qs("[data-act=sp]").onclick = () => { this.destroy(); this.handlers.onSinglePlayer(); };
    this.qs("[data-act=host]").onclick = () => this.startHosting();
    this.qs("[data-act=join]").onclick = () => this.showJoin();
  }

  // ── Host ──────────────────────────────────────────────────────────────────
  private async startHosting(): Promise<void> {
    this.showStatus("Creating room…");
    let peer: NetPeer;
    try {
      peer = await NetPeer.host();
    } catch (e) {
      this.showError(`Couldn't create a room: ${(e as Error).message}`, () => this.showMenu());
      return;
    }
    this.peer = peer;
    this.slots = defaultSlots();
    peer.onMessage = (msg, from) => this.hostOnMessage(msg, from);
    peer.onPeerLeave = (pid) => this.hostFreeSlot(pid);
    peer.onError = (err) => console.warn("[lobby] host peer error:", err.message);
    this.renderHostLobby();
  }

  private hostOnMessage(msg: NetMessage, from: string): void {
    if (msg.t !== "JOIN") return; // lobby phase: the only client→host message that matters is JOIN
    if (this.slots.some((s) => s.peerId === from)) return; // ignore a duplicate JOIN from a seated peer
    const slot = this.slots.find((s) => s.kind === "open");
    if (!slot) {
      // Room full: tell the client explicitly so it doesn't hang forever on a stale "waiting" screen.
      this.peer?.sendTo(from, { t: "JOIN_REJECTED", reason: "The room is full." });
      return;
    }
    slot.kind = "human";
    slot.peerId = from;
    slot.name = (typeof msg.name === "string" ? msg.name.slice(0, 20) : "").trim() || `Player ${slot.playerId + 1}`;
    this.broadcastLobby();
    this.renderHostLobby();
  }

  private hostFreeSlot(peerId: string): void {
    const slot = this.slots.find((s) => s.peerId === peerId);
    if (!slot) return;
    slot.kind = "open";
    slot.peerId = null;
    slot.name = "";
    this.broadcastLobby();
    this.renderHostLobby();
  }

  private broadcastLobby(): void {
    this.peer?.broadcast({ t: "LOBBY_STATE", slots: this.slots, seed: this.seed, hostId: this.peer.id });
  }

  private renderHostLobby(): void {
    const room = this.peer?.id ?? "";
    this.root.innerHTML = `
      <div class="lobby-card wide">
        <h1 class="lobby-title">Host Lobby</h1>
        <div class="lobby-room">
          <span class="lobby-room-label">Room code</span>
          <code class="lobby-room-code" data-room>${esc(room)}</code>
          <button class="lobby-btn tiny" data-copy>Copy</button>
        </div>
        <div class="lobby-slots">${this.slots.map((s, i) => this.slotRow(s, i, true)).join("")}</div>
        <div class="lobby-actions row">
          <button class="lobby-btn" data-back>Leave</button>
          <button class="lobby-btn primary" data-start>Start Match</button>
        </div>
        <p class="lobby-note">Empty seats become AI when you start. Click a seat to cycle Open · AI · Closed.</p>
      </div>`;
    this.qs("[data-copy]").onclick = () => navigator.clipboard?.writeText(room).catch(() => {});
    this.qs("[data-back]").onclick = () => { this.leave(); this.showMenu(); };
    this.qs("[data-start]").onclick = () => this.hostStart();
    // Host can cycle the state of any non-human seat.
    this.root.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) => {
      const i = Number(el.dataset.slot);
      if (this.slots[i].kind === "human") return;
      el.onclick = () => this.cycleSlot(i);
    });
  }

  private cycleSlot(i: number): void {
    const order: SlotKind[] = ["open", "ai", "closed"];
    const s = this.slots[i];
    if (s.kind === "human") return;
    s.kind = order[(order.indexOf(s.kind) + 1) % order.length];
    s.name = s.kind === "ai" ? "Computer" : "";
    this.broadcastLobby();
    this.renderHostLobby();
  }

  private hostStart(): void {
    // Freeze the roster: any still-open seat fills with AI (a closed seat plays with fewer than 4).
    for (const s of this.slots) if (s.kind === "open") { s.kind = "ai"; s.name = "Computer"; }
    const config: MatchConfig = { seed: this.seed, terrain: true };
    this.started = true;
    this.peer?.broadcast({ t: "START", config, slots: this.slots });
    this.enterMatch(config, this.slots, 0);
  }

  // ── Join / client ───────────────────────────────────────────────────────────
  private showJoin(): void {
    this.root.innerHTML = `
      <div class="lobby-card">
        <h1 class="lobby-title">Join Game</h1>
        <label class="lobby-field"><span>Your name</span><input data-name maxlength="20" value="Player" /></label>
        <label class="lobby-field"><span>Room code</span><input data-room placeholder="paste the host's code" /></label>
        <div class="lobby-actions row">
          <button class="lobby-btn" data-back>Back</button>
          <button class="lobby-btn primary" data-connect>Connect</button>
        </div>
        <p class="lobby-err" data-err hidden></p>
      </div>`;
    this.qs("[data-back]").onclick = () => this.showMenu();
    const connect = (): void => {
      const room = (this.qs("[data-room]") as HTMLInputElement).value.trim();
      const name = (this.qs("[data-name]") as HTMLInputElement).value.trim() || "Player";
      if (!room) { this.setErr("Enter a room code."); return; }
      this.startJoining(room, name);
    };
    this.qs("[data-connect]").onclick = connect;
    (this.qs("[data-room]") as HTMLInputElement).onkeydown = (e) => { if (e.key === "Enter") connect(); };
  }

  private async startJoining(roomId: string, name: string): Promise<void> {
    this.showStatus("Connecting to host…");
    let peer: NetPeer;
    try {
      peer = await NetPeer.join(roomId);
    } catch (e) {
      this.showError(`Couldn't join: ${(e as Error).message}`, () => this.showJoin());
      return;
    }
    this.peer = peer;
    peer.onMessage = (msg) => this.clientOnMessage(msg);
    peer.onPeerLeave = () => { if (!this.started) this.showError("Host disconnected.", () => this.showMenu()); };
    peer.onError = (err) => console.warn("[lobby] client peer error:", err.message);
    peer.sendToHost({ t: "JOIN", name });
    this.renderClientLobby();
  }

  private clientOnMessage(msg: NetMessage): void {
    if (msg.t === "JOIN_REJECTED") {
      this.showError(msg.reason || "The host declined the connection.", () => this.showMenu());
    } else if (msg.t === "LOBBY_STATE") {
      this.slots = sanitizeSlots(msg.slots); // never trust wire data straight into the DOM/sim
      this.seed = Number(msg.seed) >>> 0;
      this.renderClientLobby();
    } else if (msg.t === "START") {
      const slots = sanitizeSlots(msg.slots);
      const mine = slots.find((s) => s.peerId === this.peer?.id);
      if (!mine) {
        // We were never seated (room filled up / seat closed) — don't silently boot as player 0 and
        // collide with the host. Bail out to the menu instead.
        this.showError("The host started the match without a seat for you.", () => this.showMenu());
        return;
      }
      this.started = true;
      const seed = Number(msg.config?.seed) >>> 0;
      this.enterMatch({ seed, terrain: msg.config?.terrain !== false }, slots, mine.playerId);
    }
  }

  private renderClientLobby(): void {
    this.root.innerHTML = `
      <div class="lobby-card wide">
        <h1 class="lobby-title">Lobby</h1>
        <p class="lobby-sub">Waiting for the host to start…</p>
        <div class="lobby-slots">${this.slots.map((s, i) => this.slotRow(s, i, false)).join("")}</div>
        <div class="lobby-actions"><button class="lobby-btn" data-back>Leave</button></div>
      </div>`;
    this.qs("[data-back]").onclick = () => { this.leave(); this.showMenu(); };
  }

  // ── Shared ────────────────────────────────────────────────────────────────
  private slotRow(s: SlotInfo, i: number, hostView: boolean): string {
    // color/corner come from local trusted tables keyed by playerId — NEVER the host's wire strings
    // (which could carry an innerHTML XSS payload). name is the only free text and is esc()'d.
    const color = COLORS.players[s.playerId] ?? "#888888";
    const corner = CORNER_LABELS[s.playerId] ?? "";
    const you = s.peerId && s.peerId === this.peer?.id ? " (you)" : i === 0 && hostView ? " (you)" : "";
    const label =
      s.kind === "human" ? `${esc(s.name)}${you}` :
      s.kind === "ai" ? "Computer (AI)" :
      s.kind === "closed" ? "Closed" : "Open";
    const cls = s.kind === "human" ? "human" : s.kind === "ai" ? "ai" : "empty";
    return `<div class="lobby-slot ${cls}" data-slot="${i}">
        <span class="lobby-dot" style="background:${color}"></span>
        <span class="lobby-slot-name">${label}</span>
        <span class="lobby-slot-corner">${corner}</span>
      </div>`;
  }

  private enterMatch(config: MatchConfig, slots: SlotInfo[], localPlayerId: PlayerId): void {
    const peer = this.peer;
    if (!peer) return;
    this.root.remove();
    this.handlers.onStartMatch({ config, slots, localPlayerId, peer });
  }

  private showStatus(text: string): void {
    this.root.innerHTML = `<div class="lobby-card"><p class="lobby-sub">${esc(text)}</p><div class="lobby-spinner"></div></div>`;
  }

  private showError(text: string, back: () => void): void {
    this.leave();
    this.root.innerHTML = `<div class="lobby-card"><p class="lobby-err">${esc(text)}</p><div class="lobby-actions"><button class="lobby-btn" data-back>Back</button></div></div>`;
    this.qs("[data-back]").onclick = back;
  }

  private setErr(text: string): void {
    const el = this.root.querySelector<HTMLElement>("[data-err]");
    if (el) { el.textContent = text; el.hidden = false; }
  }

  private leave(): void {
    this.peer?.close();
    this.peer = null;
    this.slots = defaultSlots();
    this.started = false;
  }

  private destroy(): void {
    this.root.remove();
  }

  private qs(sel: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(sel)!;
  }
}
