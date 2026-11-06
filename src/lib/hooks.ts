"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Capabilities, JobSummary } from "./types";

let capsPromise: Promise<Capabilities> | null = null;

export function useCapabilities() {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    capsPromise ??= api.capabilities().catch((e) => {
      capsPromise = null;
      throw e;
    });
    capsPromise.then(setCaps).catch(() => {});
  }, []);
  return caps;
}

export const TERMINAL = new Set(["done", "failed", "cancelled", "rejected"]);

/** Polls a job until it reaches a terminal state. */
export function useJob(jobId: string | null) {
  const [job, setJob] = useState<JobSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setJob(null);
    setError(null);
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await api.job(jobId);
        if (stop) return;
        setJob(j);
        if (!TERMINAL.has(j.status)) timer.current = setTimeout(tick, j.status === "queued" ? 1500 : 700);
      } catch (e) {
        if (!stop) setError((e as Error).message);
      }
    };
    void tick();
    return () => {
      stop = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [jobId]);
  return { job, error, setJob };
}
