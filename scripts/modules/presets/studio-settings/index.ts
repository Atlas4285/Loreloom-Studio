import type { ModuleSetup } from "../../../../shared/contracts/module.ts";
import { SettingsGroups } from "./state/groups.ts";
import { SettingsPanel } from "./ui/panel.ts";
import { mountEntry } from "./runtime/entry.ts";
const setup: ModuleSetup = (context) => {
  const groups = new SettingsGroups(context);
  const release = context.services.provide("settings-panel", groups.handle);
  const panel = new SettingsPanel(context, groups);
  const syncEntry = mountEntry(context, groups.isActive, () => panel.open());
  const sync = () => {
    groups.sync();
    syncEntry();
  };
  const unsubscribe = context.services.subscribe(sync);
  context.lifecycle.defer(context.host.subscribe("SETTINGS_UPDATED", sync));
  context.lifecycle.interval(sync, 5000);
  context.lifecycle.defer(() => {
    unsubscribe();
    release();
    groups.dispose();
  });
  sync();
};
export default setup;
