import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServerMsg, AgentState, Schedule, MemoryItem, TaskRun, StatusMsg } from "@scut/protocol";
import { nip19 } from "nostr-tools";
import qrcode from "qrcode-generator";
import { Instance, Agent, Destination, api, SCREEN, MASCOT_COLORS, BEAM_STAGES, STAGE_LABEL, ChatLine, Approval, type ResolvedApproval, Settings, Pairing, Mascot, humanize, needsText, cost, STATE_META, StateChip, plural, bytesLabel, TEMPLATES, HARNESSES, PRESETS, npubToHex, KEYMAP, TELEGRAM_SETUP, CLOUD_SETUP, ago, Cursor, Toast, useToasts, helpOn, PROVIDERS, standaloneAgent } from "./lib.tsx";
import { BeamMenu, ExportDialog, ImportDialog, BeamReceipt, BeamProgress } from "./beam.tsx";
import { Tile, AutostartToggle, Dock, AddCloud, CrewRoomPanel, App, SoloAgent, CrewApp } from "./crew.tsx";
import { CreateAgent } from "./create.tsx";
import { AgentView, TelegramPairQr, PhoneLink } from "./agentView.tsx";
import { SettingsPanel, BrainSettings, PersonaSettings, RemoveAgent, safetyItems, SafetyCheck, SkillSettings, MemoryText, MemorySettings, ChannelStatus, ChannelSettings, SecretRow, RecentRuns, Schedules } from "./settings.tsx";

export function useAgent(agent: Agent | undefined, frames: boolean, fps = 8, small = false) {
  const [frame, setFrame] = useState<string>();
  const [state, setState] = useState<AgentState>("starting");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [narration, setNarration] = useState<{ text: string; ts: number }[]>([]);
  const [stats, setStats] = useState<Extract<ServerMsg, { t: "stats" }>>();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  /** Bench data (t:"status"): headline, since, task, lastResult, nextRun, pending, dayTokens. */
  const [status, setStatus] = useState<StatusMsg>();
  /** When the current state began (from state.since or status.since). */
  const [since, setSince] = useState<number>();
  /** Recently decided approvals, newest last (max 20), for resolution echoes. */
  const [resolved, setResolved] = useState<ResolvedApproval[]>([]);
  const approvalsRef = useRef(approvals);
  approvalsRef.current = approvals;
  const notified = useRef(new Set<string>());
  const [agentCursor, setAgentCursor] = useState<{ x: number; y: number }>();
  const [settings, setSettings] = useState<Settings>();
  const [pairing, setPairing] = useState<Pairing>();
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const lastRun = useRef<string | undefined>(undefined);
  const [skills, setSkills] = useState<{ items: { name: string; description: string }[]; error?: string }>({ items: [] });
  const ws = useRef<WebSocket | null>(null);
  const outbox = useRef<string[]>([]);
  const endpoint = agent?.current.endpoint;
  const tokenRef = useRef(agent?.token);
  tokenRef.current = agent?.token;
  const token = agent?.token ? "y" : "";
  const beaming = !!agent?.beam && !["online", "failed"].includes(agent.beam.stage);

  useEffect(() => {
    if (!endpoint || !token || beaming) return;
    let closed = false;
    let url: string | undefined;
    let sock: WebSocket;
    const connect = () => {
      sock = new WebSocket(`${endpoint.replace(/^http/, "ws")}/ws?auth=${tokenRef.current}`);
      sock.binaryType = "blob";
      ws.current = sock;
      sock.onopen = () => {
        setConnected(true);
        sock.send(JSON.stringify({ t: "subscribe", frames, fps, small, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }));
        for (const m of outbox.current.splice(0)) sock.send(m);
      };
      sock.onmessage = (ev) => {
        if (ev.data instanceof Blob) {
          const next = URL.createObjectURL(ev.data);
          setFrame(next);
          if (url) URL.revokeObjectURL(url);
          url = next;
          return;
        }
        const m = JSON.parse(ev.data) as ServerMsg;
        if (m.t === "hello" || m.t === "state") {
          setState(m.state);
          if (m.t === "state" && m.since) setSince(m.since);
          // On (re)connect the agent resends every approval still pending; start from a clean list so none doubles up.
          if (m.t === "hello") { approvalsRef.current = []; setApprovals([]); }
        }
        else if (m.t === "status") { setStatus(m); setSince(m.since); setState(m.state); }
        else if (m.t === "history") { setChat(m.chat); setNarration(m.narration); }
        else if (m.t === "chat") setChat((c) => [...c.slice(-300), m]);
        else if (m.t === "narration") setNarration((n) => [...n.slice(-150), m]);
        else if (m.t === "stats") setStats(m);
        else if (m.t === "settings") setSettings(m);
        else if (m.t === "pairing") setPairing(m);
        else if (m.t === "paused") setPaused(m.paused);
        else if (m.t === "schedules") setSchedules(m.schedules);
        else if (m.t === "memory") setMemory(m.items);
        else if (m.t === "runs") {
          // A scheduled task finished while you were elsewhere: say so (first message on connect is history, not news).
          const latest = m.items.at(-1);
          if (latest && lastRun.current !== undefined && latest.id !== lastRun.current && document.hidden && "Notification" in window && Notification.permission === "granted")
            new Notification(`${agent?.name}: ${latest.ok ? "done" : "couldn't finish"} — ${latest.prompt.slice(0, 60)}`, { body: latest.result.slice(0, 160) });
          lastRun.current = latest?.id ?? "";
          setRuns(m.items);
        }
        else if (m.t === "skills") setSkills({ items: m.items, error: m.error });
        else if (m.t === "cloud.key") {
          fetch("/api/providers", { method: "POST", body: JSON.stringify({ id: m.provider, token: m.token }) })
            .then((r) => r.json())
            .then((r) => window.dispatchEvent(new CustomEvent("scut:cloud", { detail: { provider: m.provider, ok: !r.error, error: r.error } })))
            .catch(() => {});
        }
        else if (m.t === "cursor" && m.who === "agent") setAgentCursor({ x: m.x, y: m.y });
        else if (m.t === "approval.request") {
          if (!approvalsRef.current.some((x) => x.id === m.id)) approvalsRef.current = [...approvalsRef.current, m];
          setApprovals((a) => (a.some((x) => x.id === m.id) ? a : [...a, m]));
          if (!notified.current.has(m.id) && (notified.current.add(m.id), true) && "Notification" in window && Notification.permission === "granted") new Notification(`${agent?.name} needs you`, { body: m.title });
        } else if (m.t === "approval.resolved") {
          const was = approvalsRef.current.find((x) => x.id === m.id);
          if (was) setResolved((r) => [...r.slice(-19), { ...was, ok: m.ok, by: m.by, via: m.via, at: m.at ?? Date.now() }]);
          setApprovals((a) => a.filter((x) => x.id !== m.id));
        }
      };
      sock.onclose = () => { setConnected(false); if (!closed) setTimeout(connect, 1500); };
    };
    connect();
    return () => {
      closed = true;
      sock?.close();
      if (url) URL.revokeObjectURL(url);
    };
  }, [endpoint, token, frames, beaming, small]);

  // Queue messages typed before the socket is open (or while it reconnects) instead of dropping them.
  const send = useCallback((m: unknown) => {
    if (ws.current?.readyState === 1) ws.current.send(JSON.stringify(m));
    else outbox.current.push(JSON.stringify(m));
  }, []);
  return { frame, state, chat, narration, stats, approvals, agentCursor, settings, pairing, connected, paused, schedules, memory, skills, runs, send, status, since, resolved };
}
