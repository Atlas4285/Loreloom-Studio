import type {
  ModuleContext,
  ModuleSettings,
} from "../../../../../shared/contracts/module.ts";
import type { SettingsDefinition } from "../../../../../shared/contracts/settings.ts";
import { message } from "../../../../../shared/i18n/message.ts";
export const title = message("loreloom.tokenUsage.title", "Token usage");
export const OPENAI_BODY = JSON.stringify(
  { stream_options: { include_usage: true } },
  null,
  2,
);
function initialBody(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return OPENAI_BODY;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      !Object.keys(parsed).length
    )
      return OPENAI_BODY;
  } catch {
    // Retain custom text so that editing it does not discard the user's input.
  }
  return value;
}
export function parseExtraBody(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Extra request body must be a JSON object.");
  const body = value as Record<string, unknown>;
  if ("stream" in body && body.stream !== true)
    throw new Error("The extra streaming body cannot disable streaming.");
  return body;
}
export function createSettings(context: ModuleContext) {
  let settings: ModuleSettings;
  const definition: SettingsDefinition = {
    version: 3,
    migrate: (values, version) => ({
      showUsageSummary: true,
      streamExtraBody:
        version >= 2
          ? ((values as { streamExtraBody?: string } | null)?.streamExtraBody ??
            OPENAI_BODY)
          : initialBody(
              (values as { streamExtraBody?: unknown } | null)?.streamExtraBody,
            ),
    }),
    fields: [
      {
        id: "showUsageSummary",
        type: "boolean",
        default: true,
        label: message(
          "loreloom.tokenUsage.showSummary",
          "Show usage progress bar",
        ),
      },
      {
        id: "streamExtraBody",
        type: "textarea",
        rows: 6,
        default: OPENAI_BODY,
        label: message(
          "loreloom.tokenUsage.extraBody",
          "Extra request body (JSON)",
        ),
        description: message(
          "loreloom.tokenUsage.extraBodyDescription",
          "Request the model's token usage for this round using a JSON object.",
        ),
        placeholder: message("loreloom.tokenUsage.extraBodyPlaceholder", "{}"),
        maxLength: 65536,
      },
      {
        id: "extraBodyTemplate",
        type: "buttons",
        label: message(
          "loreloom.tokenUsage.templates",
          "Request body templates",
        ),
        options: [
          {
            value: "reset",
            label: message("loreloom.tokenUsage.reset", "Reset"),
          },
        ],
      },
    ],
    onAction: (id, value, signal) => {
      signal.throwIfAborted();
      if (id !== "extraBodyTemplate" || value !== "reset")
        throw new Error("Unknown token usage action.");
      const snapshot = settings.read();
      settings.update(
        {
          ...snapshot.values,
          streamExtraBody: OPENAI_BODY,
        },
        snapshot.revision,
      );
    },
  };
  settings = context.settings(definition);
  const legacy = context.host.read("streamExtraBody");
  if (
    context.host.read("loreloom.settings.preset.token-usage") === undefined &&
    typeof legacy === "string" &&
    legacy.length <= 65536
  )
    settings.update(
      { showUsageSummary: true, streamExtraBody: initialBody(legacy) },
      0,
    );
  return {
    settings,
    definition,
    getExtraBody: () => String(settings.read().values.streamExtraBody),
  };
}
