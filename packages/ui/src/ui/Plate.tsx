import { cx } from "./cx.ts";

/**
 * Agent identity = Plate: a 5×5 mirrored dot-matrix glyph derived from the agent's public key, plus a 3-letter
 * callsign from its name (Atlas → ATL, Nova → NOV, Scout → SCT). Monochrome ink. Replaces the robot mascots.
 */

/** 3-letter callsign: first letter + following consonants; falls back to the first three letters. */
export function callsign(name: string, fallbackHex = ""): string {
  const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().match(/[A-Z0-9]+/g) ?? [];
  if (!words.length) return (fallbackHex.slice(0, 3) || "AGT").toUpperCase();
  if (words.length >= 3) return words.slice(0, 3).map((w) => w[0]).join("");
  const w = words[0]!;
  if (words.length === 2) return (w[0] + words[1][0] + (w.slice(1).replace(/[AEIOU]/g, "")[0] ?? words[1][1] ?? w[1] ?? "X")).slice(0, 3);
  const cons = w.slice(1).replace(/[AEIOUY]/g, "");
  if (cons.length >= 2) return w[0] + cons.slice(0, 2);
  return (w + "XXX").slice(0, 3);
}

function bytesOf(key: string): number[] {
  const hex = key.trim().toLowerCase();
  if (/^[0-9a-f]{16,}$/.test(hex)) return hex.match(/../g)!.map((b) => parseInt(b, 16));
  // Not a hex key (e.g. no key yet): FNV-1a over the string, stretched to 16 bytes.
  const out: number[] = [];
  let h = 0x811c9dc5;
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ round, 0x01000193) >>> 0;
    out.push(h & 255, (h >>> 8) & 255, (h >>> 16) & 255, h >>> 24);
  }
  return out;
}

/** 25 booleans (row-major, 5×5), left half mirrored onto the right. Deterministic for a given key. */
export function glyphCells(key: string): boolean[] {
  const b = bytesOf(key || "beamhop");
  let best: number[] = [];
  // Use the first 15-bit window with a balanced amount of ink (6–11 of 15 dots); otherwise the last tried.
  for (let off = 0; off + 2 <= b.length; off += 2) {
    const bits = ((b[off] << 8) | b[off + 1]) & 0x7fff;
    const cells = Array.from({ length: 15 }, (_, i) => (bits >> i) & 1);
    best = cells;
    const on = cells.reduce((s, x) => s + x, 0);
    if (on >= 6 && on <= 11) break;
  }
  const grid: boolean[] = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) grid.push(!!best[r * 3 + (c < 3 ? c : 4 - c)]);
  return grid;
}

const GLYPH_PX = { sm: 18, md: 28, lg: 44 } as const;

/** Just the dot glyph, square. Lit dots in ink, unlit ones as faint dots so it reads as a matrix. */
export function PlateGlyph({ pubkey, name = "", size = "md", className }: { pubkey?: string; name?: string; size?: keyof typeof GLYPH_PX | number; className?: string }) {
  const px = typeof size === "number" ? size : GLYPH_PX[size];
  const cells = glyphCells(pubkey || name);
  return (
    <svg width={px} height={px} viewBox="0 0 7 7" aria-hidden className={cx("block shrink-0", className)}>
      <rect x="0.25" y="0.25" width="6.5" height="6.5" rx="1.1" className="fill-surface stroke-line" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {cells.map((on, i) => (
        <circle key={i} cx={1.5 + (i % 5)} cy={1.5 + Math.floor(i / 5)} r={on ? 0.4 : 0.13} className={on ? "fill-ink" : "fill-line"} />
      ))}
    </svg>
  );
}

const TEXT = {
  sm: "text-micro font-semibold [font-stretch:108%] tracking-[0.04em]",
  md: "text-small font-semibold [font-stretch:110%] tracking-[0.05em]",
  lg: "text-ui-lg font-bold [font-stretch:115%] tracking-[0.05em]",
};

export type PlateProps = {
  /** Agent public key (hex). Falls back to the name when missing. */
  pubkey?: string;
  name: string;
  size?: "sm" | "md" | "lg";
  /** Override the derived callsign. */
  sign?: string;
  /** Show the full name after the callsign (for places where no other heading names the agent). */
  showName?: boolean;
  /** Accessible label; without it the plate is decorative (the name is expected next to it). */
  label?: string;
  className?: string;
};

/** Glyph + callsign (+ optional name). */
export function Plate({ pubkey, name, size = "md", sign, showName, label, className }: PlateProps) {
  const cs = sign ?? callsign(name, pubkey);
  return (
    <span
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": !showName || undefined })}
      className={cx("inline-flex shrink-0 items-center text-ink", size === "lg" ? "gap-2.5" : size === "md" ? "gap-2" : "gap-1.5", className)}
    >
      <PlateGlyph pubkey={pubkey} name={name} size={size} />
      <span className={cx("leading-none tabular-nums", TEXT[size])}>{cs}</span>
      {showName && <span className={cx("truncate font-medium", size === "lg" ? "text-ui-lg" : size === "md" ? "text-body" : "text-small")}>{name}</span>}
    </span>
  );
}
