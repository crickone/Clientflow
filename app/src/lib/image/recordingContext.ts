/**
 * A recording 2D canvas context — a TEST INSTRUMENT, not app code. Nothing in
 * the application imports it.
 *
 * There is no server-side canvas in this app: paintSlide takes a
 * CanvasRenderingContext2D and HTMLImageElements, and the only rasterising
 * caller lives in the browser. This stands in for one, capturing the exact
 * ordered sequence of drawing operations a render issues instead of pixels.
 * That trace IS what our code does — rasterising it afterwards adds no
 * information our code controls — and it reproduces exactly on any platform,
 * with no dependency, giving a line-by-line diff on a mismatch rather than
 * two different hashes.
 *
 * Text measurement answers with a deterministic synthetic metric, so wrapLines
 * and autoFitHeading run their real logic against stable widths (the same
 * MeasureText port templates.test.ts drives with a fake).
 *
 * Used by templates.golden.test.ts (the golden master over all 39 templates)
 * and paintLayout.test.ts (the composed-layout renderer).
 */

/** Every 2D-context member templates.ts touches. Kept exhaustive on purpose:
 *  an unrecognised call throws rather than silently vanishing from the trace,
 *  so a template reaching for a new primitive can't slip past unrecorded. */
export const TRACKED_PROPS = [
  "fillStyle",
  "strokeStyle",
  "font",
  "textAlign",
  "textBaseline",
  // Set only by paintLayout, to honour a design system's tracking. Part of
  // the canvas drawing state, so save/restore stacks it and measureText
  // accounts for it.
  "letterSpacing",
  "lineWidth",
  "lineCap",
  "lineJoin",
  "globalAlpha",
  "shadowColor",
  "shadowBlur",
  "shadowOffsetX",
  "shadowOffsetY",
] as const;

/** Stable rendering of a call argument. Numbers print at full precision —
 *  IEEE-754 arithmetic is exact and identical everywhere, so any difference in
 *  the printed value is a real difference in the layout maths, never noise. */
export function arg(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : `!${v}`;
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object" && v !== null && "__id" in v) {
    return String((v as { __id: unknown }).__id);
  }
  return JSON.stringify(v);
}

export class RecordingContext {
  readonly ops: string[] = [];
  private gradients = 0;
  private state: Record<string, unknown> = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    letterSpacing: "0px",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    shadowColor: "rgba(0, 0, 0, 0)",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  private stack: Record<string, unknown>[] = [];

  private record(line: string) {
    this.ops.push(line);
  }

  private call(name: string, ...args: unknown[]) {
    this.record(`${name}(${args.map(arg).join(", ")})`);
  }

  // Property access is proxied in makeContext() below; these back it.
  getProp(name: string): unknown {
    return this.state[name];
  }
  setProp(name: string, value: unknown) {
    // canvasMeasure() sets ctx.font on every single measurement, so recording
    // every assignment would bury the trace in repeats of one value. Only
    // CHANGES are recorded, which loses nothing: re-assigning the value a
    // property already holds cannot affect a single pixel. save()/restore()
    // move the current value too, which is why this.state is stacked.
    if (this.state[name] === value) return;
    this.state[name] = value;
    this.record(`${name} = ${arg(value)}`);
  }

  save() {
    this.stack.push({ ...this.state });
    this.call("save");
  }
  restore() {
    const prev = this.stack.pop();
    if (prev) this.state = prev;
    this.call("restore");
  }
  beginPath() {
    this.call("beginPath");
  }
  closePath() {
    this.call("closePath");
  }
  moveTo(x: number, y: number) {
    this.call("moveTo", x, y);
  }
  lineTo(x: number, y: number) {
    this.call("lineTo", x, y);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.call("quadraticCurveTo", cx, cy, x, y);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean) {
    this.call("arc", x, y, r, a0, a1, ccw);
  }
  rect(x: number, y: number, w: number, h: number) {
    this.call("rect", x, y, w, h);
  }
  clip() {
    this.call("clip");
  }
  fill() {
    this.call("fill");
  }
  stroke() {
    this.call("stroke");
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.call("fillRect", x, y, w, h);
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.call("strokeRect", x, y, w, h);
  }
  fillText(text: string, x: number, y: number, maxWidth?: number) {
    this.call("fillText", text, x, y, maxWidth);
  }
  strokeText(text: string, x: number, y: number, maxWidth?: number) {
    this.call("strokeText", text, x, y, maxWidth);
  }
  drawImage(img: unknown, ...rest: number[]) {
    this.call("drawImage", img, ...rest);
  }
  measureText(text: string): { width: number } {
    const width = syntheticWidth(text, String(this.state.font));
    this.call("measureText", text, `-> ${width}`);
    return { width };
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
    const id = `linearGradient#${++this.gradients}`;
    this.call("createLinearGradient", x0, y0, x1, y1, `-> ${id}`);
    return this.gradient(id);
  }
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ) {
    const id = `radialGradient#${++this.gradients}`;
    this.call("createRadialGradient", x0, y0, r0, x1, y1, r1, `-> ${id}`);
    return this.gradient(id);
  }
  private gradient(id: string) {
    const self = this;
    return {
      __id: id,
      addColorStop(offset: number, color: string) {
        self.call(`${id}.addColorStop`, offset, color);
      },
    };
  }
}

/**
 * Synthetic text metric: proportional to the font's px size and the string
 * length. Deterministic, and varies with size — which is what autoFitHeading
 * needs to actually shrink (a flat per-char width would measure a 20px and a
 * 10px heading identically). Same trick as templates.test.ts's fake measurer.
 */
export function syntheticWidth(text: string, font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  const size = m ? Number(m[1]) : 16;
  return text.length * size * 0.52;
}

/**
 * Wraps a RecordingContext so the TRACKED_PROPS behave as real context
 * properties (get returns the current value, set records the change) while
 * every method call passes straight through. Unknown members throw, so a
 * template reaching for something this recorder doesn't model fails loudly
 * instead of producing a quietly incomplete trace.
 */
export function makeContext(): {
  ctx: CanvasRenderingContext2D;
  rec: RecordingContext;
} {
  const rec = new RecordingContext();
  const props = new Set<string>(TRACKED_PROPS);
  const proxy = new Proxy(rec, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (props.has(key)) return target.getProp(key);
      const value = (target as unknown as Record<string, unknown>)[key];
      if (typeof value === "function") return value.bind(target);
      if (value !== undefined) return value;
      throw new Error(`RecordingContext: unmodelled context member "${key}"`);
    },
    set(target, key, value) {
      if (typeof key === "string" && props.has(key)) {
        target.setProp(key, value);
        return true;
      }
      throw new Error(
        `RecordingContext: unmodelled context property "${String(key)}"`,
      );
    },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, rec };
}

/** A stand-in for an HTMLImageElement: the four properties the render path
 *  reads, plus an id so drawImage calls name it in the trace. */
export interface FakeImage {
  __id: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export function fakeImage(
  id: string,
  width: number,
  height: number,
): FakeImage {
  return { __id: id, width, height, naturalWidth: width, naturalHeight: height };
}
