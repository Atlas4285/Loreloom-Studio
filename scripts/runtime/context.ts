import type { HostAdapter, HostScope } from "../../shared/host/adapter.ts";
import type {
  ModuleContext,
  ModuleDefinition,
} from "../../shared/contracts/module.ts";
import { resolveLocale } from "../../shared/i18n/locale.ts";
import { translateMessage } from "../../shared/i18n/message.ts";
import zhCN from "../../locales/zh-CN.json";
import type { Lifecycle } from "./lifecycle.ts";
import type { ThemeService } from "./theme.ts";
import type { ServiceBridge } from "./services.ts";
import { SettingsService } from "./settings.ts";

export function createModuleContext(
  module: ModuleDefinition,
  host: HostAdapter,
  scope: HostScope,
  lifecycle: Lifecycle,
  theme: ThemeService,
  services: ServiceBridge,
): ModuleContext {
  const locale = resolveLocale(host.locale());
  const scopeKey =
    scope.target === "character" ? `character:${scope.characterId}` : "preset";
  const settings = new SettingsService(host, lifecycle, scopeKey);
  return {
    moduleId: module.id,
    instanceId: services.instanceId,
    generation: services.generation,
    scope: Object.freeze({ ...scope }),
    host,
    lifecycle,
    signal: lifecycle.signal,
    theme: theme.forScope(lifecycle),
    services: services.forModule(module, lifecycle),
    locale,
    translate: (source, values) =>
      translateMessage(source, locale === "zh-CN" ? zhCN : {}, values),
    settings: (definition) => settings.register(module.id, definition),
  };
}
