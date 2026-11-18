import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
export function createBackgrounds(context: ModuleContext, refresh: () => void) {
  const urls = new Map<string, string>();
  const layers = new WeakMap<HTMLElement, HTMLElement>();
  for (const slot of [
    "user",
    "assistant-top",
    "assistant-texture",
    "assistant-bottom",
    "reasoning-marker",
    "tool-call-marker",
  ]) {
    void context.theme
      .image(`text-style.${slot}`)
      .then((url) => {
        if (url && !context.signal.aborted) {
          urls.set(slot, url);
          refresh();
        }
      })
      .catch(() => {});
  }
  function image(slot: string, className: string): HTMLImageElement {
    const element = context.host.document.createElement("img");
    element.className = className;
    element.alt = "";
    element.draggable = false;
    element.setAttribute("aria-hidden", "true");
    updateImage(element, slot);
    return element;
  }
  function updateImage(element: HTMLImageElement, slot: string): void {
    const url = urls.get(slot);
    if (url && element.getAttribute("src") !== url) element.src = url;
    element.hidden = !url;
  }
  function background(text: HTMLElement, user: boolean): HTMLElement {
    let layer = layers.get(text);
    if (
      !layer ||
      (user && layer.tagName !== "IMG") ||
      (!user && layer.tagName === "IMG")
    ) {
      if (user) layer = image("user", "loreloom-text-style__background");
      else {
        layer = context.host.document.createElement("div");
        layer.className =
          "loreloom-text-style__background loreloom-text-style__background--assistant";
        layer.setAttribute("aria-hidden", "true");
        layer.append(
          image(
            "assistant-top",
            "loreloom-text-style__decoration loreloom-text-style__decoration--top",
          ),
          image(
            "assistant-bottom",
            "loreloom-text-style__decoration loreloom-text-style__decoration--bottom",
          ),
        );
      }
      layers.set(text, layer);
    }
    if (user) updateImage(layer as HTMLImageElement, "user");
    else {
      const texture = urls.get("assistant-texture");
      const value = texture ? `url(${JSON.stringify(texture)})` : "none";
      if (layer.style.backgroundImage !== value)
        layer.style.backgroundImage = value;
      const top = layer.querySelector<HTMLImageElement>(
        ".loreloom-text-style__decoration--top",
      );
      const bottom = layer.querySelector<HTMLImageElement>(
        ".loreloom-text-style__decoration--bottom",
      );
      if (top) updateImage(top, "assistant-top");
      if (bottom) updateImage(bottom, "assistant-bottom");
    }
    const existing = text.querySelector(
      ":scope > .loreloom-text-style__background",
    );
    if (existing !== layer) {
      existing?.remove();
      text.prepend(layer);
    }
    return layer;
  }
  return { background, image, updateImage };
}
export type Backgrounds = ReturnType<typeof createBackgrounds>;
