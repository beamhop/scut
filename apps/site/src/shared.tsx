import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx, prefersReducedMotion } from "../../../packages/ui/src/ui/index.ts";

export const REPO = "https://github.com/beamhop/scut";
export const DOWNLOAD = `${REPO}/actions/workflows/build.yml`;
export const VERSION = "0.60.0";
/** Fixed key so the demo agent's plate glyph is the same on every visit. */
export const ATLAS_KEY = "7f3c1a9e52b84d06c1e7a3f95b20d8e4c6a1f3b7d9e05c28a4f61b3d7e9c0a25";
export const NOVA_KEY = "0b9e4f21c7d3a85e6f10b2c4d9a7e3f58c1b06d2e4a9f73b5c8d1e0a6f2b4c97";

export function Section({ id, kicker, title, lede, children, className }: { id?: string; kicker: string; title: ReactNode; lede?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={cx("mx-auto max-w-[1200px] scroll-mt-20 px-4 py-20 sm:px-8 sm:py-28", className)}>
      <p className="kicker mb-4">{kicker}</p>
      <h2 id={id ? `${id}-h` : undefined} className="section-title max-w-[18ch] text-balance">{title}</h2>
      {lede && <p className="mt-5 max-w-[60ch] text-[17px] leading-[26px] text-ink-2 text-pretty">{lede}</p>}
      {children}
    </section>
  );
}

/** Whether the element is on screen. */
export function useVisible<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, visible };
}

/** setInterval that always calls the latest `fn`, skips hidden tabs, and only runs while `enabled`. */
export function useInterval(ms: number, fn: () => void, enabled = true) {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => { if (!document.hidden) cb.current(); }, ms);
    return () => clearInterval(t);
  }, [ms, enabled]);
}

export const reduced = () => prefersReducedMotion();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
