import studio from "../../studio.config.ts";
import type { HostedThemeAsset, Theme } from "../../shared/contracts/theme.ts";
import type { HostedImageCache } from "../../shared/theme/image-cache.ts";
import { applyTheme } from "../../shared/theme/apply.ts";
import type { Lifecycle } from "./lifecycle.ts";

function install(
  document: Document,
  id: string,
  css: string,
  lifecycle: Lifecycle,
): void {
  // Reuse styles across independently bundled runtimes via the shared document.
  const selector = `style[data-loreloom-runtime-theme="${id}"]`;
  let element = document.querySelector<HTMLStyleElement>(selector);
  if (element && element.textContent !== css)
    throw new Error(
      "Incompatible Loreloom theme styles are already installed.",
    );
  if (!element) {
    element = document.createElement("style");
    element.dataset.loreloomRuntimeTheme = id;
    element.dataset.references = "0";
    element.textContent = css;
    document.head.append(element);
  }
  const shared = element;
  shared.dataset.references = String(
    Number(shared.dataset.references ?? 0) + 1,
  );
  lifecycle.defer(() => {
    const count = Number(shared.dataset.references ?? 1) - 1;
    if (count <= 0) shared.remove();
    else shared.dataset.references = String(count);
  });
}
export interface ModuleTheme {
  readonly id: string;
  readonly available: readonly string[];
  resolve(slot: string): HostedThemeAsset | undefined;
  image(slot: string): Promise<string | undefined>;
  mount(root: HTMLElement): () => void;
  select(themeId: string): void;
  subscribe(callback: (themeId: string) => void): () => void;
}
export class ThemeService {
  private selected: string;
  private readonly roots = new Set<HTMLElement>();
  private readonly documents = new Set<Document>();
  private readonly listeners = new Set<(themeId: string) => void>();
  constructor(
    private readonly themes: readonly Theme[],
    private readonly baseCss: string,
    private readonly lifecycle: Lifecycle,
    private readonly images: HostedImageCache,
    initialId = studio.themes.defaultId as string,
  ) {
    if (!themes.some((theme) => theme.manifest.id === initialId))
      throw new Error(`Unknown theme: ${initialId}`);
    this.selected = initialId;
    lifecycle.defer(() => {
      this.roots.clear();
      this.documents.clear();
      this.listeners.clear();
    });
  }
  get id(): string {
    return this.selected;
  }
  get available(): readonly string[] {
    return this.themes.map((theme) => theme.manifest.id);
  }
  resolve(slot: string): HostedThemeAsset | undefined {
    return this.themes.find((theme) => theme.manifest.id === this.selected)
      ?.assets[slot];
  }
  forScope(lifecycle: Lifecycle): ModuleTheme {
    const service = this;
    return {
      get id() {
        return service.id;
      },
      get available() {
        return service.available;
      },
      resolve: (slot) => {
        lifecycle.assertActive();
        return service.resolve(slot);
      },
      image: async (slot) => {
        lifecycle.assertActive();
        const asset = service.resolve(slot);
        if (!asset) return undefined;
        const url = await service.images.get(asset);
        lifecycle.assertActive();
        return url;
      },
      mount: (root) => {
        lifecycle.assertActive();
        const dispose = service.mount(root);
        const detach = lifecycle.defer(dispose);
        return () => {
          detach();
          dispose();
        };
      },
      select: (id) => {
        lifecycle.assertActive();
        service.select(id);
      },
      subscribe: (callback) => {
        lifecycle.assertActive();
        const dispose = service.subscribe(callback);
        lifecycle.defer(dispose);
        return dispose;
      },
    };
  }
  mount(root: HTMLElement): () => void {
    this.lifecycle.assertActive();
    if (this.roots.has(root)) throw new Error("Theme root is already mounted.");
    if (!this.documents.has(root.ownerDocument)) {
      install(root.ownerDocument, "base", this.baseCss, this.lifecycle);
      for (const theme of this.themes) {
        install(
          root.ownerDocument,
          `theme-${theme.manifest.id}`,
          theme.palette,
          this.lifecycle,
        );
      }
      this.documents.add(root.ownerDocument);
    }
    const previous = {
      root: root.getAttribute("data-loreloom-root"),
      theme: root.getAttribute("data-theme"),
    };
    applyTheme(root, this.selected);
    this.roots.add(root);
    let detach = () => {};
    const dispose = () => {
      if (!this.roots.delete(root)) return;
      detach();
      if (previous.root === null) root.removeAttribute("data-loreloom-root");
      else root.setAttribute("data-loreloom-root", previous.root);
      if (previous.theme === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previous.theme);
    };
    detach = this.lifecycle.defer(dispose);
    return dispose;
  }
  select(themeId: string): void {
    this.lifecycle.assertActive();
    if (!this.available.includes(themeId))
      throw new Error(`Unknown theme: ${themeId}`);
    if (themeId === this.selected) return;
    this.selected = themeId;
    for (const root of this.roots) applyTheme(root, themeId);
    for (const listener of this.listeners) {
      try {
        listener(themeId);
      } catch (error) {
        console.error("Theme listener failed.", error);
      }
    }
  }
  subscribe(callback: (themeId: string) => void): () => void {
    this.lifecycle.assertActive();
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
}
