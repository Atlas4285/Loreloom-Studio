import type {
  ModuleContext,
  ModuleSettings,
} from "../../../../../shared/contracts/module.ts";
import type { ResourceOption } from "../../../../../shared/contracts/resources.ts";
import { fontMessages } from "../fonts/messages.ts";
import css from "./styles/font-status.css?raw";

export class FontStatus {
  private readonly element: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly popup: HTMLElement;
  private readonly name: HTMLElement;
  private readonly progress: HTMLProgressElement;
  private readonly scope: string;
  private unmount?: () => void;
  private opened = false;
  private selected = "default";
  private readonly rows = new Map<string, HTMLButtonElement>();

  constructor(
    private readonly context: ModuleContext,
    private readonly isActive: () => boolean,
    private readonly refresh: () => void,
    private readonly settings: ModuleSettings,
  ) {
    const page = context.host.document;
    this.scope = JSON.stringify(context.scope);
    const style = page.createElement("style");
    style.textContent = css;
    page.head.append(style);
    this.element = page.createElement("div");
    this.element.className = "loreloom-font-status";
    this.element.dataset.owner = context.instanceId;
    this.trigger = page.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "loreloom-font-status__trigger";
    this.trigger.setAttribute("aria-haspopup", "listbox");
    this.trigger.setAttribute("aria-expanded", "false");
    this.progress = page.createElement("progress");
    this.progress.className = "loreloom-font-status__progress";
    this.progress.max = 1;
    this.progress.hidden = true;
    this.progress.setAttribute("aria-hidden", "true");
    this.name = page.createElement("span");
    this.name.className = "loreloom-font-status__name";
    this.trigger.append(this.progress, this.name);
    this.popup = page.createElement("div");
    this.popup.id = `loreloom-font-options-${context.instanceId}`;
    this.popup.className = "loreloom-font-status__options";
    this.popup.setAttribute("role", "listbox");
    this.popup.setAttribute(
      "aria-label",
      context.translate(fontMessages.label),
    );
    this.popup.setAttribute("popover", "manual");
    this.popup.hidden = true;
    this.trigger.setAttribute("aria-controls", this.popup.id);
    this.element.append(this.trigger, this.popup);
    this.trigger.addEventListener("click", () => this.open());
    this.trigger.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      if (!this.opened) this.open(event.key === "ArrowUp");
      else this.focus(this.rows.get(this.selected));
    });
    this.popup.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        this.close();
        this.trigger.focus({ preventScroll: true });
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const buttons = [...this.popup.children] as HTMLButtonElement[];
        const index = buttons.indexOf(page.activeElement as HTMLButtonElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length;
        this.focus(buttons[next]);
      }
    });
    context.lifecycle.listen(page, "focusin", this.outside, { capture: true });

    const Observer = (
      context.host.window as unknown as {
        MutationObserver: typeof MutationObserver;
      }
    ).MutationObserver;
    const observer = new Observer((records) => {
      if (
        records.some(
          (record) =>
            record.type === "attributes" ||
            [...record.addedNodes, ...record.removedNodes].some(
              (node) =>
                node.nodeType === 1 &&
                ((node as Element).matches(
                  "#qr--bar, [data-loreloom-settings-entry]",
                ) ||
                  !!(node as Element).querySelector(
                    "#qr--bar, [data-loreloom-settings-entry]",
                  )),
            ),
        )
      )
        refresh();
    });
    context.lifecycle.observe(observer, page.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-loreloom-settings-entry"],
    });
    context.lifecycle.defer(() => {
      this.clear();
      style.remove();
    });
  }

  clear(): void {
    this.close();
    this.element.remove();
    this.unmount?.();
    this.unmount = undefined;
  }

  private current(): boolean {
    try {
      return (
        !this.context.signal.aborted &&
        this.isActive() &&
        JSON.stringify(this.context.host.scope()) === this.scope
      );
    } catch {
      return false;
    }
  }

  private syncOptions(
    options: readonly ResourceOption[],
    selected: string,
  ): void {
    this.selected = selected;
    const available = options.filter((option) => option.available);
    const ids = new Set(available.map((option) => option.value));
    let removedFocus = false;
    for (const [id, button] of this.rows)
      if (!ids.has(id)) {
        removedFocus ||= this.context.host.document.activeElement === button;
        button.remove();
        this.rows.delete(id);
      }
    for (const [index, option] of available.entries()) {
      let button = this.rows.get(option.value);
      if (!button) {
        button = this.context.host.document.createElement("button");
        button.type = "button";
        button.className = "loreloom-font-status__option";
        button.dataset.fontId = option.value;
        button.setAttribute("role", "option");
        button.tabIndex = -1;
        button.addEventListener("click", () => {
          this.close();
          if (!this.current()) return;
          this.trigger.focus({ preventScroll: true });
          try {
            const snapshot = this.settings.read();
            if (
              snapshot.values.fontId !== option.value &&
              snapshot.resources?.fontId?.options.some(
                (font) => font.value === option.value && font.available,
              )
            )
              this.settings.update(
                { ...snapshot.values, fontId: option.value },
                snapshot.revision,
              );
          } catch (error) {
            console.error("Could not change the font.", error);
          }
          this.refresh();
        });
        this.rows.set(option.value, button);
      }
      if (button.textContent !== option.label)
        button.textContent = option.label;
      button.setAttribute("aria-selected", String(option.value === selected));
      button.title = option.label;
      if (this.popup.children[index] !== button)
        this.popup.insertBefore(button, this.popup.children[index] ?? null);
    }
    if (this.opened && removedFocus) this.focus(this.rows.get(selected));
  }

  private focus(button: HTMLButtonElement | undefined): void {
    if (!button) return;
    button.focus({ preventScroll: true });
    const bounds = button.getBoundingClientRect();
    const viewport = this.popup.getBoundingClientRect();
    if (bounds.top < viewport.top)
      this.popup.scrollTop -= viewport.top - bounds.top;
    else if (bounds.bottom > viewport.bottom)
      this.popup.scrollTop += bounds.bottom - viewport.bottom;
  }

  private readonly outside = (event: Event): void => {
    if (this.opened && !event.composedPath().includes(this.element))
      this.close();
  };

  private readonly place = (event?: Event): void => {
    if (!this.opened || event?.composedPath().includes(this.popup)) return;
    const { window: browser, document: page } = this.context.host;
    const rect = this.trigger.getBoundingClientRect();
    const width = Math.min(
      Math.max(220, rect.width),
      page.documentElement.clientWidth - 16,
    );
    this.popup.style.width = `${width}px`;
    this.popup.style.left = `${Math.max(8, Math.min(rect.left, page.documentElement.clientWidth - width - 8))}px`;
    this.popup.style.bottom = `${browser.innerHeight - rect.top + 6}px`;
    this.popup.style.maxHeight = `${Math.max(0, Math.min(280, rect.top - 14))}px`;
  };

  private open(last = false): void {
    if (this.opened) {
      this.close();
      return;
    }
    if (!this.current() || this.trigger.disabled) return;
    const snapshot = this.settings.read();
    this.syncOptions(
      snapshot.resources?.fontId?.options ?? [],
      String(snapshot.values.fontId),
    );
    this.opened = true;
    this.popup.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    if (typeof this.popup.showPopover === "function") this.popup.showPopover();
    this.place();
    const page = this.context.host.document;
    page.addEventListener("pointerdown", this.outside, true);
    page.addEventListener("scroll", this.place, true);
    this.context.host.window.addEventListener("resize", this.place);
    const buttons = [...this.popup.children] as HTMLButtonElement[];
    this.focus(
      this.rows.get(this.selected) ?? (last ? buttons.at(-1) : buttons[0]),
    );
  }

  private close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.trigger.setAttribute("aria-expanded", "false");
    if (this.popup.matches(":popover-open")) this.popup.hidePopover();
    this.popup.hidden = true;
    const page = this.context.host.document;
    page.removeEventListener("pointerdown", this.outside, true);
    page.removeEventListener("scroll", this.place, true);
    this.context.host.window.removeEventListener("resize", this.place);
  }

  render(
    selected: string,
    options: readonly ResourceOption[],
    enabled: boolean,
  ): void {
    const { context } = this;
    const bar = context.host.document.querySelector<HTMLElement>("#qr--bar");
    if (!bar || !this.current()) {
      this.clear();
      return;
    }
    const font = options.find((option) => option.value === selected);
    const label = font?.label ?? context.translate(fontMessages.default);
    const name = `${context.translate(fontMessages.label)}: ${label}`;
    if (this.name.textContent !== name) this.name.textContent = name;
    const loading = font?.loading;
    this.progress.hidden = !loading;
    if (loading?.progress === undefined) this.progress.removeAttribute("value");
    else this.progress.value = loading.progress;
    this.trigger.setAttribute("aria-busy", String(!!loading));
    this.trigger.title = name;
    this.trigger.disabled = !enabled;
    this.syncOptions(options, selected);
    if (!enabled) this.close();

    this.unmount ??= context.theme.mount(this.element);
    let anchor = bar.querySelector<HTMLElement>(
      "[data-loreloom-settings-entry]",
    );
    while (anchor?.parentElement && anchor.parentElement !== bar)
      anchor = anchor.parentElement;
    if (anchor) {
      if (anchor.nextElementSibling !== this.element)
        anchor.insertAdjacentElement("afterend", this.element);
    } else if (this.element.parentElement !== bar) bar.append(this.element);
    this.place();
  }
}
