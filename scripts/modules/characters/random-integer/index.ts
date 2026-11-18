import type { ModuleSetup } from "../../../../shared/contracts/module.ts";
import { createOwnership } from "../../../runtime/module-ownership.ts";
import { connectSettingsPanel } from "../../../runtime/settings-panel.ts";
import { DEFAULT_DESCRIPTION } from "./domain/tool.ts";
import css from "./ui/styles.css?raw";
import { createModel } from "./model/integration.ts";
import { createSettings, title } from "./settings/index.ts";

const setup: ModuleSetup = (context) => {
  const ownership = createOwnership(context, "random-integer");
  const style = context.host.document.createElement("style");
  style.textContent = css;
  context.host.document.head.append(style);
  context.lifecycle.defer(() => style.remove());
  const { settings, definition } = createSettings(context);
  const model = createModel(context, ownership.isActive, () => {
    const description = settings.read().values.randomIntegerDescription;
    return typeof description === "string" && description.trim()
      ? description
      : context.translate(DEFAULT_DESCRIPTION);
  });
  const publish = connectSettingsPanel(
    context,
    settings,
    definition,
    title,
    ownership.isActive,
  );
  const sync = () => {
    model.register();
    publish();
  };
  context.lifecycle.defer(settings.subscribe(sync));
  ownership.subscribe(sync);
  sync();
};
export default setup;
