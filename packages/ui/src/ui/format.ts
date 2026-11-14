/**
 * Human formatting. Money, never tokens; periods, always ("€0.42 today", "~€6/month"). Locale-aware (nl-NL uses
 * comma decimals). Every live number these return should be rendered with `tabular-nums`.
 */

const locale = () => (typeof navigator !== "undefined" && navigator.language) || "en-GB";
const nf = new Map<string, Intl.NumberFormat>();
function fmt(key: string, opts: Intl.NumberFormatOptions) {
  const k = locale() + key;
  let f = nf.get(k);
  if (!f) nf.set(k, (f = new Intl.NumberFormat(locale(), opts)));
  return f;
}

/** Approximate rate for showing provider prices quoted in USD as euros. Update when it drifts. */
export const EUR_PER_USD = 0.86;
export const usdToEur = (usd: number) => usd * EUR_PER_USD;

export type Period = "today" | "day" | "month" | "hour" | "year" | "each";
export type MoneyOpts = {
  /** "today" → "€0.42 today"; "month" → "€6/month"; "each" → "€21 each". */
  period?: Period;
  /** Prefix with "~" for estimates. */
  approx?: boolean;
  /** What to say for exactly 0 (e.g. "free"). Default "€0.00". */
  zero?: string;
  /** Force whole euros (default: whole euros from €100 up, or from €10 up for approx estimates). */
  whole?: boolean;
};

/** €0.42 today · ~€21/month · <€0.01 today · free */
export function money(eur: number, o: MoneyOpts = {}): string {
  if (!Number.isFinite(eur)) eur = 0;
  if (eur === 0 && o.zero) return o.zero;
  const whole = o.whole ?? (Math.abs(eur) >= 100 || (!!o.approx && Math.abs(eur) >= 10));
  let s: string;
  if (eur > 0 && eur < 0.005) s = "<" + fmt("eur2", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(0.01);
  else s = fmt(whole ? "eur0" : "eur2", { style: "currency", currency: "EUR", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(eur);
  if (o.approx) s = "~" + s;
  switch (o.period) {
    case "today": return `${s} today`;
    case "each": return `${s} each`;
    case undefined: return s;
    default: return `${s}/${o.period}`;
  }
}

/** Cost in euros of a token count at a $/1M-token price (as the app API returns it). */
export function tokensEur(t: { input: number; output: number }, price: { in: number; out: number }) {
  return usdToEur((t.input * price.in + t.output * price.out) / 1e6);
}

/** 1,234 / 1.234 (nl) — grouped, tabular-friendly. */
export function num(n: number, digits = 0) {
  return fmt(`n${digits}`, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

/** 1.2K · 3.4M · 950 */
export function compact(n: number) {
  return fmt("compact", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** 42% */
export function percent(fraction: number, digits = 0) {
  return fmt(`p${digits}`, { style: "percent", maximumFractionDigits: digits }).format(fraction);
}

/** Stopwatch: 01:42 · 12:05 · 1:02:03 */
export function duration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

/** Words: 11 s · 4 min · 2 h 5 min · 3 days */
export function durationWords(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`;
  return plural(Math.round(h / 24), "day");
}

/** just now · 2 min ago · 3 h ago · yesterday · 12 Nov */
export function relativeTime(ts: number, now = Date.now()) {
  const d = now - ts;
  if (d < 45_000) return "just now";
  const m = Math.round(d / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  if (h < 48) return "yesterday";
  return new Date(ts).toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

/** Time until a deadline, for expiry countdowns: "23 min", "45 s", "2 h". */
export function timeLeft(until: number, now = Date.now()) {
  return durationWords(Math.max(0, until - now));
}

/** Clock time in the user's locale: 14:02 (nl/en-GB) or 2:02 PM (en-US). */
export function clock(ts: number) {
  return new Date(ts).toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
}

/** 1 agent · 2 agents · 0 memories (pass the plural for irregular words). */
export function plural(n: number, one: string, many = one + "s") {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** 42 MB · 1.3 GB · 12 KB */
export function bytes(n: number) {
  if (n >= 1e9) return `${num(n / 1e9, 1)} GB`;
  if (n >= 1e6) return `${num(Math.round(n / 1e6))} MB`;
  return `${num(Math.max(1, Math.round(n / 1e3)))} KB`;
}

/** "Atlas, Nova and Scout" */
export function list(items: string[]) {
  try {
    return new Intl.ListFormat("en", { type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}
