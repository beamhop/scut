import { cx } from "./cx.ts";

/**
 * Agent identity = Plate: a 5×5 mirrored dot-matrix glyph derived from the agent's public key, plus a 3-letter
 * callsign from its name (Atlas → ATL, Nova → NOV, Scout → SCT). Monochrome ink. Replaces the robot mascots.
 */

export { callsign, glyphCells } from "@scut/protocol";
import { callsign, glyphCells } from "@scut/protocol";

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
