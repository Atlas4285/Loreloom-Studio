import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import css from "../ui/styles/button.css?raw";
export function mountEntry(
  context: ModuleContext,
  isActive: () => boolean,
  open: () => void,
): () => void {
  const page = context.host.document;
  const style = page.createElement("style");
  style.textContent =
    css +
    `\n[id=${JSON.stringify(`script_container_${context.host.scriptId}`)}] > .qr--button:not([data-loreloom-settings-entry]) { display: none !important; }`;
  page.head.append(style);
  let current: HTMLElement | null = null;
  let original: DocumentFragment | undefined;
  let unmount: (() => void) | undefined;
  let display = "";
  let priority = "";
  let oldLabel: string | null = null;
  let image: string | undefined;
  const click = (event: Event) => {
    if (!isActive()) return;
    event.preventDefault();
    open();
  };
  const release = () => {
    if (!current) return;
    current.removeEventListener("click", click);
    unmount?.();
    current.style.removeProperty("--settings-button-image");
    current.removeAttribute("data-loreloom-settings-entry");
    if (display) current.style.setProperty("display", display, priority);
    else current.style.removeProperty("display");
    if (oldLabel === null) current.removeAttribute("aria-label");
    else current.setAttribute("aria-label", oldLabel);
    if (original) current.replaceChildren(original);
    current = null;
  };
  const sync = () => {
    if (context.signal.aborted) return;
    if (!isActive()) {
      release();
      return;
    }
    const container = page.getElementById(
      `script_container_${context.host.scriptId}`,
    );
    const button = container?.querySelector<HTMLElement>(".qr--button") ?? null;
    if (button !== current) {
      release();
      current = button;
      if (current) {
        display = current.style.getPropertyValue("display");
        priority = current.style.getPropertyPriority("display");
        oldLabel = current.getAttribute("aria-label");
        original = page.createDocumentFragment();
        original.append(...Array.from(current.childNodes));
        current.textContent = context.translate(
          message("loreloom.settings.title", "Settings"),
        );
        current.setAttribute("aria-label", current.textContent);
        current.dataset.loreloomSettingsEntry = "";
        unmount = context.theme.mount(current);
        current.addEventListener("click", click);
        if (image)
          current.style.setProperty(
            "--settings-button-image",
            `url(${JSON.stringify(image)})`,
          );
      }
    }
    if (current) {
      const desired = isActive() ? display : "none";
      const desiredPriority = isActive() ? priority : "important";
      if (
        current.style.getPropertyValue("display") !== desired ||
        current.style.getPropertyPriority("display") !== desiredPriority
      ) {
        if (desired)
          current.style.setProperty("display", desired, desiredPriority);
        else current.style.removeProperty("display");
      }
    }
  };
  const Observer = (
    context.host.window as unknown as {
      MutationObserver: typeof MutationObserver;
    }
  ).MutationObserver;
  const observer = new Observer(sync);
  context.lifecycle.observe(observer, page.body, {
    childList: true,
    subtree: true,
  });
  void context.theme
    .image("studio-settings.settings-button")
    .then((url) => {
      if (context.signal.aborted) return;
      image = url;
      if (url && current)
        current.style.setProperty(
          "--settings-button-image",
          `url(${JSON.stringify(url)})`,
        );
    })
    .catch(() => {});
  context.lifecycle.defer(() => {
    release();
    style.remove();
  });
  sync();
  return sync;
}
