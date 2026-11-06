"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Gauge, History, LayoutDashboard, Link2, ScanSearch } from "lucide-react";
import { Wordmark } from "./logo";
import { cn } from "./ui";
import { useCapabilities } from "@/lib/hooks";

const NAV = [
  { href: "/", label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { href: "/compress", label: "Smart Compressor", short: "Compress", icon: Gauge },
  { href: "/tiktok", label: "TikTok HD Downloader", short: "TikTok", icon: Link2 },
  { href: "/analyze", label: "Video Analyzer", short: "Analyze", icon: ScanSearch },
  { href: "/history", label: "Processing History", short: "History", icon: History },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const caps = useCapabilities();
  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-ink-900 lg:flex">
        <div className="px-5 pb-6 pt-6">
          <Link href="/" aria-label="MAMATKILAT Video Tools home">
            <Wordmark />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Main">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link key={n.href} href={n.href} className={cn("relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors", active ? "text-fg" : "text-muted hover:bg-ink-800 hover:text-fg")}>
                {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl border border-line bg-ink-800" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                {active && <span className="absolute left-0 top-2.5 h-5 w-[3px] rounded-r bg-volt" />}
                <n.icon className={cn("relative size-[18px]", active && "text-volt")} />
                <span className="relative">{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="m-3 rounded-xl border border-line bg-ink-800 p-3.5 text-xs text-muted">
          <div className="label-xs mb-2">Engine</div>
          <div className="flex items-center gap-2">
            <span className={cn("size-1.5 rounded-full", caps?.ffmpegVersion ? "bg-ok" : "bg-faint")} />
            <span className="num truncate">FFmpeg {caps?.ffmpegVersion ?? "…"}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {caps &&
              (["h264", "h265", "av1"] as const).map((c) => (
                <span key={c} className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold", caps.encoders[c] ? "border-line text-fg" : "border-line text-faint line-through")}>
                  {c === "h264" ? "H.264" : c === "h265" ? "H.265" : "AV1"}
                </span>
              ))}
          </div>
          {caps && <div className="mt-2 text-faint">Files auto-delete after {caps.limits.fileTtlMin} min</div>}
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center border-b border-line bg-ink-950/90 px-4 backdrop-blur lg:hidden">
        <Link href="/">
          <Wordmark compact />
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">
        {caps && !caps.ffmpegVersion && (
          <div role="alert" className="mb-6 rounded-xl border border-warn/30 bg-warn/5 px-4 py-3 text-[13px] text-muted">
            <span className="font-semibold text-fg">Processing engine offline.</span> FFmpeg is not available on this server, so uploads, compression and analysis cannot run.
            If this site is on Netlify or another static/serverless host, set <code className="text-fg">BACKEND_URL</code> to a server running the MAMATKILAT Docker image.
          </div>
        )}
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
        <div className="grid grid-cols-5">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link key={n.href} href={n.href} className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold", active ? "text-fg" : "text-faint")}>
                {active && <motion.span layoutId="mnav-active" className="absolute top-0 h-[2px] w-10 rounded-b bg-volt" />}
                <n.icon className={cn("size-5", active && "text-volt")} />
                {n.short}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
