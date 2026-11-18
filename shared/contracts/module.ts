import { isLocalizedName, type LocalizedName } from "./names.ts";
import type { HostScope, CarrierTarget } from "../host/adapter.ts";
import type { Message } from "../i18n/message.ts";
import type { Locale } from "../i18n/locale.ts";
import type {
  JsonValue,
  ServiceDeclaration,
  ServiceUse,
  ServiceProvider,
} from "./services.ts";
import { isServiceDeclaration } from "./services.ts";
import type {
  SettingsDefinition,
  SettingsSnapshot,
  SettingsValues,
} from "./settings.ts";
import type { Lifecycle, Disposer } from "../../scripts/runtime/lifecycle.ts";
import type { ModuleTheme } from "../../scripts/runtime/theme.ts";
import type { HostAdapter } from "../host/adapter.ts";
export interface Profile {
  id: CarrierTarget;
  target: CarrierTarget;
  modules: string[];
}
export interface ModuleManifest {
  id: string;
  targets: CarrierTarget[];
  scriptId: string;
  name: LocalizedName;
  provides: ServiceDeclaration[];
  uses: ServiceUse[];
  buttons?: { name: string; visible: boolean }[];
  entry: "./index.ts";
}
export interface ModuleSettings {
  read(): SettingsSnapshot;
  action(
    id: string,
    value: string,
    expectedRevision: number,
  ): Promise<SettingsSnapshot>;
  update(values: SettingsValues, expectedRevision: number): SettingsSnapshot;
  flush?(): Promise<void>;
  subscribe(callback: (snapshot: SettingsSnapshot) => void): Disposer;
}
export interface ServiceRequest {
  sender: string;
  generation: number;
  signal: AbortSignal;
}
export type ServiceHandler = (
  method: string,
  payload: JsonValue,
  request: ServiceRequest,
) => JsonValue | Promise<JsonValue>;
export interface ServiceConnection {
  readonly provider: ServiceProvider;
  request(
    method: "read" | "update" | "action",
    payload: JsonValue,
  ): Promise<JsonValue>;
}
export interface ModuleServices {
  provide(service: string, handler: ServiceHandler): Disposer;
  find(service: string): ServiceProvider | undefined;
  connectSettings(
    service: string,
    protocol: number,
  ): ServiceConnection | undefined;
  request(
    service: string,
    method: string,
    payload: JsonValue,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<JsonValue>;
  subscribe(callback: () => void): Disposer;
}
export interface ModuleContext {
  readonly moduleId: string;
  readonly instanceId: string;
  readonly generation: number;
  readonly scope: Readonly<HostScope>;
  readonly host: HostAdapter;
  readonly lifecycle: Lifecycle;
  readonly signal: AbortSignal;
  readonly theme: ModuleTheme;
  readonly services: ModuleServices;
  readonly locale: Locale;
  translate(source: Message, values?: Record<string, string | number>): string;
  settings(definition: SettingsDefinition): ModuleSettings;
}
export type ModuleSetup = (
  context: ModuleContext,
) => void | Disposer | Promise<void | Disposer>;
export interface ModuleDefinition extends ModuleManifest {
  setup: ModuleSetup;
}
const idPattern = /^[a-z][a-z0-9-]*$/;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function parseProfile(value: unknown): Profile {
  if (
    !record(value) ||
    !["preset", "character"].includes(String(value.id)) ||
    value.id !== value.target ||
    !Array.isArray(value.modules) ||
    !value.modules.every(
      (id: unknown) => typeof id === "string" && idPattern.test(id),
    ) ||
    new Set(value.modules).size !== value.modules.length
  )
    throw new Error("Invalid script profile.");
  return value as unknown as Profile;
}
export function parseModuleManifest(value: unknown): ModuleManifest {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !idPattern.test(value.id) ||
    value.entry !== "./index.ts" ||
    !Array.isArray(value.targets) ||
    !value.targets.length ||
    !value.targets.every(
      (target: unknown) => target === "preset" || target === "character",
    ) ||
    new Set(value.targets).size !== value.targets.length ||
    Object.hasOwn(value, "requires") ||
    typeof value.scriptId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value.scriptId,
    ) ||
    !isLocalizedName(value.name) ||
    !Array.isArray(value.provides) ||
    !Array.isArray(value.uses) ||
    !value.provides.every(isServiceDeclaration) ||
    !value.uses.every(
      (use: unknown) =>
        isServiceDeclaration(use) &&
        typeof (use as unknown as Record<string, unknown>).required ===
          "boolean",
    )
  )
    throw new Error("Invalid module manifest.");
  if (
    value.buttons !== undefined &&
    (!Array.isArray(value.buttons) ||
      value.buttons.some(
        (button: unknown) =>
          !record(button) ||
          typeof button.name !== "string" ||
          !button.name.trim() ||
          typeof button.visible !== "boolean",
      ) ||
      new Set(value.buttons.map((button: { name: string }) => button.name))
        .size !== value.buttons.length)
  )
    throw new Error("Invalid module buttons.");
  const manifest = value as unknown as ModuleManifest;
  for (const list of [manifest.provides, manifest.uses]) {
    if (new Set(list.map((entry) => entry.service)).size !== list.length)
      throw new Error(`Duplicate service declaration: ${manifest.id}`);
  }
  if (
    manifest.provides.some((entry) => entry.service === "settings-panel") &&
    manifest.targets.some((target) => target !== "preset")
  )
    throw new Error("Only preset modules may provide settings-panel.");
  return manifest;
}
export function selectModules<T extends ModuleManifest>(
  profile: Profile,
  modules: T[],
): T[] {
  const catalog = new Map(modules.map((module) => [module.id, module]));
  if (catalog.size !== modules.length) throw new Error("Duplicate module ID.");
  return profile.modules.map((id) => {
    const module = catalog.get(id);
    if (!module) throw new Error(`Module missing from catalog: ${id}`);
    if (!module.targets.includes(profile.target))
      throw new Error(`Module ${id} cannot run in ${profile.target}.`);
    return module;
  });
}
