import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { SettingsDefinition } from "../../../../../shared/contracts/settings.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import { DEFAULT_DESCRIPTION } from "../domain/tool.ts";

export const title = message("loreloom.randomInteger.title", "Random integers");
export function createSettings(context: ModuleContext) {
  const defaultDescription = context.translate(DEFAULT_DESCRIPTION);
  // Preserve descriptions saved by the former standalone editor. Once the
  // inline settings reach version 4, their own value takes precedence.
  const previous = context.host.read(
    `loreloom.random-integer.config.${encodeURIComponent(context.scope.characterId!)}`,
  ) as { toolDescription?: unknown } | undefined;
  const normalize = (value: unknown) =>
    typeof value === "string" && value.trim() ? value : defaultDescription;
  const definition: SettingsDefinition = {
    version: 4,
    migrate: (values) => ({
      randomIntegerDescription: normalize(
        previous?.toolDescription ??
          (values as { toolDescription?: unknown } | null)?.toolDescription,
      ),
    }),
    fields: [
      {
        id: "randomIntegerDescription",
        type: "textarea",
        default: normalize(previous?.toolDescription),
        rows: 8,
        label: message(
          "loreloom.randomInteger.descriptionLabel",
          "Tool description",
        ),
      },
      {
        id: "resetDescription",
        type: "buttons",
        label: message(
          "loreloom.randomInteger.descriptionLabel",
          "Tool description",
        ),
        options: [
          {
            value: "reset",
            label: message("loreloom.randomInteger.reset", "Reset"),
          },
        ],
      },
    ],
    onAction: (id, value, signal) => {
      signal.throwIfAborted();
      if (id !== "resetDescription" || value !== "reset")
        throw new Error("Unknown random integer settings action.");
      // The shared panel preserves input focus on action buttons. Update this
      // module's focused input before blurring so reset renders immediately and
      // any queued change event also carries the reset value.
      const focused = context.host.document.activeElement;
      if (focused?.matches('textarea[id$="-randomIntegerDescription"]')) {
        const input = focused as HTMLTextAreaElement;
        input.value = defaultDescription;
        input.blur();
      }
      const current = settings.read();
      settings.update(
        { ...current.values, randomIntegerDescription: defaultDescription },
        current.revision,
      );
    },
  };
  const settings = context.settings(definition);
  return { settings, definition };
}
