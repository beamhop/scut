import { createContext, forwardRef, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CaretDownIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { cx } from "./cx.ts";

type FieldCtx = { id: string; describedBy?: string; invalid: boolean };
const Ctx = createContext<FieldCtx | null>(null);

export type FieldProps = {
  /** Visible label (always visible: no placeholder-as-label). */
  label: ReactNode;
  /** Help text under the control. */
  hint?: ReactNode;
  /** Error text; marks the control aria-invalid and is announced via aria-describedby. */
  error?: ReactNode;
  /** Right side of the label row, e.g. "Optional" or a link. */
  aside?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
};

/** Label + control + hint + error, wired with id/aria-describedby/aria-invalid. Wrap one Input/Textarea/Select. */
export function Field({ label, hint, error, aside, id: idProp, className, children }: FieldProps) {
  const gen = useId();
  const id = idProp ?? gen;
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <Ctx.Provider value={{ id, describedBy, invalid: !!error }}>
      <div className={cx("flex flex-col gap-1.5", className)}>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="text-small font-medium text-ink">{label}</label>
          {aside && <span className="text-small text-ink-3">{aside}</span>}
        </div>
        {children}
        {hint && <p id={`${id}-hint`} className="text-small text-ink-2">{hint}</p>}
        {error && (
          <p id={`${id}-err`} className="flex items-start gap-1.5 text-small text-err">
            <WarningCircleIcon size={14} weight="bold" aria-hidden className="mt-px shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>
    </Ctx.Provider>
  );
}

function useField(p: { id?: string; "aria-describedby"?: string; "aria-invalid"?: any }) {
  const f = useContext(Ctx);
  return {
    id: p.id ?? f?.id,
    "aria-describedby": [p["aria-describedby"], f?.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": p["aria-invalid"] ?? (f?.invalid || undefined),
  };
}

const CONTROL =
  "w-full rounded-control border bg-surface text-body text-ink placeholder:text-ink-3 transition-colors " +
  "hover:border-ink-2 focus-visible:border-ink focus-visible:[outline-offset:1px] disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-[invalid=true]:border-err";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & { mono?: boolean; size?: "sm" | "md" };

/** Text input. `mono` for machine strings (keys, URLs, model ids). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ mono, size = "md", className, ...p }, ref) {
  return <input ref={ref} {...p} {...useField(p)} className={cx(CONTROL, "border-line-strong px-2.5", size === "sm" ? "h-7" : "h-8", mono && "font-mono text-[12.5px]", className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(function Textarea({ mono, className, rows = 3, ...p }, ref) {
  return <textarea ref={ref} rows={rows} {...p} {...useField(p)} className={cx(CONTROL, "border-line-strong px-2.5 py-1.5 leading-[19px]", mono && "font-mono text-[12.5px]", className)} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <span className="relative block">
      <select ref={ref} {...p} {...useField(p)} className={cx(CONTROL, "h-8 appearance-none border-line-strong pl-2.5 pr-8", className)}>
        {children}
      </select>
      <CaretDownIcon size={14} weight="bold" aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-2" />
    </span>
  );
});

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
};

/** On/off setting that applies immediately (no Save). Native checkbox with role=switch. */
export function Switch({ checked, onChange, label, description, className, disabled, id: idProp, ...p }: SwitchProps) {
  const gen = useId();
  const id = idProp ?? gen;
  return (
    <div className={cx("flex items-start gap-3", disabled && "opacity-50", className)}>
      <span className="relative mt-px inline-flex h-[18px] w-[30px] shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={description ? `${id}-d` : undefined}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-full border border-line-strong bg-surface-2 transition-colors checked:border-ink checked:bg-ink disabled:cursor-not-allowed"
          {...p}
        />
        <span aria-hidden className="pointer-events-none absolute left-[3px] top-[3px] size-3 rounded-full bg-ink-2 transition-[translate,background-color] duration-(--dur-pop) ease-(--ease-out) peer-checked:translate-x-3 peer-checked:bg-surface" />
      </span>
      <span className="min-w-0">
        <label htmlFor={id} className="block text-body text-ink">{label}</label>
        {description && <span id={`${id}-d`} className="block text-small text-ink-2">{description}</span>}
      </span>
    </div>
  );
}

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; description?: ReactNode; disabled?: boolean };

/**
 * A 2–4 position switch (Ask first · Risky only · Never ask). Native radios in a fieldset with a legend, so arrow
 * keys, form semantics and screen readers work for free. The selected option's description shows underneath.
 */
export function Segmented<T extends string>({ legend, value, onChange, options, name, hideLegend, size = "md", className }: {
  legend: ReactNode; value: T; onChange: (v: T) => void; options: SegmentedOption<T>[]; name?: string;
  /** Keep the legend for screen readers only (when a visible heading already says the same). */
  hideLegend?: boolean; size?: "sm" | "md"; className?: string;
}) {
  const gen = useId();
  const nm = name ?? gen;
  const current = options.find((o) => o.value === value);
  return (
    <fieldset className={cx("min-w-0", className)}>
      <legend className={cx("mb-1.5 text-small font-medium text-ink", hideLegend && "sr-only")}>{legend}</legend>
      <div className="inline-flex max-w-full rounded-[8px] border border-line-strong bg-surface-2 p-0.5">
        {options.map((o) => (
          <label key={o.value} className={cx("relative", o.disabled && "opacity-45")}>
            <input type="radio" name={nm} value={o.value} checked={o.value === value} disabled={o.disabled} onChange={() => onChange(o.value)}
              aria-describedby={o.description && o.value === value ? `${nm}-desc` : undefined}
              className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-control" />
            <span className={cx(
              "pointer-events-none flex items-center whitespace-nowrap rounded-control font-medium text-ink-2 transition-colors duration-(--dur-press)",
              size === "sm" ? "h-6 px-2.5 text-small" : "h-7 px-3 text-body",
              "peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-[0_0_0_1px_var(--color-line-strong),0_1px_2px_rgb(0_0_0/0.08)]",
              "peer-hover:text-ink",
            )}>{o.label}</span>
          </label>
        ))}
      </div>
      {current?.description && <p id={`${nm}-desc`} className="mt-1.5 text-small text-ink-2">{current.description}</p>}
    </fieldset>
  );
}
