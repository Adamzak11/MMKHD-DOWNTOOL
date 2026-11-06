/** MAMATKILAT mark: a lightning bolt ("kilat") cut through an M-shaped frame. */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="11" fill="#151515" stroke="#2e2e2e" />
      <path d="M9 29V11l7 8 4-5" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24.5 8 18 21h5.5L21 32l10-15h-6l3.5-9z" fill="#EFFF00" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <div className="leading-none">
        <div className="text-[15px] font-black tracking-[0.04em]">
          MAMAT<span className="text-volt">KILAT</span>
        </div>
        {!compact && <div className="mt-1 text-[10px] font-semibold tracking-[0.28em] text-faint">VIDEO TOOLS</div>}
      </div>
    </div>
  );
}
