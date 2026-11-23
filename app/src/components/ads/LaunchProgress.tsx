"use client";

import { Check, Loader2, Rocket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

/**
 * Shown while a campaign launches. Launching uploads every image to Meta and
 * then creates the campaign, each ad set and each ad one call at a time, which
 * takes up to a minute with nothing else on screen. The stages advance on an
 * estimate from the campaign's own size (the server reports nothing until it
 * is done); the last one holds until Meta has everything.
 */
export function LaunchProgress({ images, adSets, ads }: { images: number; adSets: number; ads: number }) {
  const stages = useMemo(() => {
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    return [
      { label: images > 0 ? `Uploading ${plural(images, "image", "images")} to Meta` : "Preparing your ads", ms: Math.max(1500, images * 2500) },
      { label: "Creating the campaign", ms: 1500 },
      { label: `Setting up ${plural(adSets, "ad set", "ad sets")}`, ms: Math.max(1500, adSets * 1500) },
      { label: `Creating ${plural(ads, "ad", "ads")}`, ms: Math.max(2000, ads * 2000) },
      { label: "Sending it to Meta for review", ms: Infinity },
    ];
  }, [images, adSets, ads]);
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (at >= stages.length - 1) return;
    const t = setTimeout(() => setAt((n) => n + 1), stages[at].ms);
    return () => clearTimeout(t);
  }, [at, stages]);

  return (
    <div className="lp" role="dialog" aria-modal="true" aria-labelledby="lp-title">
      <div className="lp__card">
        <span className="lp__mark" aria-hidden>
          <Rocket size={26} />
        </span>
        <h2 id="lp-title">Launching your campaign</h2>
        <p className="lp__note">This takes up to a minute. Keep this page open.</p>
        <ol className="lp__steps" aria-live="polite">
          {stages.map((s, i) => (
            <li key={s.label} data-state={i < at ? "done" : i === at ? "now" : "next"}>
              <span className="lp__tick" aria-hidden>
                {i < at ? <Check size={14} strokeWidth={3} /> : i === at ? <Loader2 size={14} className="lp__spin" /> : null}
              </span>
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      </div>
      <style>{`
.lp{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:16px;background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:blur(6px)}
.lp__card{width:min(440px,100%);padding:32px 28px;border-radius:var(--radius-lg,16px);background:var(--surface-1,var(--bg));border:1px solid var(--hairline);box-shadow:0 24px 60px rgba(0,0,0,.35);text-align:center}
.lp__mark{display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:999px;background:var(--text-primary);color:var(--bg);animation:lp-rise 1.6s ease-in-out infinite}
.lp h2{margin:18px 0 6px;font-size:20px;color:var(--text-primary)}
.lp__note{margin:0 0 20px;font-size:13.5px;color:var(--text-tertiary)}
.lp__steps{list-style:none;margin:0;padding:0;display:grid;gap:12px;text-align:left}
.lp__steps li{display:flex;align-items:center;gap:12px;font-size:14px;color:var(--text-tertiary);transition:color .25s ease}
.lp__steps li[data-state="now"]{color:var(--text-primary);font-weight:600}
.lp__steps li[data-state="done"]{color:var(--text-secondary)}
.lp__tick{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;border:1.5px solid var(--hairline-strong)}
.lp__steps li[data-state="done"] .lp__tick{background:var(--accent);border-color:var(--accent);color:var(--accent-contrast)}
.lp__steps li[data-state="now"] .lp__tick{border-color:var(--text-primary)}
.lp__spin{animation:lp-spin .9s linear infinite}
@keyframes lp-spin{to{transform:rotate(360deg)}}
@keyframes lp-rise{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@media (prefers-reduced-motion: reduce){.lp__mark,.lp__spin{animation:none}.lp__steps li{transition:none}}
      `}</style>
    </div>
  );
}
