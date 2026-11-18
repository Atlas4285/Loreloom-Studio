import type { ModuleSetup } from "../../../../shared/contracts/module.ts";
import { connectSettingsPanel } from "../../../runtime/settings-panel.ts";
import { NextActionsRenderer } from "./ui/renderer.ts";
import { createSettings, definition, title } from "./settings/index.ts";
import { bindEvents } from "./runtime/events.ts";
import { createOwnership } from "./runtime/ownership.ts";

const setup: ModuleSetup = (context) => {
  const settings = createSettings(context);
  const ownership = createOwnership(context);
  const renderer = new NextActionsRenderer(
    context,
    settings,
    ownership.isActive,
  );
  const refresh = bindEvents(context, renderer);
  const publish = connectSettingsPanel(
    context,
    settings,
    definition,
    title,
    ownership.isActive,
  );
  ownership.subscribe(() => {
    refresh();
    publish();
  });
};
export default setup;
