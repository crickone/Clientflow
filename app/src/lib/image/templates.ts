/**
 * Image templates. Each template paints into a 2D canvas context at the
 * exposed natural dimensions. The same render runs for both the live preview
 * (scaled-down) and the high-resolution PNG export.
 *
 * Each render() wraps its body in ctx.save()/ctx.restore() so state cannot
 * leak between templates when the user switches.
 */

export type AspectRatio = "1:1" | "9:16" | "4:5";

export type TemplateCategory =
  | "social"
  | "stories"
  | "carousels"
  | "testimonials"
  | "promos"
  | "educational";

export interface CategoryMeta {
  id: TemplateCategory;
  label: string;
  blurb: string;
}

export const CATEGORIES: CategoryMeta[] = [
  {
    id: "social",
    label: "Social Posts",
    blurb: "Square IG feed posts with photo + heading.",
  },
  {
    id: "stories",
    label: "Stories",
    blurb: "9:16 vertical for IG / FB stories and reels covers.",
  },
  {
    id: "carousels",
    label: "Carousels",
    blurb: "Square slides designed to be posted as a 3–7 slide series.",
  },
  {
    id: "testimonials",
    label: "Testimonials",
    blurb: "Client quotes — photo or text-led.",
  },
  {
    id: "promos",
    label: "Promos",
    blurb: "Price-focused offers and packages.",
  },
  {
    id: "educational",
    label: "Educational",
    blurb: "Facts, stats, and short explainers.",
  },
];

export interface DesignState {
  headingText: string;
  bodyText: string;
  tagline: string | null;
  accentColor: string;
  /** Solid background colour used when no background photo is set. */
  backgroundColor?: string | null;
  backgroundFit: "cover" | "contain";
  backgroundOffsetX: number;
  backgroundOffsetY: number;
  backgroundZoom: number;
  /** Brand labels drawn on templates — from the account's Business Profile. */
  businessName?: string;
  website?: string;
  location?: string;
  phone?: string;
}

/** Brand strings drawn on templates, derived from the account's profile. */
function brandName(d: DesignState): string {
  return (d.businessName || "Your Business").toUpperCase();
}
function brandWeb(d: DesignState): string {
  return d.website || "";
}
/** Town/locality from the free-text location ("Park, Clonmel, Co. Tipperary" → "Clonmel"). */
function brandLocality(d: DesignState): string {
  const parts = (d.location || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts[1] : parts[0] || "";
}
function brandPhone(d: DesignState): string {
  return d.phone || "";
}

export interface FontFamilies {
  heading: string;
  body: string;
}

export interface Template {
  id: string;
  name: string;
  blurb: string;
  category: TemplateCategory;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  /**
   * Whether this template uses the tagline field. Controls whether the
   * tagline input appears in the editor for this template.
   */
  usesTagline?: boolean;
  /**
   * Default tagline shown as the placeholder hint in the editor.
   */
  taglineHint?: string;
  /**
   * Whether the template needs a photo to look right. Solid-colour templates
   * set this false so the placeholder doesn't suggest the user is missing
   * something.
   */
  requiresPhoto?: boolean;
  render: (
    ctx: CanvasRenderingContext2D,
    design: DesignState,
    bg: HTMLImageElement | null,
    fonts: FontFamilies,
  ) => void;
}

// -------------------------------------------------------------------------
//  Painters
// -------------------------------------------------------------------------

function paintBackground(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  rect: { x: number; y: number; w: number; h: number },
  design: DesignState,
  options: { showPlaceholder?: boolean } = {},
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  if (!img) {
    // A chosen solid background colour wins — fill it and stop (no placeholder).
    const solid = design.backgroundColor?.trim();
    if (solid) {
      ctx.fillStyle = solid;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      return;
    }
    if (options.showPlaceholder === false) {
      ctx.restore();
      return;
    }
    const grad = ctx.createLinearGradient(
      rect.x,
      rect.y,
      rect.x + rect.w,
      rect.y + rect.h,
    );
    grad.addColorStop(0, "#1a1a1a");
    grad.addColorStop(1, "#3a3a3a");
    ctx.fillStyle = grad;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = `500 ${Math.round(Math.min(rect.w, rect.h) * 0.035)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "Drop a photo or pick a background colour",
      rect.x + rect.w / 2,
      rect.y + rect.h / 2,
    );
    ctx.restore();
    return;
  }

  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) {
    ctx.restore();
    return;
  }

  const targetAspect = rect.w / rect.h;
  const sourceAspect = naturalW / naturalH;

  let baseScale: number;
  if (design.backgroundFit === "cover") {
    baseScale =
      sourceAspect > targetAspect ? rect.h / naturalH : rect.w / naturalW;
  } else {
    baseScale =
      sourceAspect > targetAspect ? rect.w / naturalW : rect.h / naturalH;
  }
  const scale = baseScale * Math.max(1, design.backgroundZoom);

  const drawW = naturalW * scale;
  const drawH = naturalH * scale;

  const offsetX = (design.backgroundOffsetX ?? 0.5) * (drawW - rect.w);
  const offsetY = (design.backgroundOffsetY ?? 0.5) * (drawH - rect.h);

  if (design.backgroundFit === "contain") {
    ctx.fillStyle = design.backgroundColor?.trim() || "#0a0a0a";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  ctx.drawImage(img, rect.x - offsetX, rect.y - offsetY, drawW, drawH);
  ctx.restore();
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (!text.trim()) return [];
  const paragraphs = text.split(/\n+/);
  const out: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      const w = ctx.measureText(test).width;
      if (w > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function paintLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
): number {
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y + i * lineHeight);
  }
  return y + lines.length * lineHeight;
}

function bottomGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  start: number,
) {
  const grad = ctx.createLinearGradient(0, start, 0, h);
  grad.addColorStop(0, "rgba(10,10,10,0)");
  grad.addColorStop(0.55, "rgba(10,10,10,0.55)");
  grad.addColorStop(1, "rgba(10,10,10,0.92)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, start, w, h - start);
}

function topGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  end: number,
) {
  const grad = ctx.createLinearGradient(0, 0, 0, end);
  grad.addColorStop(0, "rgba(10,10,10,0.7)");
  grad.addColorStop(1, "rgba(10,10,10,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, end);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
) {
  const inner = r * 0.4;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? r : inner;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function autoFitHeading(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: string,
  family: string,
  startSize: number,
  minSize: number,
  maxWidth: number,
  maxLines: number,
): { size: number; lines: string[] } {
  let size = startSize;
  while (size >= minSize) {
    ctx.font = `${weight} ${size}px ${family}`;
    const lines = wrapLines(ctx, text, maxWidth);
    if (lines.length <= maxLines) {
      return { size, lines };
    }
    size -= 2;
  }
  ctx.font = `${weight} ${minSize}px ${family}`;
  return { size: minSize, lines: wrapLines(ctx, text, maxWidth) };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const v = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const num = parseInt(v, 16);
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

function readableTextOn(hex: string): "#ffffff" | "#0a0a0a" {
  const { r, g, b } = hexToRgb(hex);
  // Standard luminance formula
  const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return l > 0.62 ? "#0a0a0a" : "#ffffff";
}

// =========================================================================
//  Templates — Social Posts
// =========================================================================

const BOLD_HEADLINE: Template = {
  id: "bold-headline",
  name: "Bold Headline",
  blurb: "Full-bleed photo with a bold Nebula heading anchored at the bottom.",
  category: "social",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);
    bottomGradient(ctx, W, H, H * 0.38);

    const padX = Math.round(W * 0.085);
    const padTop = Math.round(H * 0.075);
    const padBottom = Math.round(H * 0.085);
    const innerW = W - padX * 2;

    // Top badge
    const badgeText = "BOOK A SESSION";
    ctx.font = `600 ${Math.round(H * 0.019)}px ${fonts.body}`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    const badgeTextW = ctx.measureText(badgeText).width;
    const badgePadH = Math.round(H * 0.022);
    const badgePadV = Math.round(H * 0.013);
    const badgeH = Math.round(H * 0.019) + badgePadV * 2;
    const badgeW = badgeTextW + badgePadH * 2;
    const badgeX = W - padX - badgeW;
    const badgeY = padTop;
    ctx.fillStyle = design.accentColor;
    roundedRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Body
    const bodySize = Math.round(H * 0.024);
    const bodyLine = Math.round(bodySize * 1.4);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText || "Optional supporting copy goes here.",
      innerW,
    ).slice(0, 2);

    // Heading
    const heading = (design.headingText || "Your heading here").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.075),
      Math.round(H * 0.045),
      innerW,
      3,
    );
    const headingLine = Math.round(fit.size * 1.06);
    const headingBlock = fit.lines.length * headingLine;
    const bodyBlock = bodyLines.length * bodyLine;

    const eyebrowSize = Math.round(H * 0.018);
    const eyebrowGap = Math.round(H * 0.022);
    const bodyGap = Math.round(H * 0.025);
    const stackHeight =
      eyebrowSize +
      eyebrowGap +
      headingBlock +
      (bodyLines.length ? bodyGap + bodyBlock : 0);
    const stackBottom = H - padBottom;
    const stackTop = stackBottom - stackHeight;

    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${eyebrowSize}px ${fonts.body}`;
    ctx.fillText(brandName(design), padX, stackTop + eyebrowSize);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    const headingTop = stackTop + eyebrowSize + eyebrowGap;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyTop = headingTop + headingBlock + bodyGap;
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }
    ctx.restore();
  },
};

const SIDE_CARD: Template = {
  id: "side-card",
  name: "Side-Card",
  blurb: "Photo on the left, white card on the right with your copy.",
  category: "social",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    const splitX = Math.round(W * 0.52);
    paintBackground(ctx, bg, { x: 0, y: 0, w: splitX, h: H }, design);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(splitX, 0, W - splitX, H);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(splitX, 0, Math.max(6, Math.round(W * 0.007)), H);

    const cardPadX = Math.round(W * 0.045);
    const padX = splitX + cardPadX;
    const padTop = Math.round(H * 0.085);
    const padBottom = Math.round(H * 0.085);
    const innerW = W - splitX - cardPadX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    const bodySize = Math.round(H * 0.022);
    const bodyLine = Math.round(bodySize * 1.45);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText || "Add your supporting copy here.",
      innerW,
    ).slice(0, 4);

    const heading = (design.headingText || "Add your supporting line here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.058),
      Math.round(H * 0.034),
      innerW,
      4,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;

    const eyebrowSize = Math.round(H * 0.018);
    const dividerW = Math.round(innerW * 0.16);
    const dividerH = 2;
    const eyebrowGap = Math.round(H * 0.028);
    const dividerGap = Math.round(H * 0.022);
    const bodyGap = Math.round(H * 0.028);
    const bodyBlock = bodyLines.length * bodyLine;
    const stackHeight =
      eyebrowSize +
      eyebrowGap +
      headingBlock +
      dividerGap +
      dividerH +
      (bodyLines.length ? bodyGap + bodyBlock : 0);
    const availableH = H - padTop - padBottom;
    const stackTop = padTop + Math.max(0, (availableH - stackHeight) / 2);

    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${eyebrowSize}px ${fonts.body}`;
    ctx.fillText(brandName(design), padX, stackTop + eyebrowSize);

    ctx.fillStyle = "#0a0a0a";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    const headingTop = stackTop + eyebrowSize + eyebrowGap;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    ctx.fillStyle = "rgba(10,10,10,0.22)";
    const dividerY = headingTop + headingBlock + dividerGap;
    ctx.fillRect(padX, dividerY, dividerW, dividerH);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(10,10,10,0.7)";
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyTop = dividerY + dividerH + bodyGap;
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    ctx.fillStyle = "rgba(10,10,10,0.45)";
    ctx.font = `500 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.fillText(brandWeb(design), padX, H - padBottom + H * 0.018);
    ctx.restore();
  },
};

const CENTERED_STATEMENT: Template = {
  id: "centered-statement",
  name: "Centered Statement",
  blurb: "Minimal photo, big centred heading. Poster-style ad.",
  category: "social",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);

    // Full-canvas dark overlay so big text is always readable
    ctx.fillStyle = "rgba(10,10,10,0.5)";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.1);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    // Top eyebrow
    const eyebrowSize = Math.round(H * 0.017);
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${eyebrowSize}px ${fonts.body}`;
    ctx.fillText(brandName(design), W / 2, Math.round(H * 0.1));

    // Heading centred vertically
    const heading = (design.headingText || "Your headline\ngoes here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.085),
      Math.round(H * 0.05),
      innerW,
      4,
    );
    const headingLine = Math.round(fit.size * 1.06);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2;

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, W / 2, headingTop + fit.size, headingLine);

    // Accent rule under heading
    const ruleY = headingTop + headingBlock + Math.round(H * 0.03);
    const ruleW = Math.round(W * 0.1);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect((W - ruleW) / 2, ruleY, ruleW, 3);

    // Body
    if (design.bodyText.trim()) {
      const bodySize = Math.round(H * 0.022);
      const bodyLine = Math.round(bodySize * 1.45);
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyLines = wrapLines(ctx, design.bodyText, innerW).slice(0, 2);
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      paintLines(
        ctx,
        bodyLines,
        W / 2,
        ruleY + Math.round(H * 0.04) + bodySize,
        bodyLine,
      );
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `500 ${Math.round(H * 0.015)}px ${fonts.body}`;
    ctx.fillText(`${brandLocality(design).toUpperCase()}  ·  ${brandWeb(design)}`, W / 2, H - Math.round(H * 0.075));
    ctx.restore();
  },
};

const TOP_BANNER: Template = {
  id: "top-banner",
  name: "Top Banner",
  blurb: "Accent band on top with the heading, photo full-bleed below.",
  category: "social",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    const bandH = Math.round(H * 0.36);
    // Photo zone (bottom)
    paintBackground(
      ctx,
      bg,
      { x: 0, y: bandH, w: W, h: H - bandH },
      design,
    );
    bottomGradient(ctx, W, H, H * 0.7);

    // Accent band
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(0, 0, W, bandH);

    const textColor = readableTextOn(design.accentColor);
    const subtle = textColor === "#ffffff" ? "rgba(255,255,255,0.85)" : "rgba(10,10,10,0.7)";

    const padX = Math.round(W * 0.085);
    const innerW = W - padX * 2;
    const padTop = Math.round(H * 0.075);
    const padBottom = Math.round(H * 0.075);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Eyebrow inside band
    const eyebrowSize = Math.round(H * 0.018);
    ctx.fillStyle = textColor;
    ctx.font = `600 ${eyebrowSize}px ${fonts.body}`;
    ctx.fillText(brandName(design), padX, padTop + eyebrowSize);

    // Heading inside band
    const heading = (design.headingText || "Your headline goes here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.058),
      Math.round(H * 0.035),
      innerW,
      3,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = padTop + eyebrowSize + Math.round(H * 0.025);

    ctx.fillStyle = textColor;
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Body text overlay near bottom of photo
    const bodySize = Math.round(H * 0.022);
    const bodyLine = Math.round(bodySize * 1.45);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText || "60 minutes in Clonmel can change the rest of your week.",
      innerW,
    ).slice(0, 3);
    const bodyBlock = bodyLines.length * bodyLine;

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      const bodyTop = H - padBottom - bodyBlock;
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }
    ctx.restore();
  },
};

const STAT_BLOCK: Template = {
  id: "stat-block",
  name: "Stat Block",
  blurb: "Photo background with a huge stat number front and centre.",
  category: "social",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  usesTagline: true,
  taglineHint: "MINUTES PER SESSION",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);
    ctx.fillStyle = "rgba(10,10,10,0.62)";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.085);
    const padTop = Math.round(H * 0.08);
    const padBottom = Math.round(H * 0.08);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";

    // Top eyebrow
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.018)}px ${fonts.body}`;
    ctx.textAlign = "center";
    ctx.fillText(brandName(design), W / 2, padTop + Math.round(H * 0.018));

    // Giant stat (heading) — wraps to fit width so a long heading can't overflow.
    const stat = (design.headingText || "60").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      stat,
      "400",
      fonts.heading,
      Math.round(H * 0.34),
      Math.round(H * 0.06),
      innerW,
      2,
    );
    ctx.fillStyle = design.accentColor;
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    const statLineH = Math.round(fit.size * 0.9);
    const statCenter = H / 2 - Math.round(H * 0.04);
    const firstBaseline = Math.round(
      statCenter - (statLineH * (fit.lines.length - 1)) / 2,
    );
    fit.lines.forEach((ln, i) =>
      ctx.fillText(ln, W / 2, firstBaseline + i * statLineH),
    );
    const statBottom = firstBaseline + (fit.lines.length - 1) * statLineH;

    // Unit label (tagline)
    const tagline = (design.tagline ?? "").trim() || "MINUTES PER SESSION";
    const tagSize = Math.round(H * 0.026);
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${tagSize}px ${fonts.body}`;
    ctx.fillText(tagline, W / 2, statBottom + Math.round(H * 0.05));

    // Accent rule
    const ruleW = Math.round(W * 0.1);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(
      (W - ruleW) / 2,
      statBottom + Math.round(H * 0.075),
      ruleW,
      3,
    );

    // Body text
    if (design.bodyText.trim()) {
      const bodySize = Math.round(H * 0.022);
      const bodyLine = Math.round(bodySize * 1.5);
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyLines = wrapLines(ctx, design.bodyText, innerW).slice(0, 3);
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      paintLines(
        ctx,
        bodyLines,
        W / 2,
        statBottom + Math.round(H * 0.115) + bodySize,
        bodyLine,
      );
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `500 ${Math.round(H * 0.015)}px ${fonts.body}`;
    ctx.fillText(`${brandLocality(design).toUpperCase()}  ·  ${brandWeb(design)}`, W / 2, H - padBottom);
    ctx.restore();
  },
};

const FRAME: Template = {
  id: "frame",
  name: "Frame",
  blurb: "Photo in a contained square on a cream background — gallery vibes.",
  category: "social",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();

    // Off-white background with a soft accent tint
    const { r, g, b } = hexToRgb(design.accentColor);
    ctx.fillStyle = "#faf8f4";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `rgba(${r},${g},${b},0.04)`;
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.085);
    const innerW = W - padX * 2;
    const padTop = Math.round(H * 0.08);
    const padBottom = Math.round(H * 0.08);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Eyebrow
    const eyebrowSize = Math.round(H * 0.017);
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${eyebrowSize}px ${fonts.body}`;
    ctx.fillText(brandName(design), padX, padTop + eyebrowSize);

    // Heading
    const heading = (design.headingText || "A new way to feel like yourself.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.04),
      Math.round(H * 0.028),
      innerW,
      2,
    );
    const headingLine = Math.round(fit.size * 1.1);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = padTop + eyebrowSize + Math.round(H * 0.022);

    ctx.fillStyle = "#0a0a0a";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Pre-measure body + footer so we know how much vertical room is left
    // for the photo. Build the layout from the bottom up — guarantees the
    // body text never collides with the footer.
    const bodySize = Math.round(H * 0.02);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add your supporting copy here.",
      innerW,
    ).slice(0, 2);
    const bodyBlock = bodyLines.length * bodyLine;

    const footerSize = Math.round(H * 0.014);
    const footerY = H - padBottom; // baseline of the footer line
    const bodyToFooterGap = Math.round(H * 0.04);
    const bodyBottom = footerY - footerSize - bodyToFooterGap;
    const bodyTop = bodyBottom - bodyBlock;

    // Photo sits between heading and body — sized to fit whatever space is
    // left over, capped at 62% width so it stays photo-like rather than
    // stretching uncomfortably wide.
    const photoToHeadingGap = Math.round(H * 0.035);
    const photoToBodyGap = Math.round(H * 0.04);
    const photoAccentH = 4;
    const photoMinTop = headingTop + headingBlock + photoToHeadingGap;
    const photoMaxBottom = bodyTop - photoToBodyGap - photoAccentH;
    const availablePhotoH = Math.max(0, photoMaxBottom - photoMinTop);
    const photoSize = Math.min(availablePhotoH, Math.round(W * 0.62));
    const photoX = (W - photoSize) / 2;
    // Centre the photo vertically inside its available band
    const photoTop =
      photoMinTop + Math.max(0, (availablePhotoH - photoSize) / 2);

    paintBackground(
      ctx,
      bg,
      { x: photoX, y: photoTop, w: photoSize, h: photoSize },
      design,
    );

    // Photo border accent rule
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(photoX, photoTop + photoSize, photoSize, photoAccentH);

    // Body
    if (bodyLines.length) {
      ctx.fillStyle = "rgba(10,10,10,0.7)";
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      ctx.textAlign = "left";
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    // Footer
    ctx.fillStyle = "rgba(10,10,10,0.5)";
    ctx.font = `500 ${footerSize}px ${fonts.body}`;
    ctx.fillText(`${brandWeb(design)}  ·  ${brandLocality(design)}`, padX, footerY);
    ctx.restore();
  },
};

const MAGAZINE: Template = {
  id: "magazine",
  name: "Magazine Cover",
  blurb: "Masthead at the top, photo middle, big heading anchored at the bottom.",
  category: "social",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  usesTagline: true,
  taglineHint: "ISSUE 03  ·  MAY 2026",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);

    // Bottom dark gradient for heading legibility
    bottomGradient(ctx, W, H, H * 0.42);
    // Top fade so masthead reads
    topGradient(ctx, W, Math.round(H * 0.18));

    const padX = Math.round(W * 0.075);
    const innerW = W - padX * 2;
    const padTop = Math.round(H * 0.07);
    const padBottom = Math.round(H * 0.075);

    ctx.textBaseline = "alphabetic";

    // Masthead
    const masthead = brandName(design);
    const mastSize = Math.round(H * 0.085);
    ctx.font = `400 ${mastSize}px ${fonts.heading}`;
    ctx.fillStyle = design.accentColor;
    ctx.textAlign = "left";
    ctx.fillText(masthead, padX, padTop + mastSize);

    // Issue line (tagline) — top right
    const issueLine = (design.tagline ?? "").trim() || "ISSUE 03  ·  MAY 2026";
    const issueSize = Math.round(H * 0.016);
    ctx.font = `600 ${issueSize}px ${fonts.body}`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "right";
    ctx.fillText(issueLine, W - padX, padTop + mastSize - Math.round(H * 0.005));

    // Hairline under masthead
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(padX, padTop + mastSize + Math.round(H * 0.012), innerW, 1);

    // Sub-masthead
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `600 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.textAlign = "left";
    ctx.fillText(
      `${brandLocality(design).toUpperCase()}`,
      padX,
      padTop + mastSize + Math.round(H * 0.034),
    );

    // Heading anchored from bottom
    const heading = (design.headingText || "The week we slowed down to come back stronger.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.068),
      Math.round(H * 0.042),
      innerW,
      3,
    );
    const headingLine = Math.round(fit.size * 1.06);
    const headingBlock = fit.lines.length * headingLine;

    const bodySize = Math.round(H * 0.022);
    const bodyLine = Math.round(bodySize * 1.45);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add your supporting copy here.",
      innerW,
    ).slice(0, 2);
    const bodyBlock = bodyLines.length * bodyLine;

    const bodyGap = Math.round(H * 0.025);
    const stackHeight =
      headingBlock + (bodyLines.length ? bodyGap + bodyBlock : 0);
    const stackBottom = H - padBottom;
    const stackTop = stackBottom - stackHeight;

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    ctx.textAlign = "left";
    paintLines(ctx, fit.lines, padX, stackTop + fit.size, headingLine);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyTop = stackTop + headingBlock + bodyGap;
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }
    ctx.restore();
  },
};

const QUESTION_HOOK: Template = {
  id: "question-hook",
  name: "Question Hook",
  blurb: "Carousel opener — big question over a dimmed photo, scroll-stopper.",
  category: "carousels",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  usesTagline: true,
  taglineHint: "01 / 05",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);
    ctx.fillStyle = "rgba(10,10,10,0.66)";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.085);
    const padTop = Math.round(H * 0.085);
    const padBottom = Math.round(H * 0.085);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Big accent question mark
    const markSize = Math.round(H * 0.18);
    ctx.fillStyle = design.accentColor;
    ctx.font = `400 ${markSize}px ${fonts.heading}`;
    ctx.fillText("?", padX, padTop + markSize);

    // Slide indicator (top-right, from tagline)
    const tagline = (design.tagline ?? "").trim() || "01 / 05";
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.02)}px ${fonts.body}`;
    ctx.textAlign = "right";
    ctx.fillText(tagline, W - padX, padTop + Math.round(H * 0.025));

    // Heading (the question)
    const heading = (design.headingText || "Ask your audience a question here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.062),
      Math.round(H * 0.04),
      innerW,
      4,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = padTop + markSize + Math.round(H * 0.03);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    ctx.textAlign = "left";
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Accent rule
    const ruleY = headingTop + headingBlock + Math.round(H * 0.03);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(padX, ruleY, Math.round(W * 0.08), 3);

    // Body (the hook continuation)
    const bodySize = Math.round(H * 0.024);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add your supporting copy here.",
      innerW,
    ).slice(0, 3);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      const bodyTop = ruleY + Math.round(H * 0.035);
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    // Footer — brand on left, swipe hint on right
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `500 ${Math.round(H * 0.015)}px ${fonts.body}`;
    ctx.textAlign = "left";
    ctx.fillText(brandName(design), padX, H - padBottom);
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.textAlign = "right";
    ctx.fillText("SWIPE  →", W - padX, H - padBottom);
    ctx.restore();
  },
};

// =========================================================================
//  Templates — Stories
// =========================================================================

const STORY_HERO: Template = {
  id: "story-hero",
  name: "Story Hero",
  blurb: "9:16 story — eyebrow up top, big heading anchored near the bottom.",
  category: "stories",
  aspectRatio: "9:16",
  width: 1080,
  height: 1920,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);
    topGradient(ctx, W, Math.round(H * 0.22));
    bottomGradient(ctx, W, H, Math.round(H * 0.4));

    const padX = Math.round(W * 0.09);
    const padTop = Math.round(H * 0.075);
    const padBottom = Math.round(H * 0.075);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    const eyebrowSize = Math.round(H * 0.015);
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${eyebrowSize}px ${fonts.body}`;
    ctx.textAlign = "center";
    ctx.fillText(brandName(design), W / 2, padTop + eyebrowSize);

    const footerSize = Math.round(H * 0.014);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `500 ${footerSize}px ${fonts.body}`;
    ctx.fillText(`${brandLocality(design).toUpperCase()}  ·  ${brandWeb(design)}`, W / 2, H - padBottom);

    const bodySize = Math.round(H * 0.018);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add your supporting copy here.",
      innerW,
    ).slice(0, 3);

    const heading = (design.headingText || "Your headline goes here").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.05),
      Math.round(H * 0.032),
      innerW,
      4,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const bodyBlock = bodyLines.length * bodyLine;
    const accentH = 4;
    const accentGap = Math.round(H * 0.025);
    const bodyGap = Math.round(H * 0.022);

    const footerOffset = Math.round(H * 0.045);
    const stackBottom = H - padBottom - footerOffset;
    const stackHeight =
      accentH +
      accentGap +
      headingBlock +
      (bodyLines.length ? bodyGap + bodyBlock : 0);
    const stackTop = stackBottom - stackHeight;

    ctx.fillStyle = design.accentColor;
    const barW = Math.round(W * 0.08);
    ctx.fillRect((W - barW) / 2, stackTop, barW, accentH);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    ctx.textAlign = "center";
    const headingTop = stackTop + accentH + accentGap;
    paintLines(ctx, fit.lines, W / 2, headingTop + fit.size, headingLine);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyTop = headingTop + headingBlock + bodyGap;
      paintLines(ctx, bodyLines, W / 2, bodyTop + bodySize, bodyLine);
    }
    ctx.restore();
  },
};

const STORY_SPLIT: Template = {
  id: "story-split",
  name: "Story Split",
  blurb: "9:16 — photo top half, white card bottom half with copy.",
  category: "stories",
  aspectRatio: "9:16",
  width: 1080,
  height: 1920,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    const splitY = Math.round(H * 0.5);
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: splitY }, design);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, splitY, W, H - splitY);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(0, splitY, W, Math.max(6, Math.round(H * 0.004)));

    const padX = Math.round(W * 0.085);
    const innerW = W - padX * 2;
    const cardTop = splitY + Math.round(H * 0.05);
    const cardBottom = H - Math.round(H * 0.07);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    const eyebrowSize = Math.round(H * 0.014);
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${eyebrowSize}px ${fonts.body}`;
    ctx.fillText(brandName(design), padX, cardTop + eyebrowSize);

    const heading = (design.headingText || "Your headline goes here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.05),
      Math.round(H * 0.032),
      innerW,
      4,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;

    ctx.fillStyle = "#0a0a0a";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    const headingTop = cardTop + eyebrowSize + Math.round(H * 0.025);
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    const bodySize = Math.round(H * 0.018);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add your supporting copy here.",
      innerW,
    ).slice(0, 4);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(10,10,10,0.7)";
      const bodyTop = headingTop + headingBlock + Math.round(H * 0.025);
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    ctx.fillStyle = "rgba(10,10,10,0.5)";
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(`${brandLocality(design).toUpperCase()}  ·  ${brandWeb(design)}`, padX, cardBottom);
    ctx.restore();
  },
};

const STORY_MINIMAL: Template = {
  id: "story-minimal",
  name: "Story Minimal",
  blurb: "Solid-colour 9:16 story with just text. No photo needed.",
  category: "stories",
  aspectRatio: "9:16",
  width: 1080,
  height: 1920,
  requiresPhoto: false,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();

    // Solid background in accent colour
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(0, 0, W, H);

    // Subtle gradient sheen
    const sheen = ctx.createLinearGradient(0, 0, 0, H);
    sheen.addColorStop(0, "rgba(255,255,255,0.06)");
    sheen.addColorStop(1, "rgba(0,0,0,0.18)");
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);

    const textColor = readableTextOn(design.accentColor);
    const subtle = textColor === "#ffffff" ? "rgba(255,255,255,0.82)" : "rgba(10,10,10,0.72)";

    const padX = Math.round(W * 0.1);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    // Eyebrow
    const eyebrowSize = Math.round(H * 0.015);
    ctx.fillStyle = textColor;
    ctx.font = `600 ${eyebrowSize}px ${fonts.body}`;
    ctx.fillText(brandName(design), W / 2, Math.round(H * 0.1));

    // Heading
    const heading = (design.headingText || "Your headline goes here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.07),
      Math.round(H * 0.04),
      innerW,
      5,
    );
    const headingLine = Math.round(fit.size * 1.06);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2;

    ctx.fillStyle = textColor;
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, W / 2, headingTop + fit.size, headingLine);

    // Underline rule
    const ruleW = Math.round(W * 0.12);
    ctx.fillStyle = subtle;
    ctx.fillRect((W - ruleW) / 2, headingTop + headingBlock + Math.round(H * 0.03), ruleW, 3);

    // Body
    if (design.bodyText.trim()) {
      const bodySize = Math.round(H * 0.02);
      const bodyLine = Math.round(bodySize * 1.5);
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyLines = wrapLines(ctx, design.bodyText, innerW).slice(0, 3);
      ctx.fillStyle = subtle;
      paintLines(
        ctx,
        bodyLines,
        W / 2,
        headingTop + headingBlock + Math.round(H * 0.07) + bodySize,
        bodyLine,
      );
    }

    // Footer
    ctx.fillStyle = subtle;
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(`${brandLocality(design).toUpperCase()}  ·  ${brandWeb(design)}`, W / 2, H - Math.round(H * 0.075));
    ctx.restore();
  },
};

const STORY_QUOTE: Template = {
  id: "story-quote",
  name: "Story Quote",
  blurb: "9:16 — testimonial story with a big centred quote.",
  category: "stories",
  aspectRatio: "9:16",
  width: 1080,
  height: 1920,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);
    ctx.fillStyle = "rgba(10,10,10,0.6)";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.09);
    const padTop = Math.round(H * 0.08);
    const padBottom = Math.round(H * 0.08);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    // Eyebrow
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.015)}px ${fonts.body}`;
    ctx.fillText("CLIENT STORY", W / 2, padTop + Math.round(H * 0.015));

    // Big accent quote mark
    const markH = Math.round(H * 0.045);
    const markW = Math.round(H * 0.075);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect((W - markW) / 2, H * 0.27, markW, markH);

    // Quote heading
    const heading = (design.headingText || "Add a client quote here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.052),
      Math.round(H * 0.035),
      innerW,
      6,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2 + Math.round(H * 0.02);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, W / 2, headingTop + fit.size, headingLine);

    // Accent rule
    const ruleY = headingTop + headingBlock + Math.round(H * 0.035);
    const ruleW = Math.round(W * 0.12);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect((W - ruleW) / 2, ruleY, ruleW, 3);

    // Attribution body
    if (design.bodyText.trim()) {
      const bodySize = Math.round(H * 0.018);
      const bodyLine = Math.round(bodySize * 1.5);
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyLines = wrapLines(ctx, design.bodyText, innerW).slice(0, 3);
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      paintLines(
        ctx,
        bodyLines,
        W / 2,
        ruleY + Math.round(H * 0.04) + bodySize,
        bodyLine,
      );
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `400 ${Math.round(H * 0.018)}px ${fonts.body}`;
      ctx.fillText("— Happy client", W / 2, ruleY + Math.round(H * 0.06));
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(`${brandName(design)}  ·  ${brandLocality(design).toUpperCase()}`, W / 2, H - padBottom);
    ctx.restore();
  },
};

const STORY_STAT: Template = {
  id: "story-stat",
  name: "Story Stat",
  blurb: "9:16 — giant stat number with a label, dimmed photo behind.",
  category: "stories",
  aspectRatio: "9:16",
  width: 1080,
  height: 1920,
  requiresPhoto: true,
  usesTagline: true,
  taglineHint: "MINUTES PER SESSION",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);
    ctx.fillStyle = "rgba(10,10,10,0.66)";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.09);
    const padTop = Math.round(H * 0.075);
    const padBottom = Math.round(H * 0.075);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    // Eyebrow
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.015)}px ${fonts.body}`;
    ctx.fillText(brandName(design), W / 2, padTop + Math.round(H * 0.015));

    // Giant stat — wraps to fit width so a long heading can't overflow.
    const stat = (design.headingText || "60").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      stat,
      "400",
      fonts.heading,
      Math.round(H * 0.3),
      Math.round(H * 0.05),
      innerW,
      2,
    );
    ctx.fillStyle = design.accentColor;
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    const statLineH = Math.round(fit.size * 0.9);
    const statCenter = H / 2 - Math.round(H * 0.04);
    const firstBaseline = Math.round(
      statCenter - (statLineH * (fit.lines.length - 1)) / 2,
    );
    fit.lines.forEach((ln, i) =>
      ctx.fillText(ln, W / 2, firstBaseline + i * statLineH),
    );
    const statBottom = firstBaseline + (fit.lines.length - 1) * statLineH;

    // Unit
    const tagline = (design.tagline ?? "").trim() || "MINUTES PER SESSION";
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.022)}px ${fonts.body}`;
    ctx.fillText(tagline, W / 2, statBottom + Math.round(H * 0.05));

    // Accent rule
    const ruleW = Math.round(W * 0.1);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect((W - ruleW) / 2, statBottom + Math.round(H * 0.075), ruleW, 3);

    // Body
    if (design.bodyText.trim()) {
      const bodySize = Math.round(H * 0.018);
      const bodyLine = Math.round(bodySize * 1.5);
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyLines = wrapLines(ctx, design.bodyText, innerW).slice(0, 3);
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      paintLines(
        ctx,
        bodyLines,
        W / 2,
        statBottom + Math.round(H * 0.12) + bodySize,
        bodyLine,
      );
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(`${brandLocality(design).toUpperCase()}  ·  ${brandWeb(design)}`, W / 2, H - padBottom);
    ctx.restore();
  },
};

// =========================================================================
//  Templates — Carousels
// =========================================================================

const CAROUSEL_COVER: Template = {
  id: "carousel-cover",
  name: "Carousel Cover",
  blurb: "Series opener — big title, photo background, slide indicator.",
  category: "carousels",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  usesTagline: true,
  taglineHint: "01 / 05",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);
    // Strong overlay so cover reads at thumb size
    ctx.fillStyle = "rgba(10,10,10,0.55)";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.085);
    const padTop = Math.round(H * 0.085);
    const padBottom = Math.round(H * 0.085);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";

    // Slide indicator (top-right)
    const tagline = (design.tagline ?? "").trim() || "01 / 05";
    const indicatorSize = Math.round(H * 0.022);
    ctx.font = `600 ${indicatorSize}px ${fonts.body}`;
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(tagline, W - padX, padTop + indicatorSize);

    // "SWIPE →" hint in bottom-right
    const hintSize = Math.round(H * 0.018);
    ctx.font = `600 ${hintSize}px ${fonts.body}`;
    ctx.fillStyle = design.accentColor;
    ctx.fillText("SWIPE  →", W - padX, H - padBottom);

    // Brand eyebrow (top-left)
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.018)}px ${fonts.body}`;
    ctx.textAlign = "left";
    ctx.fillText(brandName(design), padX, padTop + indicatorSize);

    // Centred heading (vertically)
    const heading = (design.headingText || "5 quick tips to get started").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.085),
      Math.round(H * 0.05),
      innerW,
      4,
    );
    const headingLine = Math.round(fit.size * 1.06);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2;

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Accent rule under heading
    ctx.fillStyle = design.accentColor;
    const ruleW = Math.round(W * 0.08);
    ctx.fillRect(padX, headingTop + headingBlock + Math.round(H * 0.025), ruleW, 3);

    // Body subhead
    if (design.bodyText.trim()) {
      const bodySize = Math.round(H * 0.022);
      const bodyLine = Math.round(bodySize * 1.5);
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyLines = wrapLines(ctx, design.bodyText, innerW).slice(0, 2);
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      paintLines(
        ctx,
        bodyLines,
        padX,
        headingTop + headingBlock + Math.round(H * 0.06) + bodySize,
        bodyLine,
      );
    }

    ctx.restore();
  },
};

const CAROUSEL_CONTENT: Template = {
  id: "carousel-content",
  name: "Carousel Content",
  blurb: "Middle slide with a number, heading, and body. Photo optional.",
  category: "carousels",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  usesTagline: true,
  taglineHint: "02",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();

    // Soft accent-tinted background
    const { r, g, b } = hexToRgb(design.accentColor);
    ctx.fillStyle = `rgba(${r},${g},${b},0.06)`;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.085);
    const padTop = Math.round(H * 0.08);
    const padBottom = Math.round(H * 0.08);
    const innerW = W - padX * 2;

    // Optional photo block in the top-right
    if (bg) {
      const photoSize = Math.round(W * 0.32);
      paintBackground(
        ctx,
        bg,
        {
          x: W - padX - photoSize,
          y: padTop,
          w: photoSize,
          h: photoSize,
        },
        design,
        { showPlaceholder: false },
      );
    }

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Big slide number
    const tagline = (design.tagline ?? "").trim() || "02";
    const numberSize = Math.round(H * 0.16);
    ctx.font = `400 ${numberSize}px ${fonts.heading}`;
    ctx.fillStyle = design.accentColor;
    ctx.fillText(tagline, padX, padTop + numberSize);

    // Accent rule below number
    const ruleY = padTop + numberSize + Math.round(H * 0.02);
    ctx.fillRect(padX, ruleY, Math.round(W * 0.08), 3);

    // Heading
    const heading = (design.headingText || "Why this works for you").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.06),
      Math.round(H * 0.038),
      innerW,
      3,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = ruleY + Math.round(H * 0.035);

    ctx.fillStyle = "#0a0a0a";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Body
    const bodySize = Math.round(H * 0.022);
    const bodyLine = Math.round(bodySize * 1.55);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add your supporting copy here.",
      innerW,
    ).slice(0, 6);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(10,10,10,0.72)";
      const bodyTop = headingTop + headingBlock + Math.round(H * 0.03);
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    // Footer
    ctx.fillStyle = "rgba(10,10,10,0.45)";
    ctx.font = `500 ${Math.round(H * 0.015)}px ${fonts.body}`;
    ctx.fillText(`${brandName(design)}  ·  ${brandLocality(design).toUpperCase()}`, padX, H - padBottom);
    ctx.textAlign = "right";
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.fillText("SWIPE  →", W - padX, H - padBottom);
    ctx.restore();
  },
};

const CAROUSEL_CTA: Template = {
  id: "carousel-cta",
  name: "Carousel CTA",
  blurb: "Closing slide — big call to action with contact details.",
  category: "carousels",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  usesTagline: true,
  taglineHint: "05 / 05",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();

    // Solid accent background
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(0, 0, W, H);

    // Subtle vignette
    const grad = ctx.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, W * 0.7);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const textColor = readableTextOn(design.accentColor);
    const subtle = textColor === "#ffffff" ? "rgba(255,255,255,0.85)" : "rgba(10,10,10,0.72)";

    const padX = Math.round(W * 0.085);
    const padTop = Math.round(H * 0.085);
    const padBottom = Math.round(H * 0.085);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";

    // Slide indicator
    const tagline = (design.tagline ?? "").trim() || "05 / 05";
    ctx.font = `600 ${Math.round(H * 0.022)}px ${fonts.body}`;
    ctx.textAlign = "right";
    ctx.fillStyle = textColor;
    ctx.fillText(tagline, W - padX, padTop + Math.round(H * 0.022));

    // Eyebrow
    ctx.fillStyle = textColor;
    ctx.font = `600 ${Math.round(H * 0.02)}px ${fonts.body}`;
    ctx.textAlign = "center";
    ctx.fillText("BOOK YOUR FIRST SESSION", W / 2, H * 0.32);

    // Big heading
    const heading = (design.headingText || "We're 30 minutes\nfrom you.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.085),
      Math.round(H * 0.05),
      innerW,
      3,
    );
    const headingLine = Math.round(fit.size * 1.06);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2 + Math.round(H * 0.02);

    ctx.fillStyle = textColor;
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, W / 2, headingTop + fit.size, headingLine);

    // Body
    if (design.bodyText.trim()) {
      const bodySize = Math.round(H * 0.022);
      const bodyLine = Math.round(bodySize * 1.5);
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyLines = wrapLines(ctx, design.bodyText, innerW).slice(0, 3);
      ctx.fillStyle = subtle;
      paintLines(
        ctx,
        bodyLines,
        W / 2,
        headingTop + headingBlock + Math.round(H * 0.04) + bodySize,
        bodyLine,
      );
    }

    // CTA pill at bottom
    const ctaText = `${brandWeb(design).toUpperCase()}  ·  ${brandPhone(design)}`;
    ctx.font = `600 ${Math.round(H * 0.017)}px ${fonts.body}`;
    const ctaTextW = ctx.measureText(ctaText).width;
    const ctaPadH = Math.round(H * 0.025);
    const ctaPadV = Math.round(H * 0.013);
    const ctaH = Math.round(H * 0.017) + ctaPadV * 2;
    const ctaW = ctaTextW + ctaPadH * 2;
    const ctaX = (W - ctaW) / 2;
    const ctaY = H - padBottom - ctaH;
    ctx.fillStyle = textColor;
    roundedRect(ctx, ctaX, ctaY, ctaW, ctaH, ctaH / 2);
    ctx.fill();
    ctx.fillStyle = design.accentColor;
    ctx.textBaseline = "middle";
    ctx.fillText(ctaText, W / 2, ctaY + ctaH / 2 + 1);
    ctx.restore();
  },
};

const CAROUSEL_TIP: Template = {
  id: "carousel-tip",
  name: "Carousel Tip",
  blurb: "Photo top, big numbered tip in a white card underneath.",
  category: "carousels",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  usesTagline: true,
  taglineHint: "TIP 02",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    const splitY = Math.round(H * 0.38);
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: splitY }, design);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, splitY, W, H - splitY);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(0, splitY, W, Math.max(6, Math.round(H * 0.006)));

    const padX = Math.round(W * 0.085);
    const innerW = W - padX * 2;
    const cardTop = splitY + Math.round(H * 0.05);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Tip indicator (tagline)
    const tipLabel = (design.tagline ?? "").trim() || "TIP 02";
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${Math.round(H * 0.02)}px ${fonts.body}`;
    ctx.fillText(tipLabel, padX, cardTop + Math.round(H * 0.02));

    // Heading
    const heading = (design.headingText || "Add your tip heading here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.062),
      Math.round(H * 0.038),
      innerW,
      3,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = cardTop + Math.round(H * 0.05);

    ctx.fillStyle = "#0a0a0a";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Body
    const bodySize = Math.round(H * 0.022);
    const bodyLine = Math.round(bodySize * 1.55);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add the detail for this tip here.",
      innerW,
    ).slice(0, 5);
    if (bodyLines.length) {
      ctx.fillStyle = "rgba(10,10,10,0.72)";
      const bodyTop = headingTop + headingBlock + Math.round(H * 0.03);
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    // Footer
    const padBottom = Math.round(H * 0.075);
    ctx.fillStyle = "rgba(10,10,10,0.5)";
    ctx.font = `500 ${Math.round(H * 0.015)}px ${fonts.body}`;
    ctx.fillText(`${brandName(design)}  ·  ${brandLocality(design).toUpperCase()}`, padX, H - padBottom);
    ctx.textAlign = "right";
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.fillText("SWIPE  →", W - padX, H - padBottom);
    ctx.restore();
  },
};

const CAROUSEL_QUOTE_SLIDE: Template = {
  id: "carousel-quote-slide",
  name: "Carousel Quote",
  blurb: "Dark slide with a big accent quote — testimonial inside a series.",
  category: "carousels",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  usesTagline: true,
  taglineHint: "03 / 05",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();

    // Dark base
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    // Accent inset frame
    const frame = Math.round(W * 0.04);
    ctx.strokeStyle = design.accentColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(frame, frame, W - frame * 2, H - frame * 2);

    const padX = Math.round(W * 0.1);
    const innerW = W - padX * 2;
    const padTop = Math.round(H * 0.1);
    const padBottom = Math.round(H * 0.1);

    ctx.textBaseline = "alphabetic";

    // Slide number (top-right)
    const tagline = (design.tagline ?? "").trim() || "03 / 05";
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.02)}px ${fonts.body}`;
    ctx.textAlign = "right";
    ctx.fillText(tagline, W - padX, padTop + Math.round(H * 0.02));

    // Big accent quote mark
    const markH = Math.round(H * 0.05);
    const markW = Math.round(H * 0.09);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(padX, padTop + Math.round(H * 0.06), markW, markH);

    // Quote heading
    const heading = (design.headingText || "Add a client quote here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.062),
      Math.round(H * 0.04),
      innerW,
      5,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2 + Math.round(H * 0.02);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    ctx.textAlign = "left";
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Body / attribution
    const bodySize = Math.round(H * 0.022);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText || "— Your client",
      innerW,
    ).slice(0, 2);

    if (bodyLines.length) {
      ctx.fillStyle = design.accentColor;
      const bodyTop = headingTop + headingBlock + Math.round(H * 0.04);
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(brandName(design), padX, H - padBottom);
    ctx.textAlign = "right";
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.fillText("SWIPE  →", W - padX, H - padBottom);
    ctx.restore();
  },
};

// =========================================================================
//  Templates — Testimonials
// =========================================================================

const QUOTE_PORTRAIT: Template = {
  id: "quote",
  name: "Quote Portrait",
  blurb: "4:5 portrait — photo on top, accented white quote card underneath.",
  category: "testimonials",
  aspectRatio: "4:5",
  width: 1080,
  height: 1350,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    const splitY = Math.round(H * 0.55);
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: splitY }, design);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, splitY, W, H - splitY);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(0, splitY, W, Math.max(6, Math.round(H * 0.006)));

    const padX = Math.round(W * 0.085);
    const innerW = W - padX * 2;
    const cardTop = splitY + Math.round(H * 0.055);
    const cardBottom = H - Math.round(H * 0.075);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    const markH = Math.round(H * 0.025);
    const markW = Math.round(H * 0.05);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(padX, cardTop, markW, markH);

    const bodySize = Math.round(H * 0.02);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText || "— Happy client",
      innerW,
    ).slice(0, 3);

    const heading = (design.headingText || "Add a client quote here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.045),
      Math.round(H * 0.03),
      innerW,
      4,
    );
    const headingLine = Math.round(fit.size * 1.1);
    const headingBlock = fit.lines.length * headingLine;

    const markGap = Math.round(H * 0.025);
    const bodyGap = Math.round(H * 0.028);

    const headingTop = cardTop + markH + markGap;
    ctx.fillStyle = "#0a0a0a";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(10,10,10,0.62)";
      ctx.font = `400 ${bodySize}px ${fonts.body}`;
      const bodyTop = headingTop + headingBlock + bodyGap;
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    ctx.fillStyle = "rgba(10,10,10,0.5)";
    ctx.font = `500 ${Math.round(H * 0.015)}px ${fonts.body}`;
    ctx.textAlign = "right";
    ctx.fillText(brandWeb(design), W - padX, cardBottom);
    ctx.restore();
  },
};

const PHOTO_QUOTE: Template = {
  id: "photo-quote",
  name: "Photo Quote",
  blurb: "1:1 — quote overlaid on a full-bleed photo with strong gradient.",
  category: "testimonials",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);
    ctx.fillStyle = "rgba(10,10,10,0.55)";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.1);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Big opening quote mark — accent-coloured rect
    const markH = Math.round(H * 0.04);
    const markW = Math.round(H * 0.075);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(padX, Math.round(H * 0.22), markW, markH);

    // Heading (the quote itself)
    const heading = (design.headingText || "Add a client quote here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.06),
      Math.round(H * 0.038),
      innerW,
      5,
    );
    const headingLine = Math.round(fit.size * 1.1);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = Math.round(H * 0.31);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Divider rule
    const dividerY = headingTop + headingBlock + Math.round(H * 0.04);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(padX, dividerY, Math.round(W * 0.08), 3);

    // Attribution body
    const bodySize = Math.round(H * 0.022);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText || "— Your client",
      innerW,
    ).slice(0, 3);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      const bodyTop = dividerY + Math.round(H * 0.035);
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `500 ${Math.round(H * 0.015)}px ${fonts.body}`;
    ctx.fillText(`${brandName(design)}  ·  ${brandLocality(design).toUpperCase()}`, padX, H - Math.round(H * 0.08));
    ctx.restore();
  },
};

const STAR_RATING: Template = {
  id: "star-rating",
  name: "Star Rating",
  blurb: "Five-star review card — quote over a dimmed photo.",
  category: "testimonials",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design);
    ctx.fillStyle = "rgba(10,10,10,0.62)";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.085);
    const padTop = Math.round(H * 0.1);
    const padBottom = Math.round(H * 0.085);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    // 5 stars rendered as accent squares with gaps
    const starSize = Math.round(H * 0.04);
    const starGap = Math.round(H * 0.012);
    const starsW = starSize * 5 + starGap * 4;
    const starsX = (W - starsW) / 2;
    const starsY = padTop;
    ctx.fillStyle = design.accentColor;
    for (let i = 0; i < 5; i++) {
      drawStar(
        ctx,
        starsX + i * (starSize + starGap) + starSize / 2,
        starsY + starSize / 2,
        starSize / 2,
      );
    }

    // Eyebrow below stars
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.fillText(`VERIFIED CLIENT  ·  ${brandName(design)}`, W / 2, starsY + starSize + Math.round(H * 0.045));

    // Quote heading
    const heading = (design.headingText || "Worth every cent. I felt the difference within an hour.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.052),
      Math.round(H * 0.034),
      innerW,
      5,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2 + Math.round(H * 0.02);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, W / 2, headingTop + fit.size, headingLine);

    // Body / attribution
    const bodySize = Math.round(H * 0.02);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText || "— Your client",
      innerW,
    ).slice(0, 2);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      paintLines(
        ctx,
        bodyLines,
        W / 2,
        headingTop + headingBlock + Math.round(H * 0.04) + bodySize,
        bodyLine,
      );
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(`${brandLocality(design).toUpperCase()}  ·  ${brandWeb(design)}`, W / 2, H - padBottom);
    ctx.restore();
  },
};

const RESULT_CARD: Template = {
  id: "result-card",
  name: "Result Card",
  blurb: "4:5 — outcome statement on top of a photo, body in a card below.",
  category: "testimonials",
  aspectRatio: "4:5",
  width: 1080,
  height: 1350,
  requiresPhoto: true,
  usesTagline: true,
  taglineHint: "AFTER 4 SESSIONS",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    const splitY = Math.round(H * 0.5);
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: splitY }, design);
    ctx.fillStyle = "rgba(10,10,10,0.42)";
    ctx.fillRect(0, 0, W, splitY);

    // White card
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, splitY, W, H - splitY);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(0, splitY, W, Math.max(6, Math.round(H * 0.006)));

    const padX = Math.round(W * 0.085);
    const innerW = W - padX * 2;
    const padTop = Math.round(H * 0.08);
    const padBottom = Math.round(H * 0.075);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Eyebrow over photo
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.fillText("CLIENT RESULT", padX, padTop + Math.round(H * 0.016));

    // Tagline pill (e.g. "AFTER 4 SESSIONS") top-right over photo
    const tag = (design.tagline ?? "").trim() || "AFTER 4 SESSIONS";
    ctx.font = `600 ${Math.round(H * 0.014)}px ${fonts.body}`;
    const tagTextW = ctx.measureText(tag).width;
    const tagPadH = Math.round(H * 0.018);
    const tagPadV = Math.round(H * 0.009);
    const tagH = Math.round(H * 0.014) + tagPadV * 2;
    const tagW = tagTextW + tagPadH * 2;
    const tagX = W - padX - tagW;
    const tagY = padTop;
    ctx.fillStyle = design.accentColor;
    roundedRect(ctx, tagX, tagY, tagW, tagH, tagH / 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(tag, tagX + tagW / 2, tagY + tagH / 2 + 1);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Card content
    const cardTop = splitY + Math.round(H * 0.055);

    // Result label
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.fillText("THE RESULT", padX, cardTop + Math.round(H * 0.016));

    // Heading
    const heading = (design.headingText || "Add a client result here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.05),
      Math.round(H * 0.032),
      innerW,
      4,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = cardTop + Math.round(H * 0.05);

    ctx.fillStyle = "#0a0a0a";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Body
    const bodySize = Math.round(H * 0.02);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "— Your client",
      innerW,
    ).slice(0, 3);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(10,10,10,0.7)";
      const bodyTop = headingTop + headingBlock + Math.round(H * 0.035);
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    // Footer
    ctx.fillStyle = "rgba(10,10,10,0.5)";
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.textAlign = "right";
    ctx.fillText(brandWeb(design), W - padX, H - padBottom);
    ctx.restore();
  },
};

// =========================================================================
//  Templates — Promos
// =========================================================================

const PRICE_TAG: Template = {
  id: "price-tag",
  name: "Price Tag",
  blurb: "Offer-led — big price tagline in the accent colour.",
  category: "promos",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: false,
  usesTagline: true,
  taglineHint: "GIFT VOUCHER",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design, {
      showPlaceholder: false,
    });
    // Always darken so the price reads
    ctx.fillStyle = bg ? "rgba(10,10,10,0.65)" : "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.1);
    const padTop = Math.round(H * 0.1);
    const padBottom = Math.round(H * 0.085);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";

    // Tagline pill (top)
    const tagline = (design.tagline ?? "").trim() || "LIMITED OFFER";
    ctx.font = `600 ${Math.round(H * 0.02)}px ${fonts.body}`;
    ctx.textAlign = "center";
    const tagW = ctx.measureText(tagline).width + Math.round(H * 0.05);
    const tagH = Math.round(H * 0.052);
    const tagX = (W - tagW) / 2;
    const tagY = padTop;
    ctx.fillStyle = design.accentColor;
    roundedRect(ctx, tagX, tagY, tagW, tagH, tagH / 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(tagline, W / 2, tagY + tagH / 2 + 1);

    ctx.textBaseline = "alphabetic";

    // Heading (the offer)
    const heading = (design.headingText || "€00\nYOUR OFFER").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.16),
      Math.round(H * 0.07),
      innerW,
      3,
    );
    const headingLine = Math.round(fit.size * 1.02);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2 - Math.round(H * 0.02);

    ctx.fillStyle = design.accentColor;
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, W / 2, headingTop + fit.size, headingLine);

    // Body
    const bodySize = Math.round(H * 0.024);
    const bodyLine = Math.round(bodySize * 1.45);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "60 minutes of pressurised oxygen. Walk-ins welcome — book online or call.",
      innerW,
    ).slice(0, 3);

    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      const bodyTop = headingTop + headingBlock + Math.round(H * 0.035);
      paintLines(ctx, bodyLines, W / 2, bodyTop + bodySize, bodyLine);
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `600 ${Math.round(H * 0.017)}px ${fonts.body}`;
    ctx.fillText(`${brandWeb(design).toUpperCase()}  ·  ${brandPhone(design)}`, W / 2, H - padBottom);
    ctx.restore();
  },
};

const VOUCHER_CARD: Template = {
  id: "voucher-card",
  name: "Voucher Card",
  blurb: "Gift voucher styled — big value and an accent border.",
  category: "promos",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: false,
  usesTagline: true,
  taglineHint: "GIFT VOUCHER",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();

    // Dark base with subtle accent tint
    const { r, g, b } = hexToRgb(design.accentColor);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
    ctx.fillRect(0, 0, W, H);

    // Inset frame
    const inset = Math.round(W * 0.05);
    ctx.strokeStyle = design.accentColor;
    ctx.lineWidth = 4;
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);

    // Decorative dots in corners
    ctx.fillStyle = design.accentColor;
    const dotR = Math.round(W * 0.012);
    [
      [inset, inset],
      [W - inset, inset],
      [inset, H - inset],
      [W - inset, H - inset],
    ].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
    });

    const padX = Math.round(W * 0.12);
    const padTop = Math.round(H * 0.12);
    const padBottom = Math.round(H * 0.12);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    // Tagline (e.g. "GIFT VOUCHER")
    const tag = (design.tagline ?? "").trim() || "GIFT VOUCHER";
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${Math.round(H * 0.024)}px ${fonts.body}`;
    ctx.fillText(tag, W / 2, padTop + Math.round(H * 0.024));

    // Renova mark
    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${Math.round(H * 0.04)}px ${fonts.heading}`;
    ctx.fillText(brandName(design), W / 2, padTop + Math.round(H * 0.075));

    // Big value (heading)
    const heading = (design.headingText || "€95").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.22),
      Math.round(H * 0.1),
      innerW,
      2,
    );
    const headingLine = Math.round(fit.size * 1.04);
    const headingBlock = fit.lines.length * headingLine;
    const valueTop = H / 2 - headingBlock / 2 + Math.round(H * 0.02);
    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, W / 2, valueTop + fit.size, headingLine);

    // Accent rule
    const ruleW = Math.round(W * 0.12);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(
      (W - ruleW) / 2,
      valueTop + headingBlock + Math.round(H * 0.035),
      ruleW,
      3,
    );

    // Body
    const bodySize = Math.round(H * 0.022);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add your offer details here.",
      innerW,
    ).slice(0, 3);
    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.86)";
      paintLines(
        ctx,
        bodyLines,
        W / 2,
        valueTop + headingBlock + Math.round(H * 0.075) + bodySize,
        bodyLine,
      );
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `600 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.fillText(`${brandWeb(design).toUpperCase()}  ·  ${brandPhone(design)}`, W / 2, H - padBottom);
    ctx.restore();
  },
};

const PACKAGE_DEAL: Template = {
  id: "package-deal",
  name: "Package Deal",
  blurb: "Bundle offer with savings emphasis.",
  category: "promos",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  usesTagline: true,
  taglineHint: "BUNDLE OFFER",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design, {
      showPlaceholder: false,
    });
    ctx.fillStyle = bg ? "rgba(10,10,10,0.65)" : "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.085);
    const padTop = Math.round(H * 0.085);
    const padBottom = Math.round(H * 0.085);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";

    // Bundle tag (top)
    const tag = (design.tagline ?? "").trim() || "BUNDLE OFFER";
    ctx.font = `600 ${Math.round(H * 0.02)}px ${fonts.body}`;
    ctx.textAlign = "center";
    const tagW = ctx.measureText(tag).width + Math.round(H * 0.05);
    const tagH = Math.round(H * 0.05);
    const tagX = (W - tagW) / 2;
    const tagY = padTop;
    ctx.fillStyle = design.accentColor;
    roundedRect(ctx, tagX, tagY, tagW, tagH, tagH / 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, W / 2, tagY + tagH / 2 + 1);

    ctx.textBaseline = "alphabetic";

    // "SAVE" eyebrow
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${Math.round(H * 0.022)}px ${fonts.body}`;
    ctx.textAlign = "center";
    ctx.fillText("SAVE 25%", W / 2, padTop + Math.round(H * 0.13));

    // Heading
    const heading = (design.headingText || "Buy 3 sessions,\nget 1 free.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.1),
      Math.round(H * 0.05),
      innerW,
      3,
    );
    const headingLine = Math.round(fit.size * 1.04);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2 + Math.round(H * 0.02);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, W / 2, headingTop + fit.size, headingLine);

    // Accent rule
    const ruleW = Math.round(W * 0.1);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(
      (W - ruleW) / 2,
      headingTop + headingBlock + Math.round(H * 0.03),
      ruleW,
      3,
    );

    // Body
    const bodySize = Math.round(H * 0.022);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add your offer details here.",
      innerW,
    ).slice(0, 3);
    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      paintLines(
        ctx,
        bodyLines,
        W / 2,
        headingTop + headingBlock + Math.round(H * 0.07) + bodySize,
        bodyLine,
      );
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `600 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.fillText(`${brandWeb(design).toUpperCase()}  ·  ${brandPhone(design)}`, W / 2, H - padBottom);
    ctx.restore();
  },
};

const COUNTDOWN_STORY: Template = {
  id: "countdown-story",
  name: "Countdown Story",
  blurb: "9:16 — date-anchored offer for time-sensitive promos.",
  category: "promos",
  aspectRatio: "9:16",
  width: 1080,
  height: 1920,
  requiresPhoto: true,
  usesTagline: true,
  taglineHint: "ENDS FRIDAY",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design, {
      showPlaceholder: false,
    });
    ctx.fillStyle = bg ? "rgba(10,10,10,0.62)" : "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.09);
    const padTop = Math.round(H * 0.075);
    const padBottom = Math.round(H * 0.075);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";

    // Top "LIMITED TIME" pill
    const tag = (design.tagline ?? "").trim() || "ENDS FRIDAY";
    ctx.font = `600 ${Math.round(H * 0.018)}px ${fonts.body}`;
    const tagW = ctx.measureText(tag).width + Math.round(H * 0.045);
    const tagH = Math.round(H * 0.044);
    const tagX = (W - tagW) / 2;
    const tagY = padTop;
    ctx.fillStyle = design.accentColor;
    roundedRect(ctx, tagX, tagY, tagW, tagH, tagH / 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, W / 2, tagY + tagH / 2 + 1);

    ctx.textBaseline = "alphabetic";

    // Eyebrow
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.015)}px ${fonts.body}`;
    ctx.fillText(brandName(design), W / 2, padTop + tagH + Math.round(H * 0.05));

    // Heading
    const heading = (design.headingText || "Book this week.\nFirst session 50% off.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.062),
      Math.round(H * 0.038),
      innerW,
      5,
    );
    const headingLine = Math.round(fit.size * 1.06);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2;

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, W / 2, headingTop + fit.size, headingLine);

    // Accent rule
    const ruleW = Math.round(W * 0.1);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(
      (W - ruleW) / 2,
      headingTop + headingBlock + Math.round(H * 0.03),
      ruleW,
      3,
    );

    // Body
    const bodySize = Math.round(H * 0.02);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add your offer details here.",
      innerW,
    ).slice(0, 3);
    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      paintLines(
        ctx,
        bodyLines,
        W / 2,
        headingTop + headingBlock + Math.round(H * 0.07) + bodySize,
        bodyLine,
      );
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = `600 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(`${brandWeb(design).toUpperCase()}  ·  ${brandPhone(design)}`, W / 2, H - padBottom);
    ctx.restore();
  },
};

// =========================================================================
//  Templates — Educational
// =========================================================================

const FACT_STACK: Template = {
  id: "fact-stack",
  name: "Fact Stack",
  blurb: "4:5 — three short facts stacked over an accented header.",
  category: "educational",
  aspectRatio: "4:5",
  width: 1080,
  height: 1350,
  requiresPhoto: false,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();

    // Top accent band (35%)
    const bandH = Math.round(H * 0.32);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(0, 0, W, bandH);
    if (bg) {
      paintBackground(
        ctx,
        bg,
        { x: 0, y: 0, w: W, h: bandH },
        design,
        { showPlaceholder: false },
      );
      ctx.fillStyle = "rgba(10,10,10,0.55)";
      ctx.fillRect(0, 0, W, bandH);
    }

    // Body area
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, bandH, W, H - bandH);

    const padX = Math.round(W * 0.085);
    const innerW = W - padX * 2;
    const padTop = Math.round(H * 0.07);
    const padBottom = Math.round(H * 0.07);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Eyebrow in band
    const eyebrowSize = Math.round(H * 0.016);
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${eyebrowSize}px ${fonts.body}`;
    ctx.fillText(brandName(design), padX, padTop + eyebrowSize);

    // Heading in band
    const heading = (design.headingText || "3 things to know").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.05),
      Math.round(H * 0.032),
      innerW,
      3,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = padTop + eyebrowSize + Math.round(H * 0.028);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Body items — split bodyText by newline into 3 facts
    const bodyText =
      design.bodyText.trim() ||
      "Point one goes here.\nPoint two goes here.\nPoint three goes here.";
    const facts = bodyText.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);

    const factTop = bandH + Math.round(H * 0.07);
    const factAreaH = H - factTop - padBottom - Math.round(H * 0.04);
    const slotH = factAreaH / Math.max(1, facts.length);

    const factSize = Math.round(H * 0.024);
    const factLine = Math.round(factSize * 1.5);
    const numberSize = Math.round(H * 0.042);

    // Measure the widest possible number ("00") in the heading font so the
    // fact column starts well clear of it regardless of digit width.
    ctx.font = `400 ${numberSize}px ${fonts.heading}`;
    const numberColW = ctx.measureText("00").width;
    const numberGap = Math.round(W * 0.045);
    const textX = padX + numberColW + numberGap;
    const textW = innerW - numberColW - numberGap;

    facts.forEach((fact, i) => {
      const slotY = factTop + i * slotH;

      // Number — baseline-aligned with the first line of the fact text
      ctx.fillStyle = design.accentColor;
      ctx.font = `400 ${numberSize}px ${fonts.heading}`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(`0${i + 1}`, padX, slotY + numberSize);

      // Fact text — vertically centred against the number cap height
      ctx.fillStyle = "rgba(10,10,10,0.78)";
      ctx.font = `400 ${factSize}px ${fonts.body}`;
      const lines = wrapLines(ctx, fact, textW).slice(0, 3);
      const firstBaselineY =
        slotY + numberSize - (numberSize - factSize) * 0.45;
      paintLines(ctx, lines, textX, firstBaselineY, factLine);

      // Hairline separator (skip after last)
      if (i < facts.length - 1) {
        ctx.fillStyle = "rgba(10,10,10,0.1)";
        ctx.fillRect(padX, slotY + slotH - Math.round(H * 0.025), innerW, 1);
      }
    });

    // Footer
    ctx.fillStyle = "rgba(10,10,10,0.5)";
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(`${brandWeb(design)}  ·  ${brandLocality(design)}`, padX, H - padBottom);
    ctx.restore();
  },
};

const DEFINITION_CARD: Template = {
  id: "definition-card",
  name: "Definition Card",
  blurb: "Dictionary-style explainer — term + definition on a cream card.",
  category: "educational",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: false,
  usesTagline: true,
  taglineHint: "noun · therapy",
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();

    // Cream background with subtle accent wash
    const { r, g, b } = hexToRgb(design.accentColor);
    ctx.fillStyle = "#faf8f4";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `rgba(${r},${g},${b},0.05)`;
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.09);
    const padTop = Math.round(H * 0.1);
    const padBottom = Math.round(H * 0.085);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Eyebrow
    ctx.fillStyle = design.accentColor;
    ctx.font = `600 ${Math.round(H * 0.017)}px ${fonts.body}`;
    ctx.fillText("WHAT IS IT?", padX, padTop + Math.round(H * 0.017));

    // Term (heading)
    const heading = (design.headingText || "Your service name").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.095),
      Math.round(H * 0.055),
      innerW,
      2,
    );
    const headingLine = Math.round(fit.size * 1.04);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = padTop + Math.round(H * 0.05);

    ctx.fillStyle = "#0a0a0a";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Pronunciation/type tagline
    const tag = (design.tagline ?? "").trim() || "noun · therapy";
    ctx.fillStyle = "rgba(10,10,10,0.55)";
    ctx.font = `italic 400 ${Math.round(H * 0.022)}px ${fonts.body}`;
    ctx.fillText(tag, padX, headingTop + headingBlock + Math.round(H * 0.04));

    // Accent rule
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(
      padX,
      headingTop + headingBlock + Math.round(H * 0.075),
      Math.round(W * 0.08),
      3,
    );

    // Body (definition)
    const bodySize = Math.round(H * 0.026);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Add a description of your service here.",
      innerW,
    ).slice(0, 6);
    if (bodyLines.length) {
      ctx.fillStyle = "rgba(10,10,10,0.78)";
      const bodyTop = headingTop + headingBlock + Math.round(H * 0.115);
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    // Footer
    ctx.fillStyle = "rgba(10,10,10,0.5)";
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(`${brandName(design)}  ·  ${brandLocality(design).toUpperCase()}`, padX, H - padBottom);
    ctx.restore();
  },
};

const DID_YOU_KNOW: Template = {
  id: "did-you-know",
  name: "Did You Know?",
  blurb: "Single-fact card — bold question eyebrow with a surprising answer.",
  category: "educational",
  aspectRatio: "1:1",
  width: 1080,
  height: 1080,
  requiresPhoto: true,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();
    paintBackground(ctx, bg, { x: 0, y: 0, w: W, h: H }, design, {
      showPlaceholder: false,
    });
    ctx.fillStyle = bg ? "rgba(10,10,10,0.62)" : "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    const padX = Math.round(W * 0.085);
    const padTop = Math.round(H * 0.085);
    const padBottom = Math.round(H * 0.085);
    const innerW = W - padX * 2;

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Eyebrow pill
    const eyebrow = "DID YOU KNOW?";
    ctx.font = `700 ${Math.round(H * 0.024)}px ${fonts.body}`;
    const ebW = ctx.measureText(eyebrow).width + Math.round(H * 0.05);
    const ebH = Math.round(H * 0.056);
    ctx.fillStyle = design.accentColor;
    roundedRect(ctx, padX, padTop, ebW, ebH, ebH / 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(eyebrow, padX + ebW / 2, padTop + ebH / 2 + 1);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Heading (fact)
    const heading = (design.headingText || "Add a key stat or fact here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.06),
      Math.round(H * 0.038),
      innerW,
      5,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingBlock = fit.lines.length * headingLine;
    const headingTop = H / 2 - headingBlock / 2 - Math.round(H * 0.04);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Accent rule
    const ruleY = headingTop + headingBlock + Math.round(H * 0.03);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(padX, ruleY, Math.round(W * 0.08), 3);

    // Body explanation
    const bodySize = Math.round(H * 0.022);
    const bodyLine = Math.round(bodySize * 1.5);
    ctx.font = `400 ${bodySize}px ${fonts.body}`;
    const bodyLines = wrapLines(
      ctx,
      design.bodyText ||
        "Pressurised air pushes oxygen into your plasma, not just red blood cells — which is how it reaches tissue that normal breathing can't.",
      innerW,
    ).slice(0, 4);
    if (bodyLines.length) {
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      const bodyTop = ruleY + Math.round(H * 0.035);
      paintLines(ctx, bodyLines, padX, bodyTop + bodySize, bodyLine);
    }

    // Footer
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(`${brandName(design)}  ·  ${brandLocality(design).toUpperCase()}`, padX, H - padBottom);
    ctx.restore();
  },
};

const HOW_IT_WORKS: Template = {
  id: "how-it-works",
  name: "How It Works",
  blurb: "4:5 — three numbered steps in a clean vertical list.",
  category: "educational",
  aspectRatio: "4:5",
  width: 1080,
  height: 1350,
  requiresPhoto: false,
  render(ctx, design, bg, fonts) {
    const W = this.width;
    const H = this.height;
    ctx.save();

    // Accent header band
    const bandH = Math.round(H * 0.26);
    ctx.fillStyle = design.accentColor;
    ctx.fillRect(0, 0, W, bandH);
    if (bg) {
      paintBackground(
        ctx,
        bg,
        { x: 0, y: 0, w: W, h: bandH },
        design,
        { showPlaceholder: false },
      );
      ctx.fillStyle = "rgba(10,10,10,0.55)";
      ctx.fillRect(0, 0, W, bandH);
    }

    // Body bg
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, bandH, W, H - bandH);

    const padX = Math.round(W * 0.085);
    const innerW = W - padX * 2;
    const padTop = Math.round(H * 0.06);
    const padBottom = Math.round(H * 0.07);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";

    // Eyebrow in band
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(H * 0.016)}px ${fonts.body}`;
    ctx.fillText("HOW IT WORKS", padX, padTop + Math.round(H * 0.016));

    // Heading in band
    const heading = (design.headingText || "Your headline goes here.").toUpperCase();
    const fit = autoFitHeading(
      ctx,
      heading,
      "400",
      fonts.heading,
      Math.round(H * 0.045),
      Math.round(H * 0.03),
      innerW,
      2,
    );
    const headingLine = Math.round(fit.size * 1.08);
    const headingTop = padTop + Math.round(H * 0.045);

    ctx.fillStyle = "#ffffff";
    ctx.font = `400 ${fit.size}px ${fonts.heading}`;
    paintLines(ctx, fit.lines, padX, headingTop + fit.size, headingLine);

    // Steps — split bodyText by newline
    const stepsText =
      design.bodyText.trim() ||
      "Arrive 10 minutes early. We walk you through the chamber.\nSettle in for 60 minutes — bring music or close your eyes.\nWalk out. We'll schedule the next one if you want.";
    const steps = stepsText.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 4);

    const stepsTop = bandH + Math.round(H * 0.075);
    const stepsAreaH = H - stepsTop - padBottom - Math.round(H * 0.04);
    const slotH = stepsAreaH / Math.max(1, steps.length);

    const numberSize = Math.round(H * 0.038);
    const stepSize = Math.round(H * 0.024);
    const stepLine = Math.round(stepSize * 1.5);

    ctx.font = `400 ${numberSize}px ${fonts.heading}`;
    const numberColW = ctx.measureText("0").width + Math.round(H * 0.018);
    const numberCircleR = Math.round(H * 0.03);
    const textX = padX + numberCircleR * 2 + Math.round(W * 0.04);
    const textW = innerW - (numberCircleR * 2 + Math.round(W * 0.04));

    steps.forEach((step, i) => {
      const slotY = stepsTop + i * slotH;
      const circleY = slotY + numberCircleR;
      // Numbered circle
      ctx.fillStyle = design.accentColor;
      ctx.beginPath();
      ctx.arc(padX + numberCircleR, circleY, numberCircleR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = `600 ${Math.round(H * 0.024)}px ${fonts.body}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), padX + numberCircleR, circleY + 1);

      // Step text
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(10,10,10,0.78)";
      ctx.font = `400 ${stepSize}px ${fonts.body}`;
      const lines = wrapLines(ctx, step, textW).slice(0, 3);
      paintLines(
        ctx,
        lines,
        textX,
        slotY + numberCircleR * 1.4,
        stepLine,
      );

      // Connector line
      if (i < steps.length - 1) {
        ctx.strokeStyle = "rgba(10,10,10,0.15)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padX + numberCircleR, circleY + numberCircleR + 4);
        ctx.lineTo(padX + numberCircleR, slotY + slotH - 4);
        ctx.stroke();
      }
    });

    // Footer
    ctx.fillStyle = "rgba(10,10,10,0.5)";
    ctx.font = `500 ${Math.round(H * 0.014)}px ${fonts.body}`;
    ctx.fillText(`${brandWeb(design)}  ·  ${brandLocality(design)}`, padX, H - padBottom);
    ctx.restore();
  },
};

// =========================================================================
//  Exports
// =========================================================================

export const TEMPLATES: Template[] = [
  // Social
  BOLD_HEADLINE,
  SIDE_CARD,
  CENTERED_STATEMENT,
  TOP_BANNER,
  STAT_BLOCK,
  FRAME,
  MAGAZINE,
  // Stories
  STORY_HERO,
  STORY_SPLIT,
  STORY_MINIMAL,
  STORY_QUOTE,
  STORY_STAT,
  // Carousels
  CAROUSEL_COVER,
  CAROUSEL_CONTENT,
  CAROUSEL_CTA,
  CAROUSEL_TIP,
  CAROUSEL_QUOTE_SLIDE,
  QUESTION_HOOK,
  // Testimonials
  QUOTE_PORTRAIT,
  PHOTO_QUOTE,
  STAR_RATING,
  RESULT_CARD,
  // Promos
  PRICE_TAG,
  VOUCHER_CARD,
  PACKAGE_DEAL,
  COUNTDOWN_STORY,
  // Educational
  FACT_STACK,
  DEFINITION_CARD,
  DID_YOU_KNOW,
  HOW_IT_WORKS,
];

export function getTemplate(id: string): Template | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

export function templatesByCategory(
  category: TemplateCategory,
): Template[] {
  return TEMPLATES.filter((t) => t.category === category);
}
