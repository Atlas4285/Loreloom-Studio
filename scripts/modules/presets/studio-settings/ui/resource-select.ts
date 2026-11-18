import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import type {
  ResourceState,
  ResourceOption,
} from "../../../../../shared/contracts/resources.ts";
import type { SelectView } from "./select.ts";

interface Row {
  element: HTMLElement;
  choose: HTMLButtonElement;
  name: HTMLElement;
  description: HTMLElement;
  actions: HTMLButtonElement[];
  actionLabels: HTMLElement[];
  progress: HTMLProgressElement;
  option: ResourceOption;
}
export interface ResourceSelectView extends SelectView {
  sync(value: string, state: ResourceState): void;
}
export function createResourceSelect(
  context: ModuleContext,
  dialog: HTMLDialogElement,
  id: string,
  label: string,
  change: (value: string) => void,
  action: (value: string) => void,
): ResourceSelectView {
  const page = context.host.document;
  const element = page.createElement("div");
  element.className =
    "loreloom-settings__select loreloom-settings__resource-select";
  const trigger = page.createElement("button");
  trigger.type = "button";
  trigger.id = id;
  trigger.className = "loreloom-settings__select-trigger";
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  const triggerLabel = page.createElement("span");
  triggerLabel.className = "loreloom-settings__resource-label";
  const triggerStatus = page.createElement("span");
  triggerStatus.className = "loreloom-settings__resource-loading";
  triggerStatus.setAttribute("role", "status");
  function progress(): HTMLProgressElement {
    const bar = page.createElement("progress");
    bar.max = 1;
    bar.hidden = true;
    bar.className = "loreloom-settings__resource-progress";
    return bar;
  }
  function syncProgress(
    bar: HTMLProgressElement,
    status: { label: string; progress?: number } | undefined,
  ): void {
    bar.hidden = !status;
    if (status?.progress === undefined) bar.removeAttribute("value");
    else bar.value = status.progress;
    bar.setAttribute("aria-label", status?.label ?? label);
  }
  const triggerProgress = progress();
  trigger.append(triggerProgress, triggerLabel, triggerStatus);
  const popup = page.createElement("div");
  popup.id = `${id}-resources`;
  popup.className = "loreloom-settings__options loreloom-settings__resources";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", label);
  popup.hidden = true;
  trigger.setAttribute("aria-controls", popup.id);
  const status = page.createElement("p");
  status.className = "loreloom-settings__resource-status";
  status.setAttribute("role", "status");
  const footer = page.createElement("button");
  footer.type = "button";
  footer.className = "loreloom-settings__action";
  footer.hidden = true;
  popup.append(status, footer);
  element.append(trigger, popup);
  let opened = false;
  let openRequested = false;
  let focusCheck: number | undefined;
  let selected = "";
  let state: ResourceState = { options: [] };
  const rows = new Map<string, Row>();
  const controls = () =>
    [...rows.values()]
      .flatMap((row) => [row.choose, ...row.actions])
      .concat(footer)
      .filter(
        (button) =>
          !button.disabled &&
          !button.hidden &&
          button.getAttribute("aria-disabled") !== "true",
      );
  function set(value: string): void {
    selected = value;
    const option =
      state.options.find((option) => option.value === value) ??
      state.options.find((option) => option.available);
    triggerLabel.textContent = option?.label ?? label;
    triggerStatus.textContent = option?.loading?.label ?? "";
    triggerStatus.hidden = !option?.loading;
    trigger.setAttribute("aria-busy", String(!!option?.loading));
    trigger.title = `${option?.label ?? label}${option?.loading ? ` · ${option.loading.label}` : ""}`;
    syncProgress(triggerProgress, option?.loading);
    for (const row of rows.values())
      row.choose.setAttribute(
        "aria-pressed",
        String(row.option.value === value && row.option.available),
      );
  }
  function sync(value: string, next: ResourceState): void {
    state = next;
    openRequested = false;
    const ids = new Set(next.options.map((option) => option.value));
    for (const [key, row] of rows)
      if (!ids.has(key)) {
        row.element.remove();
        rows.delete(key);
      }
    for (const [index, option] of next.options.entries()) {
      let row = rows.get(option.value);
      if (!row) {
        const container = page.createElement("div");
        container.className = "loreloom-settings__resource-row";
        const choose = page.createElement("button");
        choose.type = "button";
        choose.className =
          "loreloom-settings__option loreloom-settings__resource-choice";
        const name = page.createElement("span");
        const description = page.createElement("small");
        choose.append(name, description);
        const actions = page.createElement("div");
        actions.className = "loreloom-settings__resource-actions";
        const actionLabels: HTMLElement[] = [];
        const buttons = Array.from({ length: 3 }, () => {
          const button = page.createElement("button");
          button.type = "button";
          button.className =
            "loreloom-settings__action loreloom-settings__resource-action";
          const label = page.createElement("span");
          label.className = "loreloom-settings__resource-action-label";
          button.append(label);
          actionLabels.push(label);
          actions.append(button);
          return button;
        });
        const bar = progress();
        buttons[0]!.prepend(bar);
        container.append(choose, actions);
        row = {
          element: container,
          choose,
          name,
          description,
          actions: buttons,
          actionLabels,
          progress: bar,
          option,
        };
        const current = row;
        choose.addEventListener("click", () => {
          if (!current.option.available) return;
          const changed = selected !== current.option.value;
          set(current.option.value);
          close();
          trigger.focus({ preventScroll: true });
          if (changed) change(current.option.value);
        });
        buttons.forEach((button, index) =>
          button.addEventListener("click", () => {
            const command = current.option.actions?.[index];
            if (!command || command.disabled) return;
            button.focus({ preventScroll: true });
            action(command.value);
          }),
        );
        rows.set(option.value, row);
      }
      row.option = option;
      row.name.textContent = option.label;
      row.description.textContent = option.description ?? "";
      row.description.hidden = !option.description;
      row.choose.setAttribute("aria-busy", String(!!option.loading));
      row.choose.title = `${option.label}${option.description ? ` · ${option.description}` : ""}`;
      row.choose.disabled = !option.available;
      row.actions.forEach((button, index) => {
        const command = option.actions?.[index];
        button.hidden = !command;
        button.setAttribute(
          "aria-disabled",
          String(command?.disabled ?? false),
        );
        row.actionLabels[index]!.textContent = command?.label ?? "";
        button.setAttribute(
          "aria-label",
          `${command?.label ?? ""} ${option.label}`.trim(),
        );
        if (opened && !command && page.activeElement === button)
          row.choose.focus({ preventScroll: true });
      });
      syncProgress(
        row.progress,
        option.activity || option.progress !== undefined
          ? {
              label: option.activity ?? option.label,
              progress: option.progress,
            }
          : option.loading,
      );
      if (popup.children[index] !== row.element)
        popup.insertBefore(row.element, popup.children[index] ?? status);
    }
    status.textContent = next.message ?? "";
    status.hidden = !next.message;
    footer.textContent = next.action?.label ?? "";
    footer.hidden = !next.action;
    footer.setAttribute(
      "aria-disabled",
      String(next.action?.disabled ?? false),
    );
    set(value);
  }
  footer.addEventListener("click", () => {
    if (!state.action || state.action.disabled) return;
    action(state.action.value);
  });
  function close(): boolean {
    if (!opened) return false;
    context.host.window.clearTimeout(focusCheck);
    focusCheck = undefined;
    opened = false;
    trigger.setAttribute("aria-expanded", "false");
    popup.hidden = true;
    page.removeEventListener("click", outside, true);
    context.host.window.removeEventListener("resize", place);
    return true;
  }
  function outside(event: Event): void {
    if (!event.composedPath().includes(element)) close();
  }
  function focus(button: HTMLButtonElement | undefined): void {
    if (!button) return;
    button.focus({ preventScroll: true });
    const bounds = button.getBoundingClientRect();
    const viewport = popup.getBoundingClientRect();
    if (bounds.top < viewport.top) popup.scrollTop -= viewport.top - bounds.top;
    else if (bounds.bottom > viewport.bottom)
      popup.scrollTop += bounds.bottom - viewport.bottom;
  }
  function place(): void {
    const container =
      element.closest<HTMLElement>(".loreloom-settings__content") ?? dialog;
    const bounds = container.getBoundingClientRect();
    const rect = trigger.getBoundingClientRect();
    const above = rect.top - Math.max(0, bounds.top) - 4;
    const below =
      Math.min(context.host.window.innerHeight, bounds.bottom) -
      rect.bottom -
      4;
    const upward = below < Math.min(240, popup.scrollHeight) && above > below;
    element.dataset.direction = upward ? "up" : "down";
    popup.style.maxHeight = `${Math.max(40, Math.min(240, upward ? above : below))}px`;
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
    // Absolute positioning within the control keeps it out of layout while
    // both parts share the same native scrolling. No scroll tracking is needed.
    place();
    context.host.window.addEventListener("resize", place);
    // A touch scroll starts with pointerdown outside the popup. Wait for an
    // actual click before dismissing, so scrolling the settings remains usable.
    page.addEventListener("click", outside, true);
    const available = controls();
    const chosen = rows.get(selected)?.choose;
    focus(
      chosen && !chosen.disabled
        ? chosen
        : last
          ? available.at(-1)
          : available[0],
    );
    if (state.onOpen && !state.onOpen.disabled && !openRequested) {
      openRequested = true;
      action(state.onOpen.value);
    }
  }
  trigger.addEventListener("click", () => open());
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    open(event.key === "ArrowUp");
  });
  popup.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.focus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const available = controls();
      const index = available.indexOf(page.activeElement as HTMLButtonElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? available.length - 1
            : (index +
                (event.key === "ArrowDown" ? 1 : -1) +
                available.length) %
              available.length;
      focus(available[next]);
    }
  });
  element.addEventListener("keydown", (event) => {
    if (!opened || event.key !== "Tab") return;
    context.host.window.clearTimeout(focusCheck);
    focusCheck = context.host.window.setTimeout(() => {
      focusCheck = undefined;
      if (opened && !element.contains(page.activeElement)) close();
    }, 0);
  });
  const closeOther = () => {
    close();
  };
  dialog.addEventListener("loreloom-select-open", closeOther);
  return {
    element,
    set,
    sync,
    close,
    dispose: () => {
      close();
      dialog.removeEventListener("loreloom-select-open", closeOther);
    },
  };
}
