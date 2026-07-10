"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TherapyData } from "@/lib/therapies";

interface Props {
  data: TherapyData;
}

const SEARCH_CONFIG: Record<string, { placeholder: string }> = {
  "all-ads": { placeholder: "Search ads by advertiser or copy" },
  scripts: { placeholder: "Search scripts by angle, condition, or format" },
};

export function TherapyView({ data }: Props) {
  const [active, setActive] = useState(data.tabs[0]?.id ?? "overview");
  const paneRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [tabIndicator, setTabIndicator] = useState<{
    x: number;
    w: number;
  } | null>(null);
  const [search, setSearch] = useState<Record<string, string>>({});

  const activePaneHtml = useMemo(
    () => data.panes[active] ?? "",
    [active, data.panes],
  );

  // Tab underline indicator measurement
  const measureTab = () => {
    const container = tabsRef.current;
    const el = tabRefs.current.get(active);
    if (!container || !el) return;
    const c = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setTabIndicator({ x: r.left - c.left + container.scrollLeft, w: r.width });
  };
  useLayoutEffect(measureTab, [active]);
  useEffect(() => {
    const onResize = () => measureTab();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active]);

  // Chart.js for the overview pane.
  useEffect(() => {
    if (active !== "overview" || !data.charts) return;
    const pane = paneRef.current;
    if (!pane) return;

    let cancelled = false;
    const instances: { destroy: () => void }[] = [];

    (async () => {
      const ChartMod = await import("chart.js/auto");
      if (cancelled) return;
      const Chart = ChartMod.default;

      const grid = "rgba(0,0,0,0.06)";
      const tickColor = "rgba(10,10,10,0.6)";

      const formatCanvas = pane.querySelector<HTMLCanvasElement>(
        "canvas[id$='FmtChart'], canvas#fmtChart",
      );
      if (formatCanvas && data.charts) {
        const cfg = data.charts.format;
        const inst = new Chart(formatCanvas, {
          type: "doughnut",
          data: {
            labels: cfg.labels,
            datasets: [
              {
                data: cfg.data,
                backgroundColor: [
                  data.accent,
                  "rgba(10,10,10,0.5)",
                  "rgba(10,10,10,0.25)",
                  "rgba(10,10,10,0.12)",
                ],
                borderColor: "#ffffff",
                borderWidth: 2,
              },
            ],
          },
          options: {
            plugins: {
              legend: {
                position: "bottom",
                labels: {
                  color: tickColor,
                  font: { family: "inherit", size: 12 },
                  padding: 16,
                  boxWidth: 8,
                  boxHeight: 8,
                  usePointStyle: true,
                  pointStyle: "circle",
                },
              },
            },
            cutout: "72%",
            animation: { duration: 700, easing: "easeOutCubic" },
          },
        });
        instances.push(inst);
      }

      const advCanvas = pane.querySelector<HTMLCanvasElement>(
        "canvas[id$='AdvChart'], canvas#advChart",
      );
      if (advCanvas && data.charts) {
        const cfg = data.charts.advertisers;
        const inst = new Chart(advCanvas, {
          type: "bar",
          data: {
            labels: cfg.labels,
            datasets: [
              {
                label: "Ads",
                data: cfg.data,
                backgroundColor: data.accent,
                borderRadius: 2,
                barThickness: 14,
              },
            ],
          },
          options: {
            indexAxis: "y",
            plugins: { legend: { display: false } },
            scales: {
              x: {
                grid: { color: grid },
                ticks: { color: tickColor, font: { size: 11 } },
                border: { display: false },
              },
              y: {
                grid: { display: false },
                ticks: { color: tickColor, font: { size: 12 } },
                border: { display: false },
              },
            },
            animation: { duration: 700, easing: "easeOutCubic" },
          },
        });
        instances.push(inst);
      }
    })();

    return () => {
      cancelled = true;
      instances.forEach((i) => i.destroy());
    };
  }, [active, data.charts, data.accent]);

  // Search/filter for ads + scripts.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const config = SEARCH_CONFIG[active];
    if (!config) return;

    const q = (search[active] ?? "").toLowerCase();
    let containers: NodeListOf<Element>;
    if (active === "all-ads") {
      containers = pane.querySelectorAll("table tbody tr");
    } else if (active === "scripts") {
      const scContainer = pane.querySelector(".sc");
      if (scContainer) {
        containers = pane.querySelectorAll(".sc");
      } else {
        const cardsRoot = pane.querySelector(
          "#scriptCards, #irScriptCards, #pemfScriptCards",
        );
        containers = cardsRoot
          ? cardsRoot.querySelectorAll(":scope > div")
          : pane.querySelectorAll("[data-script-card]");
      }
    } else {
      return;
    }

    containers.forEach((el) => {
      const visible = !q || el.textContent?.toLowerCase().includes(q);
      (el as HTMLElement).style.display = visible ? "" : "none";
    });
  }, [search, active]);

  return (
    <>
      <nav
        style={{
          background: "var(--bg)",
          borderBottom: "1px solid var(--hairline)",
        }}
      >
        <div
          ref={tabsRef}
          style={{
            position: "relative",
            maxWidth: "var(--max-width)",
            margin: "0 auto",
            padding: "0 32px",
            display: "flex",
            gap: 4,
            overflowX: "auto",
          }}
        >
          {/* Sliding tab underline */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              bottom: -1,
              height: 1,
              background: "var(--text-primary)",
              width: tabIndicator ? tabIndicator.w : 0,
              transform: `translateX(${tabIndicator ? tabIndicator.x : 0}px)`,
              transition:
                "transform 0.42s var(--ease), width 0.42s var(--ease), opacity 0.2s",
              opacity: tabIndicator ? 1 : 0,
              pointerEvents: "none",
            }}
          />
          {data.tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  if (el) tabRefs.current.set(tab.id, el);
                  else tabRefs.current.delete(tab.id);
                }}
                type="button"
                onClick={() => setActive(tab.id)}
                style={{
                  padding: "18px 22px",
                  cursor: "pointer",
                  color: isActive
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                  fontSize: 14,
                  fontWeight: 500,
                  letterSpacing: "-0.005em",
                  background: "transparent",
                  border: "none",
                  whiteSpace: "nowrap",
                  transition: "color 0.32s var(--ease)",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="pane-wrap">
        {SEARCH_CONFIG[active] && (
          <div style={{ marginBottom: 32 }}>
            <input
              className="search-box"
              type="text"
              placeholder={SEARCH_CONFIG[active].placeholder}
              value={search[active] ?? ""}
              onChange={(e) =>
                setSearch((s) => ({ ...s, [active]: e.target.value }))
              }
            />
          </div>
        )}
        <div
          key={active}
          ref={paneRef}
          className="pane-stagger"
          // The HTML blob is extracted from the source report verbatim.
          dangerouslySetInnerHTML={{ __html: activePaneHtml }}
        />
      </div>
    </>
  );
}
