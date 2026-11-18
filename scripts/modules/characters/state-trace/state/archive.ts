import { StateError } from "../domain/errors.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import type { Config } from "../domain/config.ts";
import type { StateHost } from "../runtime/host.ts";

export const ARCHIVE_KEY = "state_trace";
export interface StateArchive {
  version: 1;
  config?: Config;
  configRevision?: number;
  values?: unknown;
}

export function readArchive(host: StateHost): StateArchive | undefined {
  const raw = host.current().chatMetadata[ARCHIVE_KEY];
  if (raw === undefined) return;
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    (raw as { version?: unknown }).version !== 1
  )
    throw invalidConfig();
  return raw as StateArchive;
}

export function invalidConfig(): StateError {
  return new StateError(
    message(
      "loreloom.stateTrace.errors.invalidSavedConfig",
      "Invalid saved state trace configuration.",
    ),
  );
}
