import type {
  ModuleContext,
  ModuleSettings,
} from "../../../../../shared/contracts/module.ts";
import type {
  SettingsDefinition,
  SettingsSnapshot,
  SettingsValues,
} from "../../../../../shared/contracts/settings.ts";
import { validateValues } from "../../../../../shared/contracts/settings.ts";
import type { ConfigStore } from "./config-store.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import { DEFAULT_PROMPT } from "../domain/prompt.ts";
import { DEFAULT_TOOL_DESCRIPTION } from "../domain/tool.ts";
export const title = message("loreloom.stateTrace.title", "State trace");
export function createSettings(
  context: ModuleContext,
  config: ConfigStore,
  openEditor: () => void,
) {
  const defaultPrompt = context.translate(DEFAULT_PROMPT);
  const defaultDescription = context.translate(DEFAULT_TOOL_DESCRIPTION);
  const toValues = (): SettingsValues => {
    const current = config.getConfig();
    return {
      enabled: current.enabled,
      stateTracePrompt: current.prompt!,
      stateTraceToolDescription: current.toolDescription!,
    };
  };
  const defaults = toValues();
  let settings: ModuleSettings;
  const definition: SettingsDefinition = {
    version: 1,
    fields: [
      {
        id: "enabled",
        type: "boolean",
        default: defaults.enabled as boolean,
        label: message("loreloom.stateTrace.enabled", "Enable state tracking"),
      },
      {
        id: "configure",
        type: "buttons",
        label: message("loreloom.stateTrace.configure", "Field configuration"),
        options: [
          {
            value: "open",
            label: message("loreloom.stateTrace.editFields", "Edit fields"),
          },
        ],
      },
      {
        id: "stateTracePrompt",
        type: "textarea",
        default: defaults.stateTracePrompt as string,
        rows: 8,
        label: message("loreloom.stateTrace.statePrompt", "State prompt"),
        description: message(
          "loreloom.stateTrace.promptHint",
          "{{state}}: current state, {{toolName}}: update tool name",
        ),
      },
      {
        id: "resetPrompt",
        type: "buttons",
        label: message("loreloom.stateTrace.statePrompt", "State prompt"),
        options: [
          {
            value: "reset",
            label: message("loreloom.stateTrace.reset", "Reset"),
          },
        ],
      },
      {
        id: "stateTraceToolDescription",
        type: "textarea",
        default: defaults.stateTraceToolDescription as string,
        rows: 8,
        label: message(
          "loreloom.stateTrace.toolDescriptionLabel",
          "Tool description",
        ),
      },
      {
        id: "resetToolDescription",
        type: "buttons",
        label: message(
          "loreloom.stateTrace.toolDescriptionLabel",
          "Tool description",
        ),
        options: [
          {
            value: "reset",
            label: message("loreloom.stateTrace.reset", "Reset"),
          },
        ],
      },
    ],
    onAction: async (id, value, signal) => {
      signal.throwIfAborted();
      if (id === "configure" && value === "open") {
        openEditor();
        return;
      }
      const field =
        id === "resetPrompt"
          ? "stateTracePrompt"
          : id === "resetToolDescription"
            ? "stateTraceToolDescription"
            : undefined;
      if (!field || value !== "reset")
        throw new Error("Unknown state trace action.");
      const confirmation =
        field === "stateTracePrompt"
          ? message(
              "loreloom.stateTrace.confirmResetPrompt",
              "Reset the state prompt to its default text?",
            )
          : message(
              "loreloom.stateTrace.confirmResetDescription",
              "Reset the tool description to its default text?",
            );
      if (!context.host.window.confirm(context.translate(confirmation))) return;
      const replacement =
        field === "stateTracePrompt" ? defaultPrompt : defaultDescription;
      const focused = context.host.document.activeElement;
      if (focused?.matches(`textarea[id$="-${field}"]`)) {
        const input = focused as HTMLTextAreaElement;
        input.value = replacement;
        input.blur();
      }
      const current = settings.read();
      settings.update(
        { ...current.values, [field]: replacement },
        current.revision,
      );
      await settings.flush?.();
    },
  };
  let pending: Promise<void> = Promise.resolve();
  let preview: SettingsSnapshot | undefined;
  let sequence = 0;
  const listeners = new Set<(snapshot: SettingsSnapshot) => void>();
  const read = (): SettingsSnapshot => {
    context.signal.throwIfAborted();
    // Check scope even when an optimistic settings value is being displayed.
    const revision = config.revision();
    return { version: 1, revision, values: toValues() };
  };
  const notify = () => {
    if (context.signal.aborted) return;
    let snapshot: SettingsSnapshot;
    try {
      snapshot = read();
    } catch {
      return;
    }
    for (const listener of listeners) {
      try {
        listener(structuredClone(snapshot));
      } catch (error) {
        console.error("State settings listener failed.", error);
      }
    }
  };
  settings = {
    read,
    update: (values, expectedRevision) => {
      const committed = read();
      const current = preview ?? committed;
      if (current.revision !== expectedRevision)
        throw new Error("Settings revision conflict. Reload before saving.");
      const valid = validateValues(definition.fields, values);
      const ticket = ++sequence;
      preview = { version: 1, revision: expectedRevision + 1, values: valid };
      const next = structuredClone(preview);
      pending = config
        .updateSettings(
          {
            enabled: valid.enabled === true,
            prompt: String(valid.stateTracePrompt),
            toolDescription: String(valid.stateTraceToolDescription),
          },
          expectedRevision,
        )
        .finally(() => {
          if (ticket === sequence) preview = undefined;
          notify();
        });
      // Programmatic updates may not have an awaiting panel request.
      void pending.catch(() => {});
      return next;
    },
    flush: () => pending,
    action: async (id, value, expectedRevision) => {
      if (read().revision !== expectedRevision)
        throw new Error(
          "Settings revision conflict. Reload before running the action.",
        );
      const field = definition.fields.find((field) => field.id === id);
      if (
        field?.type !== "buttons" ||
        !field.options.some((option) => option.value === value)
      )
        throw new Error("Unknown state trace action.");
      await definition.onAction!(id, value, context.signal);
      return read();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  context.lifecycle.defer(config.subscribe(notify));
  context.lifecycle.defer(() => listeners.clear());
  return { settings, definition };
}
