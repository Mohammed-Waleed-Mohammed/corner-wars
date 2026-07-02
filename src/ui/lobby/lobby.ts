// Lobby UI (17-multiplayer §9). Three screens rendered into #app: the main menu (Single Player /
// Host / Join), the host lobby (room id + editable slots + Start), and the client lobby (read-only
// slots while waiting for the host to Start). The host is the single source of truth for the slot
// list; clients only render the LOBBY_STATE the host broadcasts.
//
// M3 boundary: this delivers create/join + LOBBY_STATE exchange + START carrying the shared seed &
// slots. The actual per-turn command exchange (NetworkSession) is M4 — until then main.ts boots the
// agreed seed through a LocalSession, so every peer starts from the identical world.

import { CHAT, COLORS, colorKeyToIndex, NET_STRENGTH } from "../../config/constants";
import type { GameMap, PlayerId } from "../../core/types";
import { NetPeer } from "../../net/peer";
import { MAP_BY_ID, OFFICIAL_MAPS } from "../../state/officialMaps";
import { sanitizeMap, validateMap } from "../../state/mapValidation";
import { loadMyMaps } from "../editor/mapStorage";
import { getSettings } from "../settings/settings";
import { openSettings } from "../settings/settingsPanel";
import { assignColorIndices } from "./colorAssign";
import { LinkStats, qualityBars } from "./netStats";
import { NetTest, type TestResult } from "./netTest";
import { MapBrowser } from "../components/mapBrowser";
import { button, el } from "../components/ui";
import { CORNER_LABELS, type MatchConfig, type NetMessage, type SlotInfo, type SlotKind } from "../../net/protocol";

export interface LobbyResult {
  config: MatchConfig;
  slots: SlotInfo[];
  localPlayerId: PlayerId;
  peer: NetPeer;
  map: GameMap; // the resolved map to build (official or the host's transmitted custom map)
}

export interface LobbyHandlers {
  onSinglePlayer: () => void;
  onStartMatch: (r: LobbyResult) => void;
  onMapEditor: () => void;
  onExitToMenu?: () => void; // 20: route "back to menu" into the new screen system (main menu)
}

const NAMES = ["Host", "Player 2", "Player 3", "Player 4"];

/** Escape untrusted text (remote peer names arrive off the network) before it touches innerHTML. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Clamp a wire-supplied color preference to a valid palette index, or undefined. Applied at the
 *  trust boundary (JOIN handlers) so an unclamped value never enters slot state or the broadcast. */
function clampPref(v: unknown): number | undefined {
  return typeof v === "number" && v >= 0 && v <= 3 ? Math.floor(v) : undefined;
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
    colorIndex: i,
    corner: CORNER_LABELS[i],
    peerId: null,
    ready: false,
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
    // colorIndex is the only host-chosen visual that survives off the wire — a clamped integer index
    // into the LOCAL COLORS.players table, so no host string ever reaches the DOM/canvas (§H, XSS-safe).
    const ci = typeof o.colorIndex === "number" && o.colorIndex >= 0 && o.colorIndex <= 3 ? Math.floor(o.colorIndex) : pid;
    return {
      playerId: pid,
      kind: SLOT_KINDS.includes(o.kind as SlotKind) ? (o.kind as SlotKind) : "open",
      name: typeof o.name === "string" ? o.name.slice(0, 24) : "",
      color: COLORS.players[ci],
      colorIndex: ci,
      corner: CORNER_LABELS[pid],
      peerId: typeof o.peerId === "string" ? o.peerId : null,
      ready: o.ready === true,
    };
  });
}

export class Lobby {
  private root: HTMLElement;
  private handlers: LobbyHandlers;
  private peer: NetPeer | null = null;
  private slots: SlotInfo[] = defaultSlots();
  private seed = randomSeed();
  private mapId = "four_corners"; // 18 §C: the selected map (official id, or a custom map's id)
  private mapMax = 4;             // the current map's maxPlayers — the seat auto-close boundary
  private customMaps: GameMap[] = [];              // host: the host's saved "My Maps" (unofficial)
  private receivedMaps = new Map<string, GameMap>(); // client: full custom maps received via MAP_DATA
  private started = false;
  private chatLog: { pid: number; name: string; text: string }[] = []; // §E lobby chat scrollback
  private links = new Map<string, LinkStats>();    // §F per-peer connection quality
  private pingTimer: number | null = null;
  private netTest: NetTest | null = null;          // §G the running 10-second connection test
  private browser: MapBrowser | null = null;       // 20 §G the shared Map Browser (persists across refreshes)
  private shellBuilt = false;                       // 20: the fixed three-region shell is built once
  private myReady = false;                           // 20 §G client's own ready flag
  private netScore: number | null = null;            // 20 §G last net-test score (local, shown as a badge)

  /** The full map for an id — bundled official, host's custom, or a client's received custom. */
  private resolveMap(id: string): GameMap | null {
    return MAP_BY_ID.get(id) ?? this.customMaps.find((m) => m.id === id) ?? this.receivedMaps.get(id) ?? null;
  }
  private currentMap(): GameMap {
    return this.resolveMap(this.mapId) ?? OFFICIAL_MAPS[0];
  }

  /** Host: pick an official map and adapt the seats to its player count (18 §C/§D). Preserves the
   *  host's deliberate seat choices: a seat is only auto-reopened if it was auto-CLOSED by a prior
   *  shrink (index was beyond the OLD map's capacity), never a seat the host closed on purpose. A seat
   *  now out of range that held a client is explicitly bumped (JOIN_REJECTED) so it isn't left hanging. */
  private setMap(id: string): void {
    const map = this.resolveMap(id);
    if (!map) return;
    const oldMax = this.mapMax;
    this.mapId = id;
    const max = map.maxPlayers;
    this.mapMax = max;
    // Unofficial (custom) maps aren't bundled on clients — send the full data so they can preview/build it.
    if (!MAP_BY_ID.has(id)) this.peer?.broadcast({ t: "MAP_DATA", map });
    for (let i = 1; i < this.slots.length; i++) { // slot 0 is always the host
      const s = this.slots[i];
      if (i >= max) {
        // Beyond the new map's capacity → close it, and tell any occupant it was bumped.
        if (s.peerId) this.peer?.sendTo(s.peerId, { t: "JOIN_REJECTED", reason: "The host switched to a smaller map." });
        s.kind = "closed"; s.peerId = null; s.name = ""; s.colorPref = undefined;
      } else if (i >= oldMax) {
        // Was out of range on the previous (smaller) map, now in range → reopen for players.
        s.kind = "open"; s.name = "";
      }
      // else: in range on both maps → leave the host's explicit human/ai/open/closed choice alone.
    }
    this.slots[0].kind = "human"; // the host is always seated in slot 0
    for (const s of this.slots) if (s.kind === "human" && s.peerId) s.ready = false; // §G: re-ready on a new map
    this.broadcastLobby();
    this.renderHostLobby();
  }

  // ── Connection strength (§F) — bidirectional lobby PING/PONG per link ─────────
  private startStats(): void {
    this.pingTimer = window.setInterval(() => this.pingLinks(), NET_STRENGTH.pingIntervalMs);
  }
  private linkFor(peerId: string): LinkStats {
    let s = this.links.get(peerId);
    if (!s) { s = new LinkStats(); this.links.set(peerId, s); }
    return s;
  }
  private pingLinks(): void {
    if (!this.peer) return;
    const now = Date.now();
    const peers = this.peer.role === "host" ? this.peer.peerIds() : [this.peer.hostId];
    for (const id of [...this.links.keys()]) if (!peers.includes(id)) this.links.delete(id); // prune departed
    for (const id of peers) {
      const ls = this.linkFor(id);
      ls.expire(now);
      const tok = ls.ping(now);
      if (this.peer.role === "host") this.peer.sendTo(id, { t: "PING", ts: tok });
      else this.peer.sendToHost({ t: "PING", ts: tok });
    }
    this.refreshBars();
  }
  private handlePingPong(msg: NetMessage, from: string): boolean {
    if (msg.t === "PING") {
      if (this.peer?.role === "host") this.peer.sendTo(from, { t: "PONG", ts: msg.ts });
      else this.peer?.sendToHost({ t: "PONG", ts: msg.ts });
      return true;
    }
    if (msg.t === "PONG") { this.linkFor(from).pong(msg.ts, Date.now()); return true; }
    return false;
  }
  private refreshBars(): void {
    this.root.querySelectorAll<HTMLElement>("[data-bars]").forEach((el) => {
      const pid = el.dataset.bars ?? "";
      el.innerHTML = pid ? qualityBars(this.links.get(pid)?.quality() ?? "none") : "";
    });
  }

  // ── Lobby chat (§E) ───────────────────────────────────────────────────────────
  private sanitizeChat(text: string): string {
    return text.replace(/\s+/g, " ").trim().slice(0, CHAT.maxLength);
  }
  private addChat(pid: number, name: string, text: string): void {
    this.chatLog.push({ pid, name, text });
    if (this.chatLog.length > CHAT.scrollback) this.chatLog.shift();
    this.refreshChat();
  }
  private systemMsg(text: string): void {
    this.addChat(-1, "", text);
    this.peer?.broadcast({ t: "CHAT", playerId: -1, name: "", text, ts: Date.now() });
  }
  /** Host: stamp the sender's identity (anti-spoof) + fan the message out to everyone. */
  private relayChat(pid: number, name: string, rawText: string): void {
    const text = this.sanitizeChat(rawText);
    if (!text) return;
    this.addChat(pid, name, text);
    this.peer?.broadcast({ t: "CHAT", playerId: pid, name, text, ts: Date.now() });
  }
  private sendChat(rawText: string): void {
    const text = this.sanitizeChat(rawText);
    if (!text || !this.peer) return;
    if (this.peer.role === "host") this.relayChat(0, this.slots[0].name || "Host", text);
    else this.peer.sendToHost({ t: "CHAT", playerId: -1, name: "", text, ts: Date.now() }); // host re-stamps
  }
  private chatPanelHtml(): string {
    return `<div class="lobby-chat"><div class="chat-log" data-chatlog></div>
      <input class="chat-input" data-chatinput maxlength="${CHAT.maxLength}" placeholder="Type a message…"></div>`;
  }
  private refreshChat(): void {
    const log = this.root.querySelector<HTMLElement>("[data-chatlog]");
    if (!log) return;
    log.innerHTML = this.chatLog.map((m) => m.pid === -1
      ? `<div class="chat-sys">${esc(m.text)}</div>`
      : `<div class="chat-msg"><span class="chat-name" style="color:${COLORS.players[m.pid] ?? "#fff"}">${esc(m.name)}</span> ${esc(m.text)}</div>`).join("");
    log.scrollTop = log.scrollHeight;
  }
  private wireChat(): void {
    const input = this.root.querySelector<HTMLInputElement>("[data-chatinput]");
    if (input) input.onkeydown = (e) => { if (e.key === "Enter" && input.value.trim()) { this.sendChat(input.value); input.value = ""; } };
    this.refreshChat();
    this.refreshBars();
    const btn = this.root.querySelector<HTMLButtonElement>("[data-nettest]");
    if (btn) btn.onclick = () => this.runNetTest();
  }

  // ── 10-second connection test (§G) ────────────────────────────────────────────
  private handleNetTest(msg: NetMessage, from: string): boolean {
    if (msg.t === "NETTEST_PING") { // echo the probe straight back
      if (this.peer?.role === "host") this.peer.sendTo(from, { t: "NETTEST_PONG", id: msg.id, ts: msg.ts });
      else this.peer?.sendToHost({ t: "NETTEST_PONG", id: msg.id, ts: msg.ts });
      return true;
    }
    if (msg.t === "NETTEST_PONG") { this.netTest?.pong(msg.id, Date.now()); return true; }
    return false;
  }

  private runNetTest(): void {
    if (this.netTest || !this.peer) return;
    const target = this.peer.role === "host" ? this.peer.peerIds()[0] : this.peer.hostId;
    if (!target) { this.setNetTest(`<span class="nt-none">No peer connected to test.</span>`); return; }
    const send = (id: number, ts: number): void => {
      if (this.peer?.role === "host") this.peer.sendTo(target, { t: "NETTEST_PING", id, ts });
      else this.peer?.sendToHost({ t: "NETTEST_PING", id, ts });
    };
    this.netTest = new NetTest(
      send,
      (pct) => this.setNetTest(`<div class="nt-bar"><div class="nt-fill" style="width:${pct.toFixed(0)}%"></div></div><div class="nt-label">Measuring connection stability… ${pct.toFixed(0)}%</div>`),
      (r) => {
        this.netTest = null;
        this.setNetTest(this.netTestResultHtml(r));
        this.netScore = r.score; // §G: show a badge on your seat
        this.addChat(-1, "", `Your network test: ${r.score}% (${r.label}) — RTT ${r.latencyMs.toFixed(0)}ms, loss ${r.lossPct.toFixed(0)}%`); // posts into chat (local)
        this.refreshDynamic(this.peer?.role === "host");
      },
    );
    this.setNetTest(`<div class="nt-bar"><div class="nt-fill" style="width:0%"></div></div><div class="nt-label">Measuring connection stability… 0%</div>`);
    this.netTest.start();
  }

  private setNetTest(html: string): void {
    const el = this.root.querySelector<HTMLElement>("[data-nettest-result]");
    if (el) el.innerHTML = html;
    const btn = this.root.querySelector<HTMLButtonElement>("[data-nettest]");
    if (btn) btn.disabled = this.netTest !== null;
  }

  private netTestResultHtml(r: TestResult): string {
    const cls = r.score >= 80 ? "exc" : r.score >= 60 ? "good" : r.score >= 40 ? "fair" : "poor";
    return `<div class="nt-result ${cls}"><span class="nt-score">${r.score}%</span> <span class="nt-name">${r.label}</span>
      <div class="nt-detail">RTT ${r.latencyMs.toFixed(0)}ms · jitter ${r.jitterMs.toFixed(0)}ms · loss ${r.lossPct.toFixed(1)}%</div>
      <div class="nt-note">Measures connection <b>stability</b>, not raw speed — lockstep sends very little data.</div></div>`;
  }

  private stopNetTest(): void {
    this.netTest?.stop();
    this.netTest = null;
  }

  private netTestPanelHtml(): string {
    return `<div class="lobby-nettest">
      <button class="lobby-btn tiny" data-nettest>Test connection (10s)</button>
      <div class="nt-out" data-nettest-result></div>
    </div>`;
  }

  constructor(parent: HTMLElement, handlers: LobbyHandlers) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.className = "lobby";
    parent.appendChild(this.root);
    // 20: the new main menu replaces the old lobby menu — enter directly via hostGame()/joinGame().
    // Only fall back to the built-in menu when no screen system is wired (onExitToMenu absent).
    if (!handlers.onExitToMenu) this.showMenu();
  }

  /** 20: enter directly at the host or join flow (the new main menu owns Skirmish/Editor/Settings). */
  hostGame(): void { this.startHosting(); }
  joinGame(): void { this.showJoin(); }

  // ── Menu ────────────────────────────────────────────────────────────────────
  private showMenu(): void {
    // 20: with the new screen system wired, "back to menu" tears down the lobby and returns to the
    // fullscreen main menu instead of rendering the old placeholder menu.
    if (this.handlers.onExitToMenu) { this.destroy(); this.handlers.onExitToMenu(); return; }
    this.root.innerHTML = `
      <div class="lobby-card">
        <h1 class="lobby-title">The Fall of the Citadel</h1>
        <p class="lobby-sub">4-player free-for-all · capture the Citadel</p>
        <div class="lobby-actions">
          <button class="lobby-btn primary" data-act="sp">Single Player</button>
          <button class="lobby-btn" data-act="host">Host Online Game</button>
          <button class="lobby-btn" data-act="join">Join Online Game</button>
          <button class="lobby-btn" data-act="editor">Map Editor</button>
          <button class="lobby-btn" data-act="settings">Settings</button>
        </div>
        <p class="lobby-note">Online play is peer-to-peer over WebRTC — share the room code with friends.</p>
      </div>`;
    this.qs("[data-act=sp]").onclick = () => { this.destroy(); this.handlers.onSinglePlayer(); };
    this.qs("[data-act=host]").onclick = () => this.startHosting();
    this.qs("[data-act=join]").onclick = () => this.showJoin();
    this.qs("[data-act=editor]").onclick = () => { this.destroy(); this.handlers.onMapEditor(); };
    this.qs("[data-act=settings]").onclick = () => openSettings();
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
    this.shellBuilt = false; this.myReady = false; this.netScore = null; // 20: fresh shell
    const me = getSettings(); // §H: the host seats itself with its chosen name + preferred color
    this.slots[0].name = me.username.trim().slice(0, 20) || NAMES[0];
    this.slots[0].colorPref = colorKeyToIndex(me.preferredColor);
    this.reassignColors();
    this.customMaps = loadMyMaps(); // the host can pick their saved custom maps too (18 §D)
    this.mapMax = this.currentMap().maxPlayers; // sync the seat boundary to the starting map
    peer.onMessage = (msg, from) => this.hostOnMessage(msg, from);
    peer.onPeerLeave = (pid) => this.hostFreeSlot(pid);
    peer.onError = (err) => console.warn("[lobby] host peer error:", err.message);
    this.startStats(); // §F: begin measuring link quality to each client
    this.renderHostLobby();
  }

  private hostOnMessage(msg: NetMessage, from: string): void {
    if (this.handlePingPong(msg, from)) return; // §F strength probes
    if (this.handleNetTest(msg, from)) return; // §G connection-test probes
    if (msg.t === "CHAT") { // §E: re-stamp the sender's identity (anti-spoof) + fan out
      const s = this.slots.find((sl) => sl.peerId === from);
      this.relayChat(s ? s.playerId : -1, s?.name || "?", msg.text);
      return;
    }
    if (msg.t === "READY") { // §G: reflect the client's ready flag + rebroadcast so everyone sees it
      const s = this.slots.find((sl) => sl.peerId === from);
      if (s) { s.ready = msg.ready === true; this.broadcastLobby(); this.renderHostLobby(); }
      return;
    }
    if (msg.t !== "JOIN") return;
    const seated = this.slots.find((s) => s.peerId === from);
    if (seated) {
      // §H: a re-JOIN from an already-seated peer is a name/color update (from their Settings), not a
      // new seat. Update in place, re-resolve colors, and rebroadcast.
      seated.name = (typeof msg.name === "string" ? msg.name.slice(0, 20) : "").trim() || seated.name;
      { const cp = clampPref(msg.colorPref); if (cp !== undefined) seated.colorPref = cp; }
      this.reassignColors();
      this.broadcastLobby();
      this.renderHostLobby();
      return;
    }
    const slot = this.slots.find((s) => s.kind === "open");
    if (!slot) {
      // Room full: tell the client explicitly so it doesn't hang forever on a stale "waiting" screen.
      this.peer?.sendTo(from, { t: "JOIN_REJECTED", reason: "The room is full." });
      return;
    }
    slot.kind = "human";
    slot.peerId = from;
    slot.name = (typeof msg.name === "string" ? msg.name.slice(0, 20) : "").trim() || `Player ${slot.playerId + 1}`;
    slot.colorPref = clampPref(msg.colorPref) ?? slot.playerId; // §H requested color (clamped at the boundary)
    this.reassignColors(); // resolve any clash against already-seated players
    // If a custom (non-bundled) map is selected, the new client needs its full data to preview/build it.
    if (!MAP_BY_ID.has(this.mapId)) this.peer?.sendTo(from, { t: "MAP_DATA", map: this.currentMap() });
    this.broadcastLobby();
    this.renderHostLobby();
    this.systemMsg(`${slot.name} joined.`);
  }

  private hostFreeSlot(peerId: string): void {
    const slot = this.slots.find((s) => s.peerId === peerId);
    if (!slot) return;
    const who = slot.name;
    slot.kind = "open";
    slot.peerId = null;
    slot.name = "";
    slot.colorPref = undefined;
    this.reassignColors(); // free the departed player's color back into the pool
    this.links.delete(peerId);
    this.broadcastLobby();
    this.renderHostLobby();
    this.systemMsg(`${who} left.`);
  }

  private broadcastLobby(): void {
    this.peer?.broadcast({ t: "LOBBY_STATE", slots: this.slots, seed: this.seed, hostId: this.peer.id, mapId: this.mapId });
  }

  private renderHostLobby(): void {
    if (!this.shellBuilt) this.buildShell(true);
    this.refreshDynamic(true);
  }

  // ── 20 §G: the three-region lobby shell — built ONCE so the stateful Map Browser survives the
  // frequent slot/ready re-renders; only the dynamic region (slots + START/Ready state) refreshes. ──
  private buildShell(host: boolean): void {
    this.stopNetTest();
    this.shellBuilt = true;
    this.root.replaceChildren();
    const wrap = el("div", "screen lobby2");
    const header = el("div", "lobby2-header");
    header.append(el("h2", "screen-heading", host ? "Host Lobby" : "Lobby"));
    wrap.append(header);

    const cols = el("div", "lobby2-cols");
    // Left — the shared Map Browser (host selects; clients read-only, following the host's pick).
    const left = el("div", "lobby2-left ui-panel");
    this.browser = new MapBrowser(left, {
      readOnly: !host,
      tabs: host ? ["official", "my", "imported"] : ["official", "my"],
      selectedId: this.mapId,
      extraMaps: () => [...this.receivedMaps.values(), ...this.customMaps],
      onSelect: host ? (m) => this.setMap(m.id) : undefined,
      onOpenEditor: undefined,
    });
    // Center — player slots.
    const center = el("div", "lobby2-center ui-panel");
    center.append(el("div", "ui-panel-title", "Players"));
    const slots = el("div", "lobby2-slots"); slots.dataset.slots = "";
    center.append(slots);
    // Right — chat + tools.
    const right = el("div", "lobby2-right ui-panel");
    right.innerHTML = `<div class="ui-panel-title">Chat</div>${this.chatPanelHtml()}${this.netTestPanelHtml()}`;
    cols.append(left, center, right);
    wrap.append(cols);

    // Bottom bar — room code (host) + primary action (START host / Ready client) + Leave/Settings.
    const bottom = el("div", "lobby2-bottom");
    if (host) {
      const room = this.peer?.id ?? "";
      const code = el("div", "lobby2-room");
      code.append(el("span", "lobby2-room-label", "Room code"), el("code", "lobby2-room-code", room),
        button({ label: "Copy", kind: "secondary", onClick: () => navigator.clipboard?.writeText(room).catch(() => {}) }));
      bottom.append(code);
    } else {
      bottom.append(el("div", "lobby2-room"));
    }
    const actions = el("div", "lobby2-actions");
    actions.append(button({ label: "Leave", kind: "ghost", onClick: () => { this.leave(); this.showMenu(); } }));
    actions.append(button({ label: "Settings", kind: "secondary", onClick: () => openSettings(() => (host ? this.applyHostSettings() : this.sendClientIdentity())) }));
    if (host) {
      const start = button({ label: "Start Match", kind: "primary", onClick: () => this.hostStart() });
      start.dataset.start = "";
      actions.append(start);
    } else {
      const ready = button({ label: "Ready", kind: "primary", onClick: () => this.toggleReady() });
      ready.dataset.ready = "";
      actions.append(ready);
    }
    bottom.append(actions);
    wrap.append(bottom);

    this.root.append(wrap);
    this.wireChat();
  }

  /** Refresh only the mutable parts (slots + START/Ready state + bars); the shell + Map Browser persist. */
  private refreshDynamic(host: boolean): void {
    const slotsEl = this.root.querySelector<HTMLElement>("[data-slots]");
    if (slotsEl) slotsEl.replaceChildren(...this.slots.map((s, i) => this.slotNode(s, i, host)));
    if (host) {
      const start = this.root.querySelector<HTMLButtonElement>("[data-start]");
      if (start) { const reason = this.startReason(); start.disabled = !!reason; start.classList.toggle("is-disabled", !!reason); start.title = reason; }
    } else {
      this.browser?.setSelected(this.mapId); // follow the host's selection
      const ready = this.root.querySelector<HTMLButtonElement>("[data-ready]");
      if (ready) { ready.classList.toggle("on", this.myReady); const lbl = ready.querySelector(".ui-btn-label"); if (lbl) lbl.textContent = this.myReady ? "Ready ✓" : "Ready"; }
    }
    this.refreshBars();
  }

  /** Why the host's START is disabled (empty string = enabled). */
  private startReason(): string {
    const v = validateMap(this.currentMap());
    if (!v.ok) return `Map invalid: ${v.errors[0]}`;
    const clients = this.slots.filter((s) => s.kind === "human" && s.peerId);
    if (clients.some((s) => !s.ready)) return "Waiting for all players to ready up";
    return "";
  }

  /** 20 §G: a player-slot row — swatch, name, host crown, ready ✓, net bars/badge, host controls. */
  private slotNode(s: SlotInfo, i: number, host: boolean): HTMLElement {
    const row = el("div", `lobby2-slot ${s.kind === "human" ? "human" : s.kind === "ai" ? "ai" : "empty"}`);
    const sw = el("span", "lobby2-swatch");
    sw.style.background = COLORS.players[s.colorIndex] ?? COLORS.players[s.playerId] ?? "#888";
    row.append(sw);

    const isHostSeat = i === 0; // the host occupies slot 0
    const you = (s.peerId && s.peerId === this.peer?.id) || (isHostSeat && host);
    const name = el("span", "lobby2-name");
    name.textContent = s.kind === "human" ? `${s.name}${you ? " (you)" : ""}` : s.kind === "ai" ? "Computer (AI)" : s.kind === "closed" ? "Closed" : "Open";
    if (isHostSeat) name.append(el("span", "lobby2-crown", " ♛"));
    row.append(name);

    const right = el("div", "lobby2-slot-right");
    // Ready check for human clients (not the host).
    if (s.kind === "human" && s.peerId) right.append(el("span", `lobby2-ready${s.ready ? " on" : ""}`, s.ready ? "✓ Ready" : "…"));
    // Net-test badge for your own seat, if you've run one.
    if (you && this.netScore != null) right.append(el("span", "lobby2-netbadge", `${this.netScore}%`));
    // Network-strength bars: the host sees each client's link; a client sees its link to the host.
    const barPeer = host ? (s.kind === "human" && s.peerId ? s.peerId : "") : (isHostSeat ? this.peer?.hostId ?? "" : "");
    if (barPeer) { const b = el("span", "lobby2-bars"); b.dataset.bars = barPeer; right.append(b); }
    // Host controls: AI toggle on empty in-range seats; kick on client seats.
    if (host && i < this.currentMap().maxPlayers) {
      if (s.kind !== "human") right.append(button({ label: s.kind === "ai" ? "AI" : s.kind === "closed" ? "Closed" : "Open", kind: "secondary", className: "lobby2-mini", onClick: () => this.cycleSlot(i) }));
      else if (s.peerId) right.append(button({ label: "Kick", kind: "ghost", className: "lobby2-mini", onClick: () => this.kick(i) }));
    }
    row.append(right);
    return row;
  }

  /** 20 §G host: kick a seated client — tell it, then free the seat. */
  private kick(i: number): void {
    const s = this.slots[i];
    if (!s.peerId) return;
    this.peer?.sendTo(s.peerId, { t: "JOIN_REJECTED", reason: "You were removed by the host." });
    this.hostFreeSlot(s.peerId);
  }

  /** 20 §G client: flip my ready flag and tell the host. */
  private toggleReady(): void {
    this.myReady = !this.myReady;
    this.peer?.sendToHost({ t: "READY", ready: this.myReady });
    this.refreshDynamic(false);
  }

  private cycleSlot(i: number): void {
    const order: SlotKind[] = ["open", "ai", "closed"];
    const s = this.slots[i];
    if (s.kind === "human" || i >= this.currentMap().maxPlayers) return;
    s.kind = order[(order.indexOf(s.kind) + 1) % order.length];
    s.name = s.kind === "ai" ? "Computer" : "";
    if (s.kind !== "human") s.colorPref = undefined; // a vacated seat no longer holds a player's request
    this.reassignColors();
    this.broadcastLobby();
    this.renderHostLobby();
  }

  /** §H host: give every seat a distinct palette color (see assignColorIndices) and mirror the
   *  resolved index into each slot's colorIndex + color string. Host-only. */
  private reassignColors(): void {
    const idx = assignColorIndices(this.slots);
    this.slots.forEach((s, i) => { s.colorIndex = idx[i]; s.color = COLORS.players[idx[i]]; });
  }

  private hostStart(): void {
    // Never start a match on a map that would seat a player with no base (invalid custom map from
    // hand-edited storage / gaps in start slots). Official + editor-saved maps always pass.
    const map = this.currentMap();
    const v = validateMap(map);
    if (!v.ok) { window.alert(`Can't start — map "${map.name}" is invalid: ${v.errors[0]}`); return; }
    // Freeze the roster: any still-open in-range seat fills with AI; seats beyond the map's player
    // count stay closed (fewer than 4 players). Closed seats are never filled.
    for (const s of this.slots) if (s.kind === "open") { s.kind = "ai"; s.name = "Computer"; s.colorPref = undefined; }
    const config: MatchConfig = { mapId: this.mapId, seed: this.seed, terrain: true };
    this.started = true;
    this.peer?.broadcast({ t: "START", config, slots: this.slots });
    this.enterMatch(config, this.slots, 0, this.currentMap());
  }

  // ── Join / client ───────────────────────────────────────────────────────────
  private showJoin(): void {
    this.root.innerHTML = `
      <div class="lobby-card">
        <h1 class="lobby-title">Join Game</h1>
        <label class="lobby-field"><span>Your name</span><input data-name maxlength="20" value="${esc(getSettings().username)}" /></label>
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
    this.shellBuilt = false; this.myReady = false; this.netScore = null; // 20: fresh shell
    peer.onMessage = (msg) => this.clientOnMessage(msg);
    peer.onPeerLeave = () => { if (!this.started) this.showError("Host disconnected.", () => this.showMenu()); };
    peer.onError = (err) => console.warn("[lobby] client peer error:", err.message);
    peer.sendToHost({ t: "JOIN", name, colorPref: colorKeyToIndex(getSettings().preferredColor) }); // §H
    this.startStats(); // §F: measure the link to the host
    this.renderClientLobby();
  }

  private clientOnMessage(msg: NetMessage): void {
    if (this.handlePingPong(msg, this.peer?.hostId ?? "")) return; // §F strength probes
    if (this.handleNetTest(msg, this.peer?.hostId ?? "")) return; // §G connection-test probes
    if (msg.t === "CHAT") { this.addChat(msg.playerId, (typeof msg.name === "string" ? msg.name : "?").slice(0, 20), this.sanitizeChat(typeof msg.text === "string" ? msg.text : "")); return; }
    if (msg.t === "JOIN_REJECTED") {
      this.showError(msg.reason || "The host declined the connection.", () => this.showMenu());
    } else if (msg.t === "MAP_DATA") {
      // A host's custom map, off the wire → sanitize before storing/rendering (can't trust the shape).
      const m = sanitizeMap(msg.map);
      if (m) { this.receivedMaps.set(m.id, m); this.browser?.refresh(); } // now resolvable in the browser details
    } else if (msg.t === "LOBBY_STATE") {
      this.slots = sanitizeSlots(msg.slots); // never trust wire data straight into the DOM/sim
      this.seed = Number(msg.seed) >>> 0;
      if (typeof msg.mapId === "string") this.mapId = msg.mapId; // official id, or a custom id (data via MAP_DATA)
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
      const wantId = typeof msg.config?.mapId === "string" ? msg.config.mapId : this.mapId;
      const map = this.resolveMap(wantId);
      if (!map) {
        // Custom map data never arrived — building a different world would desync. Bail instead.
        this.showError("The host's custom map wasn't received — can't start.", () => this.showMenu());
        return;
      }
      if (!validateMap(map).ok) {
        // Defend against a hostile/buggy host: don't boot into a map that would seat us with no base.
        this.showError("The host's map failed validation — can't start.", () => this.showMenu());
        return;
      }
      this.started = true;
      this.enterMatch({ mapId: wantId, seed: Number(msg.config?.seed) >>> 0, terrain: msg.config?.terrain !== false }, slots, mine.playerId, map);
    }
  }

  private renderClientLobby(): void {
    if (!this.shellBuilt) this.buildShell(false);
    this.refreshDynamic(false);
  }

  /** §H host: re-seat myself (slot 0) from the current settings, then rebroadcast. */
  private applyHostSettings(): void {
    const me = getSettings();
    this.slots[0].name = me.username.trim().slice(0, 20) || NAMES[0];
    this.slots[0].colorPref = colorKeyToIndex(me.preferredColor);
    this.reassignColors();
    this.broadcastLobby();
    this.renderHostLobby();
  }

  /** §H client: push my current name/color to the host (a re-JOIN it treats as an update). */
  private sendClientIdentity(): void {
    const me = getSettings();
    this.peer?.sendToHost({ t: "JOIN", name: me.username.trim().slice(0, 20) || "Player", colorPref: colorKeyToIndex(me.preferredColor) });
  }

  private enterMatch(config: MatchConfig, slots: SlotInfo[], localPlayerId: PlayerId, map: GameMap): void {
    const peer = this.peer;
    if (!peer) return;
    this.stopStats(); // the peer now belongs to NetworkSession — stop the lobby's PING loop
    this.stopNetTest();
    this.root.remove();
    this.handlers.onStartMatch({ config, slots, localPlayerId, peer, map });
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
    this.stopStats();
    this.stopNetTest();
    this.peer?.close();
    this.peer = null;
    this.slots = defaultSlots();
    this.chatLog = [];
    this.links.clear();
    this.started = false;
    this.browser?.destroy();
    this.browser = null;
    this.shellBuilt = false;
    this.myReady = false;
    this.netScore = null;
  }

  private stopStats(): void {
    if (this.pingTimer !== null) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  private destroy(): void {
    this.stopStats();
    this.root.remove();
  }

  private qs(sel: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(sel)!;
  }
}
