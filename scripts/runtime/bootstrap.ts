import type {
  Profile,
  ModuleDefinition,
} from "../../shared/contracts/module.ts";
import {
  selectModules,
  parseModuleManifest,
  parseProfile,
} from "../../shared/contracts/module.ts";
import type { Theme } from "../../shared/contracts/theme.ts";
import type { HostAdapter, HostScope } from "../../shared/host/adapter.ts";
import { createHostAdapter } from "../../shared/host/adapter.ts";
import { HostedImageCache } from "../../shared/theme/image-cache.ts";
import { Lifecycle } from "./lifecycle.ts";
import { ServiceBridge } from "./services.ts";
import { ThemeService } from "./theme.ts";
import { createModuleContext } from "./context.ts";

export interface RuntimeOptions {
  profile: Profile;
  module: ModuleDefinition;
  theme: Theme;
  baseCss: string;
  host?: HostAdapter;
}
export interface RuntimeHandle {
  readonly instanceId: string;
  stop(): Promise<void>;
}
export async function bootstrap(
  options: RuntimeOptions,
): Promise<RuntimeHandle> {
  const profile = parseProfile(options.profile);
  const metadata = parseModuleManifest(options.module);
  if (profile.modules.length !== 1 || profile.modules[0] !== metadata.id)
    throw new Error("An independent script must contain exactly one feature.");
  selectModules(profile, [metadata]);
  const module = options.module;
  const host = options.host ?? createHostAdapter(profile.target);
  const lifetime = new Lifecycle();
  const images = new HostedImageCache(host.window);
  lifetime.defer(() => images.clear());
  const instanceId = crypto.randomUUID();
  let generation = 0;
  let current: Lifecycle | undefined;
  let scopeFingerprint = "";
  let chain = Promise.resolve();

  async function run(scope: HostScope): Promise<void> {
    lifetime.assertActive();
    const lifecycle = new Lifecycle();
    current = lifecycle;
    const abort = () => {
      void lifecycle.dispose();
    };
    lifetime.signal.addEventListener("abort", abort, { once: true });
    lifecycle.defer(() => lifetime.signal.removeEventListener("abort", abort));
    const theme = new ThemeService(
      [options.theme],
      options.baseCss,
      lifecycle,
      images,
      options.theme.manifest.id,
    );
    const bridge = new ServiceBridge(
      host,
      instanceId,
      ++generation,
      profile.target,
      lifecycle,
    );
    let active: Lifecycle | undefined;
    let requiredProviders = "";
    let failed = false;
    let reconciliation = Promise.resolve();
    const reconcile = () => {
      reconciliation = reconciliation
        .then(async () => {
          if (lifecycle.signal.aborted) return;
          const required = module.uses.filter((use) => use.required);
          const providers = required.map((use) =>
            bridge.find(use.service, use.protocol),
          );
          const signature = JSON.stringify(providers);
          if (
            active &&
            (providers.some((provider) => !provider) ||
              signature !== requiredProviders)
          ) {
            await active.dispose();
            active = undefined;
            failed = false;
          }
          if (active || failed || providers.some((provider) => !provider))
            return;
          requiredProviders = signature;
          const moduleLife = new Lifecycle();
          active = moduleLife;
          const abortModule = () => moduleLife.cancel();
          lifecycle.signal.addEventListener("abort", abortModule, {
            once: true,
          });
          moduleLife.defer(() =>
            lifecycle.signal.removeEventListener("abort", abortModule),
          );
          try {
            const setup = Promise.resolve()
              .then(() => {
                moduleLife.assertActive();
                return module.setup(
                  createModuleContext(
                    module,
                    host,
                    scope,
                    moduleLife,
                    theme,
                    bridge,
                  ),
                );
              })
              .then((dispose) => {
                if (dispose) moduleLife.defer(dispose);
              });
            await moduleLife.waitFor(setup);
            moduleLife.assertActive();
            console.info(
              `Loreloom ${module.id} ready: ${options.theme.manifest.id}.`,
            );
          } catch (error) {
            failed = true;
            await moduleLife.dispose();
            active = undefined;
            if (!lifecycle.signal.aborted)
              console.error(`Loreloom module failed: ${module.id}`, error);
          }
        })
        .catch((error) =>
          console.error("Loreloom module reconciliation failed.", error),
        );
      return reconciliation;
    };
    lifecycle.defer(async () => {
      await active?.dispose();
    });
    lifecycle.defer(
      bridge.subscribe(() => {
        void reconcile();
      }),
    );
    await reconcile();
  }
  function refresh(force = false): void {
    if (lifetime.signal.aborted) return;
    let scope: HostScope;
    try {
      scope = host.scope();
    } catch (error) {
      scopeFingerprint = "";
      void current?.dispose();
      console.warn("Loreloom carrier is unavailable.", error);
      return;
    }
    const fingerprint = JSON.stringify({ scope, locale: host.locale() });
    if (!force && fingerprint === scopeFingerprint) return;
    scopeFingerprint = fingerprint;
    void current?.dispose();
    chain = chain
      .then(async () => {
        await current?.dispose();
        if (!lifetime.signal.aborted && fingerprint === scopeFingerprint)
          await run(scope);
      })
      .catch((error) => {
        if (scopeFingerprint === fingerprint) scopeFingerprint = "";
        console.error("Loreloom runtime failed.", error);
      });
  }
  try {
    for (const event of [
      "CHAT_CHANGED",
      "SETTINGS_UPDATED",
      "CHARACTER_EDITED",
    ])
      lifetime.defer(host.subscribe(event, () => refresh()));
    for (const event of ["PRESET_CHANGED", "OAI_PRESET_CHANGED_AFTER"])
      lifetime.defer(host.subscribe(event, () => refresh(true)));
    lifetime.listen(window, "pagehide", () => {
      void lifetime.dispose();
    });
    lifetime.defer(() => current?.dispose());
    refresh();
    await chain;
    lifetime.assertActive();
    return { instanceId, stop: () => lifetime.dispose() };
  } catch (error) {
    await lifetime.dispose();
    throw error;
  }
}
