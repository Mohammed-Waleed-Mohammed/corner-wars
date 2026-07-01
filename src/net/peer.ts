// PeerJS wrapper (17-multiplayer §5.1) for the star topology: the HOST's peer id IS the room id;
// clients connect to it and send only to the host; the host keeps every client connection and
// relays. This module hides PeerJS lifecycle behind host()/join()/broadcast()/sendToHost() plus
// onMessage/onPeerJoin/onPeerLeave, so lobby.ts and (M4) NetworkSession never touch PeerJS directly.
//
// ICE (STUN/TURN) comes from NET.ICE in config (§7). WebRTC is browser-only — nothing here is
// imported by the DOM-free engine, so the headless sim/replay tests are unaffected.

import { Peer } from "peerjs";
import type { DataConnection } from "peerjs";
import { NET } from "../config/constants";
import { isNetMessage, type NetMessage } from "./protocol";

export type PeerRole = "host" | "client";

const JOIN_TIMEOUT_MS = 15000; // give up dialing a room id after this (bad id / host offline)

export class NetPeer {
  readonly role: PeerRole;
  readonly id: string;      // this peer's own id
  readonly hostId: string;  // the room id (for the host, === id)

  // Consumers set these after construction. fromPeerId lets the host tell clients apart.
  onMessage: ((msg: NetMessage, fromPeerId: string) => void) | null = null;
  onPeerJoin: ((peerId: string) => void) | null = null;
  onPeerLeave: ((peerId: string) => void) | null = null;
  onError: ((err: Error) => void) | null = null;

  private peer: Peer;
  private conns = new Map<string, DataConnection>(); // host: all clients; client: just the host
  private destroyed = false;

  private constructor(peer: Peer, id: string, role: PeerRole, hostId: string) {
    this.peer = peer;
    this.id = id;
    this.role = role;
    this.hostId = hostId;
    // Post-open peer errors are non-fatal to us here (e.g. a client vanished) — surface, don't throw.
    peer.on("error", (err) => this.onError?.(err as unknown as Error));
    // A signalling-socket blip → try to recover. But close()/destroy() ALSO emits "disconnected"
    // synchronously (before PeerJS marks the peer destroyed), so guard on our own flag — otherwise
    // reconnect() reopens the very socket we're tearing down, leaking a zombie connection.
    peer.on("disconnected", () => { if (!this.destroyed) this.peer.reconnect(); });
  }

  /** Create a room. Resolves once we hold a peer id (the room id clients will dial). */
  static host(): Promise<NetPeer> {
    return new Promise((resolve, reject) => {
      const peer = new Peer({ config: NET.ICE });
      let opened = false;
      peer.on("open", (id) => {
        opened = true;
        const np = new NetPeer(peer, id, "host", id);
        peer.on("connection", (conn) => np.acceptConnection(conn));
        resolve(np);
      });
      peer.on("error", (err) => {
        if (!opened) { peer.destroy(); reject(err as unknown as Error); } // failed before we got an id
      });
    });
  }

  /** Join an existing room by id. Resolves once the data channel to the host is open. */
  static join(roomId: string): Promise<NetPeer> {
    return new Promise((resolve, reject) => {
      const peer = new Peer({ config: NET.ICE });
      let settled = false;
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        peer.destroy();
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error("Could not reach room — check the code or the host is offline.")), JOIN_TIMEOUT_MS);
      peer.on("open", (myId) => {
        const conn = peer.connect(roomId, { reliable: true, serialization: "json" });
        conn.on("open", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const np = new NetPeer(peer, myId, "client", roomId);
          np.registerConnection(conn);
          resolve(np);
        });
        conn.on("error", (err) => fail(err as unknown as Error));
      });
      peer.on("error", (err) => fail(err as unknown as Error));
    });
  }

  /** Host: wire an incoming client connection. `conn.peer` is that client's id. */
  private acceptConnection(conn: DataConnection): void {
    conn.on("open", () => {
      if (this.destroyed) { conn.close(); return; }
      this.conns.set(conn.peer, conn);
      this.onPeerJoin?.(conn.peer);
    });
    conn.on("data", (data) => { if (isNetMessage(data)) this.onMessage?.(data, conn.peer); });
    conn.on("close", () => {
      if (this.conns.delete(conn.peer)) this.onPeerLeave?.(conn.peer);
    });
    conn.on("error", (err) => this.onError?.(err as unknown as Error));
  }

  /** Client: wire the single connection to the host. */
  private registerConnection(conn: DataConnection): void {
    this.conns.set(conn.peer, conn); // conn.peer === hostId
    conn.on("data", (data) => { if (isNetMessage(data)) this.onMessage?.(data, conn.peer); });
    conn.on("close", () => {
      if (this.conns.delete(conn.peer)) this.onPeerLeave?.(conn.peer); // host dropped
    });
    conn.on("error", (err) => this.onError?.(err as unknown as Error));
  }

  /** Host → every connected client (skips channels not yet open). */
  broadcast(msg: NetMessage): void {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  /** Client → the host. */
  sendToHost(msg: NetMessage): void {
    const c = this.conns.get(this.hostId);
    if (c?.open) c.send(msg);
  }

  /** Host → one specific client by id. */
  sendTo(peerId: string, msg: NetMessage): void {
    const c = this.conns.get(peerId);
    if (c?.open) c.send(msg);
  }

  /** Ids of the currently-connected peers (host: clients; client: just the host). */
  peerIds(): string[] {
    return [...this.conns.keys()];
  }

  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.peer.destroy();
  }
}
