import "server-only";

import { readKey, setKey } from "@/lib/settings";

/**
 * WhatsApp bridge credentials. Stored as settings keys (single instance for now;
 * per-tenant in the tenancy phase). The token is a secret — never log it.
 */
export interface WhatsAppConfig {
  provider: "whapi";
  /** Provider channel/API token. */
  token: string;
  /** Optional provider channel id (some providers scope by channel). */
  channel: string;
  /** Provider API base URL (overridable; defaults set by the adapter). */
  baseUrl: string;
  /** Shared secret we require on inbound webhook calls. */
  webhookSecret: string;
}

const DEFAULTS: WhatsAppConfig = {
  provider: "whapi",
  token: "",
  channel: "",
  baseUrl: "",
  webhookSecret: "",
};

export function getWhatsAppConfig(): WhatsAppConfig {
  const stored = readKey<Partial<WhatsAppConfig>>("whatsapp_config", {});
  return { ...DEFAULTS, ...stored };
}

export function setWhatsAppConfig(config: Partial<WhatsAppConfig>): void {
  const next = { ...getWhatsAppConfig(), ...config };
  setKey("whatsapp_config", next);
}

/** True once a token is present — enough to attempt provider calls. */
export function isWhatsAppConfigured(): boolean {
  return getWhatsAppConfig().token.trim().length > 0;
}
