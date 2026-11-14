// The owner's side of the crew room: the app listens and posts with the owner key.
import { NostrChannel, DEFAULT_RELAYS } from "@scut/channels";
import { appendFile } from "node:fs/promises";
import { HOME, type Scut } from "./core.ts";

export type CrewLine = { from: string; name: string; text: string; ts: number };

export class CrewRoom {
  lines: CrewLine[] = [];
  private chan: NostrChannel;
  constructor(private scut: Scut, relays = DEFAULT_RELAYS) {
    this.chan = new NostrChannel(scut.ownerSk, relays, `${HOME}/crew-cursor`);
  }
  async start() {
    try {
      const raw = await Bun.file(`${HOME}/crew.jsonl`).text();
      this.lines = raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).slice(-300);
    } catch {}
    this.chan.onCrew = (m) => this.add({ from: m.from, name: this.name(m.from), text: m.text, ts: m.ts });
    this.chan.start(() => {}, () => {});
  }
  private name(pubkey: string) {
    return this.scut.crewMembers().find((c) => c.pubkey === pubkey)?.name ?? pubkey.slice(0, 8);
  }
  private add(l: CrewLine) {
    if (this.lines.some((x) => x.ts === l.ts && x.from === l.from && x.text === l.text)) return;
    this.lines.push(l);
    appendFile(`${HOME}/crew.jsonl`, JSON.stringify(l) + "\n").catch(() => {});
  }
  async post(text: string) {
    const members = this.scut.crewMembers().map((m) => m.pubkey);
    this.add({ from: this.scut.ownerPubkey, name: "You", text, ts: Date.now() });
    await this.chan.sendCrew(members, text);
  }
}
