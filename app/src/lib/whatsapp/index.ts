import "server-only";

import { getWhatsAppConfig, isWhatsAppConfigured } from "./config";
import { WhapiBridge } from "./whapi";
import type { WhatsAppBridge } from "./types";

export { isWhatsAppConfigured, getWhatsAppConfig } from "./config";
export type { WhatsAppBridge } from "./types";

/**
 * Resolve the configured WhatsApp bridge. Throws a clear error when no provider
 * token is set so callers can surface "connect WhatsApp in Settings first".
 */
export function getWhatsAppBridge(): WhatsAppBridge {
  if (!isWhatsAppConfigured()) {
    throw new Error(
      "WhatsApp is not connected. Add credentials in Settings → Integrations → WhatsApp.",
    );
  }
  const cfg = getWhatsAppConfig();
  switch (cfg.provider) {
    case "whapi":
    default:
      return new WhapiBridge({
        token: cfg.token,
        baseUrl: cfg.baseUrl,
        webhookSecret: cfg.webhookSecret,
      });
  }
}
