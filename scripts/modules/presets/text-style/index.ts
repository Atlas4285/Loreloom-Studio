import type { ModuleSetup } from "../../../../shared/contracts/module.ts";
import { createOwnership } from "../../../runtime/module-ownership.ts";
import { connectSettingsPanel } from "../../../runtime/settings-panel.ts";
import { createSettings, title } from "./settings/index.ts";
import { readConfig } from "./settings/config.ts";
import { TextRenderer } from "./ui/renderer.ts";
import { createGeneration } from "./runtime/generation.ts";
import { bindEvents } from "./runtime/events.ts";
import { FontController } from "./fonts/controller.ts";
import { FontStatus } from "./ui/font-status.ts";
const setup: ModuleSetup = (context) => {
  const ownership = createOwnership(context, "text-style");
  const fonts = new FontController(context, ownership.isActive, () =>
    refresh(),
  );
  const { settings, definition } = createSettings(context, fonts);
  fonts.bind(settings);
  let frame = 0;
  let renderer: TextRenderer | undefined;
  let fontStatus: FontStatus | undefined;
  const refresh = () => {
    if (frame || context.signal.aborted) return;
    frame = context.host.window.requestAnimationFrame(() => {
      frame = 0;
      if (context.signal.aborted) return;
      try {
        const config = readConfig(settings.read().values);
        renderer?.render(
          config,
          config.enabled ? fonts.family(config.fontId) : undefined,
        );
        const id = config.enabled ? config.fontId : "default";
        if (config.showFontShortcut)
          fontStatus?.render(
            id,
            fonts.state().fontId?.options ?? [],
            config.enabled,
          );
        else fontStatus?.clear();
      } catch (error) {
        console.error("Could not render text styling.", error);
      }
    });
  };
  context.lifecycle.defer(() =>
    context.host.window.cancelAnimationFrame(frame),
  );
  const generating = createGeneration(context, refresh);
  fontStatus = new FontStatus(context, ownership.isActive, refresh, settings);
  renderer = new TextRenderer(context, ownership.isActive, generating, refresh);
  const publish = connectSettingsPanel(
    context,
    settings,
    definition,
    title,
    ownership.isActive,
  );
  context.lifecycle.defer(settings.subscribe(refresh));
  bindEvents(context, refresh);
  ownership.subscribe(() => {
    if (!ownership.isActive()) renderer?.clear();
    else fonts.start();
    refresh();
    publish();
  });
  fonts.start();
  refresh();
};
export default setup;
