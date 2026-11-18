import type { ModuleSetup } from "../../../../shared/contracts/module.ts";
import { createOwnership } from "../../../runtime/module-ownership.ts";
import { connectSettingsPanel } from "../../../runtime/settings-panel.ts";
import { createUsageHost } from "./runtime/host.ts";
import { createSettings, title } from "./settings/index.ts";
import { createTracker } from "./usage/tracker.ts";
import { createHistory } from "./usage/history.ts";
import { observeApiUsage } from "./api/observer.ts";
import { UsageRenderer } from "./ui/renderer.ts";
import { bindEvents } from "./runtime/events.ts";
const setup: ModuleSetup = (context) => {
  const host = createUsageHost(context);
  const ownership = createOwnership(context, "token-usage");
  const { settings, definition, getExtraBody } = createSettings(context);
  let renderer: UsageRenderer | undefined;
  let history: ReturnType<typeof createHistory> | undefined;
  let frame = 0;
  const render = () => {
    if (frame || context.signal.aborted) return;
    frame = context.host.window.requestAnimationFrame(() => {
      frame = 0;
      if (!context.signal.aborted) renderer?.renderAll();
    });
  };
  context.lifecycle.defer(() =>
    context.host.window.cancelAnimationFrame(frame),
  );
  const tracker = createTracker(context, host, ownership.isActive, () => {
    render();
    history?.refresh();
  });
  history = createHistory(context, host, tracker, ownership.isActive, render);
  renderer = new UsageRenderer(
    context,
    host,
    tracker,
    history,
    ownership.isActive,
    () => settings.read().values.showUsageSummary === true,
  );
  bindEvents(context, tracker, history, ownership.isActive, render);
  context.lifecycle.defer(settings.subscribe(render));
  const publish = connectSettingsPanel(
    context,
    settings,
    definition,
    title,
    ownership.isActive,
  );
  let stopObserving: (() => void) | undefined;
  const sync = () => {
    if (ownership.isActive()) {
      if (!stopObserving)
        stopObserving = observeApiUsage(
          context,
          host,
          ownership.isActive,
          getExtraBody,
          tracker.captureRequest,
        );
      history?.refresh();
      render();
    } else {
      stopObserving?.();
      stopObserving = undefined;
      tracker.cancel();
      history?.clear();
      renderer?.clear();
    }
    publish();
  };
  ownership.subscribe(sync);
  context.lifecycle.defer(() => stopObserving?.());
  sync();
};
export default setup;
