import "server-only";

import { decryptToken, encryptToken } from "@/lib/google/tokenCrypto";
import { readKey, setKey } from "@/lib/settings";

/**
 * WhatsApp bridge credentials. Stored as settings keys (single instance for now;
 * per-tenant in the tenancy phase). The token and the webhook secret are
 * secrets: encrypted at rest with the same key as every other stored token
 * (lib/google/tokenCrypto), and never logged.
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

/** What is actually written to the settings row: secrets sealed, the rest plain. */
type StoredWhatsAppConfig = Partial<Omit<WhatsAppConfig, "token" | "webhookSecret">> & {
  /** Legacy plaintext fields from before 2026-10-22; read once, rewritten sealed on the next save. */
  token?: string;
  webhookSecret?: string;
  tokenEnc?: string;
  webhookSecretEnc?: string;
};

const DEFAULTS: WhatsAppConfig = {
  provider: "whapi",
  token: "",
  channel: "",
  baseUrl: "",
  webhookSecret: "",
};

function open(sealed: string | undefined, legacy: string | undefined): string {
  if (sealed) {
    try {
      return decryptToken(sealed);
    } catch {
      return "";
    }
  }
  return legacy ?? "";
}

export function getWhatsAppConfig(): WhatsAppConfig {
  const stored = readKey<StoredWhatsAppConfig>("whatsapp_config", {});
  return {
    provider: "whapi",
    channel: stored.channel ?? DEFAULTS.channel,
    baseUrl: stored.baseUrl ?? DEFAULTS.baseUrl,
    token: open(stored.tokenEnc, stored.token),
    webhookSecret: open(stored.webhookSecretEnc, stored.webhookSecret),
  };
}

export function setWhatsAppConfig(config: Partial<WhatsAppConfig>): void {
  const next = { ...getWhatsAppConfig(), ...config };
  const stored: StoredWhatsAppConfig = {
    provider: "whapi",
    channel: next.channel,
    baseUrl: next.baseUrl,
    tokenEnc: next.token ? encryptToken(next.token) : undefined,
    webhookSecretEnc: next.webhookSecret ? encryptToken(next.webhookSecret) : undefined,
  };
  setKey("whatsapp_config", stored);
}

/** True once a token is present — enough to attempt provider calls. */
export function isWhatsAppConfigured(): boolean {
  return getWhatsAppConfig().token.trim().length > 0;
}
