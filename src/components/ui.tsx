"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";

export function cn(...xs: (string | false | null | undefined | 0)[]) {
  return xs.filter(Boolean).join(" ");
}

export function Card({ className, children, as: Tag = "section" }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" }) {
  return <Tag className={cn("rounded-[var(--radius-card)] border border-line bg-ink-800", className)}>{children}</Tag>;
}

export function CardHeader({ icon, title, subtitle, right }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-4">
      <div className="flex min-w-[min(100%,14rem)] flex-1 items-start gap-3">
        {icon && <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-ink-700 text-volt">{icon}</div>}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: "sm" | "md" | "lg"; icon?: ReactNode }>(
  function Button({ variant = "secondary", loading, size = "md", icon, className, children, disabled, ...rest }, ref) {
    const base = "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[background,color,box-shadow,opacity] duration-150 disabled:cursor-not-allowed disabled:opacity-45 select-none";
    const sizes = { sm: "h-8 px-3 text-[13px]", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-[15px]" };
    const variants: Record<Variant, string> = {
      primary: "bg-volt text-ink-950 hover:bg-[#f5ff4d] glow-soft",
      secondary: "bg-ink-700 text-fg hover:bg-ink-600 border border-line",
      ghost: "text-muted hover:text-fg hover:bg-ink-700",
      danger: "bg-bad/10 text-bad hover:bg-bad/20 border border-bad/30",
    };
    return (
      <button ref={ref} className={cn(base, sizes[size], variants[variant], className)} disabled={disabled || loading} {...rest}>
        {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

export function ButtonLink({ href, children, variant = "secondary", icon, download, className }: { href: string; children: ReactNode; variant?: Variant; icon?: ReactNode; download?: boolean; className?: string }) {
  const variants: Record<Variant, string> = {
    primary: "bg-volt text-ink-950 hover:bg-[#f5ff4d] glow-soft",
    secondary: "bg-ink-700 text-fg hover:bg-ink-600 border border-line",
    ghost: "text-muted hover:text-fg hover:bg-ink-700",
    danger: "bg-bad/10 text-bad border border-bad/30",
  };
  return (
    <a href={href} download={download} className={cn("inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors", variants[variant], className)}>
      {icon}
      {children}
    </a>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "volt" | "ok" | "bad" | "warn"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-ink-700 text-muted border-line",
    volt: "bg-volt/10 text-volt border-volt/30",
    ok: "bg-ok/10 text-ok border-ok/30",
    bad: "bg-bad/10 text-bad border-bad/30",
    warn: "bg-warn/10 text-warn border-warn/30",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide", tones[tone], className)}>{children}</span>;
}

export function Stat({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label-xs">{label}</div>
      <div className={cn("num mt-1 truncate text-[15px] font-semibold", accent && "text-volt")}>{value}</div>
      {sub && <div className="num mt-0.5 truncate text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[]; className?: string; size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex flex-wrap gap-1 rounded-xl border border-line bg-ink-900 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
            value === o.value ? "bg-volt text-ink-950" : "text-muted hover:bg-ink-700 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start justify-between gap-4", disabled && "cursor-not-allowed opacity-50")}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors", checked ? "border-volt bg-volt" : "border-line bg-ink-700")}
      >
        <span className={cn("absolute top-0.5 size-[18px] rounded-full transition-all", checked ? "left-[22px] bg-ink-950" : "left-0.5 bg-muted")} />
      </button>
    </label>
  );
}

export function Progress({ value, className }: { value: number | null; className?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-ink-700", value === null && "indeterminate", className)} role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {value !== null && <div className="h-full rounded-full bg-volt transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />}
    </div>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "ok" | "bad" | "warn"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const map = {
    info: { cls: "border-line bg-ink-900 text-muted", icon: <Info className="size-4 text-muted" /> },
    ok: { cls: "border-ok/30 bg-ok/5 text-fg", icon: <CircleCheck className="size-4 text-ok" /> },
    bad: { cls: "border-bad/30 bg-bad/5 text-fg", icon: <CircleAlert className="size-4 text-bad" /> },
    warn: { cls: "border-warn/30 bg-warn/5 text-fg", icon: <TriangleAlert className="size-4 text-warn" /> },
  }[tone];
  return (
    <div className={cn("flex gap-3 rounded-xl border px-4 py-3 text-[13px] leading-relaxed", map.cls, className)}>
      <div className="mt-0.5 shrink-0">{map.icon}</div>
      <div className="min-w-0">
        {title && <div className="font-semibold text-fg">{title}</div>}
        {children && <div className={cn(!!title && "mt-0.5", "text-muted")}>{children}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold">{label}</span>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function Select<T extends string | number>({ value, onChange, options, className, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; disabled?: boolean }[]; className?: string; disabled?: boolean }) {
  return (
    <select
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
      className={cn("h-10 w-full rounded-xl border border-line bg-ink-900 px-3 text-sm text-fg outline-none focus:border-volt/60 disabled:opacity-50", className)}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function PageHeader({ eyebrow, title, description, right }: { eyebrow?: string; title: ReactNode; description?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <div className="label-xs mb-2 !text-volt">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {right}
    </header>
  );
}
