import type {
  ModuleContext,
  ModuleSettings,
} from "../../../../../shared/contracts/module.ts";
import type {
  SettingsDefinition,
  SettingsValues,
} from "../../../../../shared/contracts/settings.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import { DEFAULTS, LIMITS } from "./config.ts";
import type { ResourceStates } from "../../../../../shared/contracts/resources.ts";
import { fontMessages } from "../fonts/messages.ts";
interface FontSettings {
  state(): ResourceStates;
  subscribe(notify: () => void): () => void;
  action(value: string): void;
}
export const title = message("loreloom.textStyle.title", "Text style");
export function createSettings(context: ModuleContext, fonts?: FontSettings) {
  let settings: ModuleSettings;
  const definition: SettingsDefinition = {
    version: 4,
    resources: () =>
      fonts?.state() ?? {
        fontId: {
          options: [
            {
              value: "default",
              label: context.translate(fontMessages.default),
              available: true,
            },
          ],
        },
      },
    subscribeResources: fonts?.subscribe,
    migrate: (values) => {
      if (!values || typeof values !== "object" || Array.isArray(values))
        throw new Error("Invalid stored text style settings.");
      return { ...DEFAULTS, ...(values as SettingsValues) };
    },
    fields: [
      {
        id: "enabled",
        type: "boolean",
        default: DEFAULTS.enabled,
        label: message("loreloom.textStyle.enabled", "Enable text styling"),
      },
      {
        id: "userMessages",
        type: "boolean",
        default: DEFAULTS.userMessages,
        label: message(
          "loreloom.textStyle.userMessages",
          "Style user messages",
        ),
      },
      {
        id: "assistantMessages",
        type: "boolean",
        default: DEFAULTS.assistantMessages,
        label: message(
          "loreloom.textStyle.assistantMessages",
          "Style assistant messages",
        ),
      },
      {
        id: "reasoning",
        type: "boolean",
        default: DEFAULTS.reasoning,
        label: message("loreloom.textStyle.reasoning", "Style reasoning"),
      },
      {
        id: "toolCalls",
        type: "boolean",
        default: DEFAULTS.toolCalls,
        label: message("loreloom.textStyle.toolCalls", "Style tool calls"),
      },
      {
        id: "advanced",
        type: "group",
        expanded: false,
        label: message("loreloom.textStyle.advanced", "Advanced settings"),
        fields: [
          {
            id: "fontId",
            type: "resource",
            default: DEFAULTS.fontId,
            label: fontMessages.label,
          },
          {
            id: "showFontShortcut",
            type: "boolean",
            default: DEFAULTS.showFontShortcut,
            label: message(
              "loreloom.textStyle.showFontShortcut",
              "Show font shortcut",
            ),
          },
          {
            id: "fontSize",
            type: "range",
            default: DEFAULTS.fontSize,
            ...LIMITS.fontSize,
            integer: true,
            label: message("loreloom.textStyle.fontSize", "Font size"),
          },
          {
            id: "fontWeight",
            type: "range",
            default: DEFAULTS.fontWeight,
            ...LIMITS.fontWeight,
            integer: true,
            label: message("loreloom.textStyle.fontWeight", "Font weight"),
          },
          {
            id: "lineHeight",
            type: "range",
            default: DEFAULTS.lineHeight,
            ...LIMITS.lineHeight,
            label: message("loreloom.textStyle.lineHeight", "Line height"),
          },
          {
            id: "paragraphSpacing",
            type: "range",
            default: DEFAULTS.paragraphSpacing,
            ...LIMITS.paragraphSpacing,
            label: message(
              "loreloom.textStyle.paragraphSpacing",
              "Paragraph spacing (em)",
            ),
          },
          {
            id: "padding",
            type: "range",
            default: DEFAULTS.padding,
            ...LIMITS.padding,
            integer: true,
            label: message("loreloom.textStyle.padding", "Page padding"),
          },
          {
            id: "backgroundStrength",
            type: "range",
            default: DEFAULTS.backgroundStrength,
            ...LIMITS.backgroundStrength,
            integer: true,
            label: message(
              "loreloom.textStyle.backgroundStrength",
              "Background strength",
            ),
          },
        ],
      },
      {
        id: "reset",
        type: "buttons",
        label: message("loreloom.textStyle.restore", "Restore settings"),
        options: [
          {
            value: "default",
            label: message("loreloom.textStyle.reset", "Reset"),
          },
        ],
      },
    ],
    onAction: (id, value, signal) => {
      signal.throwIfAborted();
      if (id === "fontId" && fonts) {
        fonts.action(value);
        return;
      }
      if (id !== "reset" || value !== "default")
        throw new Error("Unknown text style action.");
      settings.update({ ...DEFAULTS }, settings.read().revision);
    },
  };
  settings = context.settings(definition);
  if (context.host.read("loreloom.settings.preset.text-style") === undefined) {
    const values: SettingsValues = { ...DEFAULTS };
    let found = false;
    for (const key of [
      "enabled",
      "userMessages",
      "assistantMessages",
      "reasoning",
      "toolCalls",
    ] as const) {
      const value = context.host.read(key);
      if (typeof value === "boolean") {
        values[key] = value;
        found = true;
      }
    }
    for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
      const value = context.host.read(key);
      const { min, max, step } = LIMITS[key];
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= min &&
        value <= max &&
        Math.abs((value - min) / step - Math.round((value - min) / step)) < 1e-7
      ) {
        values[key] = value;
        found = true;
      }
    }
    if (found) settings.update(values, 0);
  }
  return { settings, definition };
}
