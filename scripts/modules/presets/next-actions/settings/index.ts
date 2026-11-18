import { message } from "../../../../../shared/i18n/message.ts";
import type { SettingsDefinition } from "../../../../../shared/contracts/settings.ts";
import type { ModuleContext } from "../../../../../shared/contracts/module.ts";

export const title = message("loreloom.nextActions.title", "Next actions");
export const definition: SettingsDefinition = {
  version: 1,
  fields: [
    {
      id: "behavior",
      type: "select",
      default: "append",
      label: message(
        "loreloom.nextActions.behavior",
        "When an option is clicked",
      ),
      options: [
        {
          value: "append",
          label: message("loreloom.nextActions.append", "Append to chat input"),
        },
        {
          value: "fill",
          label: message("loreloom.nextActions.fill", "Replace chat input"),
        },
        {
          value: "send",
          label: message("loreloom.nextActions.send", "Send immediately"),
        },
      ],
    },
  ],
};
export function createSettings(context: ModuleContext) {
  const settings = context.settings(definition);
  // Import the previous standalone script preference once, when still available.
  if (
    context.host.read("loreloom.settings.preset.next-actions") === undefined &&
    context.host.read("behavior") === "send"
  ) {
    settings.update({ behavior: "send" }, 0);
  }
  return settings;
}
