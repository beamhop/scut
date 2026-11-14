// Pieces shared by Settings and the Create flow: brain names, prices in euros, choice tiles, notices.
import { useId, type ReactNode } from "react";
import { CheckCircleIcon, CircleIcon, WarningCircleIcon, type Icon } from "@phosphor-icons/react";
import { PRESETS } from "./lib.tsx";
import { cx, usdToEur } from "./ui/index.ts";

/** Where to get a key, per provider. */
export const KEY_URL: Record<string, string> = {
  openrouter: "https://openrouter.ai/keys",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
};

/** One line on each brain provider, in the person's terms. */
export const PROVIDER_NOTE: Record<string, string> = {
  openrouter: "One key for most models. Pay as you go.",
  openai: "GPT models with an OpenAI key.",
  anthropic: "Claude models with an Anthropic key.",
  ollama: "Free. Runs on this computer.",
};

/** Subscription brains: the agent signs in on its own screen, no key. */
export const SUBSCRIPTIONS = [
  { harness: "codex", label: "ChatGPT", note: "Plus, Pro or Team, through Codex" },
  { harness: "copilot", label: "GitHub Copilot", note: "Any Copilot plan, through Copilot CLI" },
] as const;

/** Which preset an endpoint belongs to. */
export function providerOf(baseUrl?: string): string | undefined {
  if (!baseUrl) return undefined;
  return Object.entries(PRESETS).find(([, p]) => p.baseUrl === baseUrl)?.[0]
    ?? (/openrouter\.ai/.test(baseUrl) ? "openrouter" : /api\.openai\.com/.test(baseUrl) ? "openai" : /anthropic\.com/.test(baseUrl) ? "anthropic" : /:11434\b/.test(baseUrl) ? "ollama" : undefined);
}

const WORD: Record<string, string> = { gpt: "GPT", ai: "AI", oss: "OSS", llama: "Llama", qwen: "Qwen" };
/** "anthropic/claude-haiku-5.5" → "Claude Haiku 5.5" · "gpt-5.6-luna" → "GPT-5.6 Luna" · "qwen3.8:8b" → "Qwen3.8 8B". */
export function modelName(id?: string): string {
  if (!id) return "No model";
  const base = id.split("/").pop()!.replace(/:free$/, "");
  const parts = base.split(/[-_:\s]+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (/^\d+$/.test(p) && prev && /\d$/.test(prev) && !/[a-z]$/i.test(prev)) out[out.length - 1] = `${prev}.${p}`; // 5-5 → 5.5
    else if (/^\d+(\.\d+)?b$/i.test(p)) out.push(p.toUpperCase()); // 8b → 8B
    else if (WORD[p.toLowerCase()]) out.push(WORD[p.toLowerCase()]);
    else out.push(p.charAt(0).toUpperCase() + p.slice(1));
  }
  // GPT 5.6 → GPT-5.6 (how OpenAI writes it)
  return out.join(" ").replace(/^GPT (\d)/, "GPT-$1");
}

/** "Claude Haiku 5.5 (OpenRouter)" — the brain in words. */
export function brainLabel(m?: { baseUrl?: string; model: string }, harness?: string): string {
  if (harness === "mock") return "Demo (no brain)";
  const sub = SUBSCRIPTIONS.find((s) => s.harness === harness);
  if (sub && !m?.baseUrl) return `${sub.label} subscription`;
  if (!m) return "None yet";
  const p = providerOf(m.baseUrl);
  const where = p ? PRESETS[p].label : m.baseUrl ? hostOf(m.baseUrl) : "";
  return where ? `${modelName(m.model)} (${where})` : modelName(m.model);
}

export function hostOf(url: string) {
  try { return new URL(url).host; } catch { return url; }
}

// ---------------- money ----------------
// Agent work is mostly reading (input); 80/20 is what the agents measure in practice.
export const blendUsdPerM = (price: { in: number; out: number }) => price.in * 0.8 + price.out * 0.2;
export const tokensToEur = (tokens: number, price: { in: number; out: number }) => usdToEur((tokens * blendUsdPerM(price)) / 1e6);
export function eurToTokens(eur: number, price: { in: number; out: number }) {
  const perM = usdToEur(blendUsdPerM(price));
  if (!perM) return 0;
  return Math.round((eur / perM) * 1e6 / 1000) * 1000;
}
/** "1,50" or "€1.50" → 1.5 (NaN when it isn't a number). */
export function parseEuro(s: string): number {
  const v = s.replace(/[€\s]/g, "").replace(",", ".");
  return v === "" ? 0 : Number(v);
}

// ---------------- choice tiles ----------------

/**
 * A radio that looks like a tile: title, one line under it, and a check shape when chosen (so the choice is never
 * shown by colour or border alone). Put several in a <fieldset> with a <legend>.
 */
export function ChoiceTile({ name, value, checked, onChange, title, note, icon: I, badge, disabled, className, size = "md" }: {
  name: string; value: string; checked: boolean; onChange: (v: string) => void; title: ReactNode; note?: ReactNode; icon?: Icon;
  badge?: ReactNode; disabled?: boolean; className?: string; size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <label
      className={cx(
        "group relative flex min-w-0 gap-2.5 rounded-unit border bg-surface text-left transition-colors duration-(--dur-press)",
        size === "sm" ? "px-3 py-2" : "p-3",
        checked ? "border-ink shadow-[inset_0_0_0_1px_var(--color-ink)]" : "border-line-strong hover:bg-surface-2",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus has-[:focus-visible]:outline",
        disabled && "cursor-not-allowed opacity-45",
        className,
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={() => onChange(value)}
        aria-describedby={note ? `${id}-n` : undefined} className="peer sr-only" />
      {I && <I size={20} weight={checked ? "fill" : "regular"} aria-hidden className={cx("mt-px shrink-0", checked ? "text-ink" : "text-ink-2")} />}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cx("font-medium text-ink", size === "sm" ? "text-body" : "text-ui-lg")}>{title}</span>
          {badge}
        </span>
        {note && <span id={`${id}-n`} className="mt-0.5 block text-small text-ink-2">{note}</span>}
      </span>
      {checked
        ? <CheckCircleIcon size={18} weight="fill" aria-hidden className="mt-px shrink-0 text-ink" />
        : <CircleIcon size={18} aria-hidden className="mt-px shrink-0 text-line-strong" />}
    </label>
  );
}

/** An inline message. `alert` makes it a role=alert (only for answers to something the person just did). */
export function Notice({ tone = "err", alert, children, action, className }: { tone?: "err" | "info" | "needs"; alert?: boolean; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={alert ? "alert" : undefined}
      className={cx(
        "flex items-start gap-2 rounded-control border px-3 py-2 text-body",
        tone === "err" ? "border-err/40 bg-surface text-ink" : tone === "needs" ? "border-signal/40 bg-signal-wash text-ink" : "border-line bg-surface-2 text-ink",
        className,
      )}>
      {tone !== "info" && <WarningCircleIcon size={16} weight="bold" aria-hidden className={cx("mt-0.5 shrink-0", tone === "err" ? "text-err" : "text-signal-ink")} />}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}
