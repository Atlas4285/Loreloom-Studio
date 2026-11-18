import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type { Message } from "../../../../../shared/i18n/message.ts";
export interface SelectView {
  element: HTMLElement;
  set(value: string): void;
  close(): boolean;
  dispose(): void;
}
export function createSelect(
  context: ModuleContext,
  dialog: HTMLDialogElement,
  id: string,
  label: string,
  options: { value: string; label: Message }[],
  value: string,
  change: (value: string) => void,
): SelectView {
  const page = context.host.document;
  const element = page.createElement("div");
  element.className = "loreloom-settings__select";
  const trigger = page.createElement("button");
  trigger.type = "button";
  trigger.className = "loreloom-settings__select-trigger";
  trigger.id = id;
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const popup = page.createElement("div");
  popup.className = "loreloom-settings__options";
  popup.id = `${id}-options`;
  popup.setAttribute("role", "listbox");
  popup.setAttribute("aria-label", label);
  popup.setAttribute("popover", "manual");
  popup.hidden = true;
  trigger.setAttribute("aria-controls", popup.id);
  let opened = false;
  let selected = value;
  const buttons = options.map((option) => {
    const button = page.createElement("button");
    button.type = "button";
    button.className = "loreloom-settings__option";
    button.setAttribute("role", "option");
    button.textContent = option.label.text;
    button.tabIndex = -1;
    button.addEventListener("click", () => {
      const changed = selected !== option.value;
      set(option.value);
      close();
      trigger.focus();
      if (changed) change(option.value);
    });
    popup.append(button);
    return button;
  });
  function set(next: string): void {
    selected = next;
    trigger.textContent =
      options.find((option) => option.value === next)?.label.text ?? next;
    buttons.forEach((button, index) =>
      button.setAttribute(
        "aria-selected",
        String(options[index]?.value === next),
      ),
    );
  }
  function close(): boolean {
    if (!opened) return false;
    opened = false;
    trigger.setAttribute("aria-expanded", "false");
    if (popup.matches(":popover-open")) popup.hidePopover();
    popup.hidden = true;
    page.removeEventListener("pointerdown", outside, true);
    dialog.removeEventListener("scroll", scroll, true);
    context.host.window.removeEventListener("resize", scroll);
    return true;
  }
  function outside(event: Event): void {
    if (!event.composedPath().includes(element)) close();
  }
  function scroll(event: Event): void {
    if (event.composedPath().includes(popup)) return;
    close();
  }
  function open(last = false): void {
    if (opened) {
      close();
      return;
    }
    dialog.dispatchEvent(new Event("loreloom-select-open"));
    opened = true;
    popup.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (typeof popup.showPopover === "function") popup.showPopover();
    const rect = trigger.getBoundingClientRect();
    const height = context.host.window.innerHeight;
    const below = height - rect.bottom - 12;
    const above = rect.top - 12;
    const upward = below < 180 && above > below;
    popup.style.width = `${Math.min(rect.width, context.host.window.innerWidth - 24)}px`;
    popup.style.left = `${Math.max(12, Math.min(rect.left, context.host.window.innerWidth - rect.width - 12))}px`;
    popup.style.maxHeight = `${Math.max(40, Math.min(280, upward ? above : below))}px`;
    popup.style.top = upward ? "auto" : `${rect.bottom + 6}px`;
    popup.style.bottom = upward ? `${height - rect.top + 6}px` : "auto";
    page.addEventListener("pointerdown", outside, true);
    dialog.addEventListener("scroll", scroll, true);
    context.host.window.addEventListener("resize", scroll);
    const index = options.findIndex((option) => option.value === selected);
    buttons[index < 0 ? (last ? buttons.length - 1 : 0) : index]?.focus();
  }
  trigger.addEventListener("click", () => open());
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open(event.key === "ArrowUp");
    }
  });
  popup.addEventListener("keydown", (event) => {
    const index = buttons.indexOf(page.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.focus();
    } else if (event.key === "Tab") {
      close();
      trigger.focus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[next]?.focus();
    }
  });
  const closeOther = () => {
    close();
  };
  dialog.addEventListener("loreloom-select-open", closeOther);
  element.append(trigger, popup);
  set(value);
  return {
    element,
    set,
    close,
    dispose: () => {
      close();
      dialog.removeEventListener("loreloom-select-open", closeOther);
    },
  };
}
