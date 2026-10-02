import "server-only";
import { readKey } from "@/lib/settings";
import { parseIsoDate, recorderSettingKey, type RecorderKey } from "./started";

/** The tenant-scoped start date of a recorder, or null if not stamped. */
export function getRecorderStart(key: RecorderKey): Date | null {
  return parseIsoDate(readKey<unknown>(recorderSettingKey(key), null));
}
