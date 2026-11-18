import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { Message } from "../../../../../shared/i18n/message.ts";
export class StateError extends Error {
  readonly source: Message;
  readonly values: Record<string, string | number>;
  constructor(source: Message, values: Record<string, string | number> = {}) {
    super(source.text);
    this.source = source;
    this.values = values;
  }
}
export function errorText(context: ModuleContext, error: unknown): string {
  return error instanceof StateError
    ? context.translate(error.source, error.values)
    : error instanceof Error
      ? error.message
      : String(error);
}
