import { Mail, Phone } from "lucide-react";

/**
 * Which app a message came in on, as that app's own mark in its own colours,
 * so the inbox can be scanned at a glance. lucide has no brand marks, so the
 * the platforms are small SVG marks; email keeps the neutral lucide glyph.
 */
export type MessageChannel = "whatsapp" | "messenger" | "instagram" | "email" | "google";

const LABEL: Record<MessageChannel, string> = {
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  instagram: "Instagram",
  email: "Email",
  google: "Google",
};

// Self-contained SVGs served as data URIs: an inline <svg> gradient is found by
// element id, so two icons on one page share an id, and a gradient defined
// inside a hidden tab stops rendering in Chrome.
const INSTAGRAM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><radialGradient id="g" cx="0.3" cy="1.07" r="1.2"><stop offset="0" stop-color="#FDF497"/><stop offset="0.1" stop-color="#FDF497"/><stop offset="0.5" stop-color="#FD5949"/><stop offset="0.68" stop-color="#D6249F"/><stop offset="1" stop-color="#285AEB"/></radialGradient></defs><rect width="24" height="24" rx="6" fill="url(#g)"/><rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="15.9" cy="8.1" r="1" fill="#fff"/></svg>`;

const MESSENGER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g" x1="0.2" y1="1" x2="0.8" y2="0"><stop offset="0" stop-color="#0099FF"/><stop offset="0.6" stop-color="#A033FF"/><stop offset="1" stop-color="#FF5C87"/></linearGradient></defs><path d="M12 1.5C6.1 1.5 1.5 5.8 1.5 11.4c0 2.9 1.2 5.5 3.2 7.3v3.8l3.4-1.9c1.2.4 2.5.6 3.9.6 5.9 0 10.5-4.3 10.5-9.9S17.9 1.5 12 1.5z" fill="url(#g)"/><path d="M5.8 14.6l3.3-5.2 3.1 2.4 4-2.4-3.3 5.2-3.1-2.4z" fill="#fff"/></svg>`;

// Google's "G" in its four colours, on a white disc so it reads on dark grounds.
const GOOGLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#fff"/><path d="M19.6 12.2c0-.6-.1-1.1-.2-1.6H12v3.1h4.3a3.7 3.7 0 0 1-1.6 2.4v2h2.6c1.5-1.4 2.3-3.4 2.3-5.9z" fill="#4285F4"/><path d="M12 20c2.2 0 4-.7 5.3-1.9l-2.6-2c-.7.5-1.6.8-2.7.8-2.1 0-3.8-1.4-4.5-3.3H4.9v2.1A8 8 0 0 0 12 20z" fill="#34A853"/><path d="M7.5 13.6a4.8 4.8 0 0 1 0-3.1V8.4H4.9a8 8 0 0 0 0 7.3l2.6-2.1z" fill="#FBBC05"/><path d="M12 7.2c1.2 0 2.2.4 3 1.2l2.3-2.3A8 8 0 0 0 4.9 8.4l2.6 2.1C8.2 8.6 9.9 7.2 12 7.2z" fill="#EA4335"/></svg>`;

const dataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const SRC: Partial<Record<MessageChannel, string>> = {
  instagram: dataUri(INSTAGRAM_SVG),
  messenger: dataUri(MESSENGER_SVG),
  google: dataUri(GOOGLE_SVG),
};

export function ChannelIcon({ channel, size = 18 }: { channel: MessageChannel; size?: number }) {
  const src = SRC[channel];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- a 16px inline data URI, nothing for next/image to optimise
    return <img src={src} width={size} height={size} alt={LABEL[channel]} title={LABEL[channel]} style={{ flexShrink: 0, display: "block" }} />;
  }

  if (channel === "whatsapp") {
    return (
      <span
        role="img"
        aria-label={LABEL[channel]}
        title={LABEL[channel]}
        style={{ width: size, height: size, borderRadius: "50%", background: "#25D366", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
      >
        <Phone size={Math.round(size * 0.55)} strokeWidth={2.4} color="#fff" fill="#fff" />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={LABEL[channel]}
      title={LABEL[channel]}
      style={{ width: size, height: size, borderRadius: "50%", background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
    >
      <Mail size={Math.round(size * 0.6)} strokeWidth={1.9} style={{ color: "var(--text-secondary)" }} />
    </span>
  );
}
