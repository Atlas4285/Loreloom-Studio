import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import { message } from "../../../../../shared/i18n/message.ts";
import type { SettingsGroups } from "../state/groups.ts";
import { createFields, type FieldsView } from "./fields.ts";
import panelCss from "./styles/panel.css?raw";
import controlsCss from "./styles/controls.css?raw";
import responsiveCss from "./styles/responsive.css?raw";
export class SettingsPanel {
  readonly dialog: HTMLDialogElement;
  private readonly nav: HTMLElement;
  private readonly content: HTMLElement;
  private readonly status: HTMLElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private fields?: FieldsView;
  private selected = "";
  private rendered = "";
  private previousFocus?: HTMLElement;
  constructor(
    private readonly context: ModuleContext,
    private readonly groups: SettingsGroups,
  ) {
    const page = context.host.document;
    this.dialog = page.createElement("dialog");
    this.dialog.className = "loreloom-settings";
    this.dialog.id = `loreloom-settings-${context.instanceId}`;
    this.dialog.setAttribute("aria-labelledby", `${this.dialog.id}-title`);
    const header = page.createElement("header");
    header.className = "loreloom-settings__header";
    const title = page.createElement("h2");
    title.id = `${this.dialog.id}-title`;
    title.className = "loreloom-settings__title";
    const iconFrame = page.createElement("span");
    iconFrame.className = "loreloom-settings__title-icon";
    iconFrame.setAttribute("aria-hidden", "true");
    const titleText = page.createElement("span");
    titleText.textContent = context.translate(
      message("loreloom.settings.title", "Settings"),
    );
    title.append(iconFrame, titleText);
    const close = page.createElement("button");
    close.type = "button";
    close.className = "loreloom-settings__close";
    close.textContent = "×";
    close.setAttribute(
      "aria-label",
      context.translate(message("loreloom.settings.close", "Close settings")),
    );
    close.addEventListener("click", () => this.close());
    const body = page.createElement("div");
    body.className = "loreloom-settings__body";
    this.nav = page.createElement("nav");
    this.nav.className = "loreloom-settings__nav";
    this.nav.setAttribute(
      "aria-label",
      context.translate(message("loreloom.settings.groups", "Settings groups")),
    );
    this.content = page.createElement("section");
    this.content.className = "loreloom-settings__content";
    this.status = page.createElement("p");
    this.status.className = "loreloom-settings__status";
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    header.append(title, close);
    body.append(this.nav, this.content);
    this.dialog.append(header, body);
    const style = page.createElement("style");
    const scope = `#${this.dialog.id}`;
    style.textContent = [panelCss, controlsCss, responsiveCss]
      .join("\n")
      .replace(
        /(^|\n)([ \t]*)(fieldset|legend|textarea)?(\.loreloom-settings(?:__[a-z-]+)?)/g,
        (
          _match: string,
          line: string,
          indent: string,
          tag: string | undefined,
          name: string,
        ) =>
          `${line}${indent}${scope}${name === ".loreloom-settings" ? "" : " "}${tag ?? ""}${name}`,
      );
    page.head.append(style);
    page.body.append(this.dialog);
    const unmount = context.theme.mount(this.dialog);
    this.dialog.addEventListener("cancel", (event) => {
      if (this.fields?.closeSelect()) event.preventDefault();
    });
    this.dialog.addEventListener("close", () => {
      this.fields?.closeSelect();
      if (this.previousFocus?.isConnected) this.previousFocus.focus();
    });
    let backdropPress = false;
    const onBackdrop = (event: MouseEvent) => {
      if (event.target !== this.dialog) return false;
      const rect = this.dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };
    this.dialog.addEventListener("pointerdown", (event) => {
      backdropPress = onBackdrop(event);
    });
    this.dialog.addEventListener("pointercancel", () => {
      backdropPress = false;
    });
    this.dialog.addEventListener("click", (event) => {
      // A popup disappearing between pointerdown and click can retarget the
      // click to the dialog. Only a press that began on the backdrop closes it.
      const dismiss = backdropPress && onBackdrop(event);
      backdropPress = false;
      if (dismiss) this.close();
    });
    const unsubscribe = groups.subscribe(() => this.sync());
    context.lifecycle.defer(() => {
      unsubscribe();
      this.fields?.dispose();
      this.close();
      unmount();
      this.dialog.remove();
      style.remove();
    });
    void context.theme
      .image("studio-settings.dialog")
      .then((url) => {
        if (url && !context.signal.aborted)
          this.dialog.style.setProperty(
            "--settings-dialog-image",
            `url(${JSON.stringify(url)})`,
          );
      })
      .catch(() => {});
    void context.theme
      .image("studio-settings.dialog-title")
      .then((url) => {
        if (!url || context.signal.aborted) return;
        const icon = page.createElement("img");
        icon.alt = "";
        icon.className = "loreloom-settings__title-icon-image";
        icon.src = url;
        iconFrame.append(icon);
      })
      .catch(() => {});
    this.sync();
  }
  open(): void {
    if (!this.groups.isActive() || this.dialog.open) return;
    this.previousFocus = this.context.host.document
      .activeElement as HTMLElement;
    this.sync();
    this.dialog.showModal();
    this.groups.refresh();
  }
  close(): void {
    this.fields?.closeSelect();
    if (this.dialog.open) this.dialog.close();
  }
  private sync(): void {
    if (!this.groups.isActive()) this.close();
    const states = this.groups.list();
    const keys = new Set(states.map((state) => state.key));
    for (const [key, button] of this.buttons)
      if (!keys.has(key)) {
        button.remove();
        this.buttons.delete(key);
      }
    if (!keys.has(this.selected)) this.selected = states[0]?.key ?? "";
    const navFocus = this.context.host.document
      .activeElement as HTMLElement | null;
    const navScroll = this.nav.scrollTop;
    const navLeft = this.nav.scrollLeft;
    states.forEach((state, index) => {
      let button = this.buttons.get(state.key);
      if (!button) {
        button = this.context.host.document.createElement("button");
        button.type = "button";
        button.className = "loreloom-settings__nav-button";
        button.addEventListener("click", () => {
          this.fields?.closeSelect();
          this.selected = state.key;
          this.sync();
        });
        this.buttons.set(state.key, button);
      }
      const title = state.group.title.text;
      if (button.textContent !== title) button.textContent = title;
      if (this.nav.children[index] !== button)
        this.nav.insertBefore(button, this.nav.children[index] ?? null);
      if (state.key === this.selected)
        button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (
      navFocus &&
      this.nav.contains(navFocus) &&
      this.context.host.document.activeElement !== navFocus
    )
      navFocus.focus({ preventScroll: true });
    this.nav.scrollTop = navScroll;
    this.nav.scrollLeft = navLeft;
    const state = states.find((item) => item.key === this.selected);
    const token = state?.key ?? "empty";
    if (token !== this.rendered) {
      this.fields?.dispose();
      this.fields = undefined;
      this.content.replaceChildren();
      this.content.scrollTop = 0;
      this.rendered = token;
      const heading = this.context.host.document.createElement("h3");
      heading.className = "loreloom-settings__section-title";
      heading.textContent = state
        ? state.group.title.text
        : this.context.translate(
            message("loreloom.settings.title", "Settings"),
          );
      this.content.append(heading);
      if (state) {
        this.fields = createFields(
          this.context,
          this.dialog,
          state.group.fields,
          state.group.snapshot.values,
          (id, value) => this.groups.update(state, { [id]: value }),
          (id, value) => this.groups.action(state, id, value),
          state.group.snapshot.resources,
        );
        this.content.append(this.fields.element);
      } else {
        const empty = this.context.host.document.createElement("p");
        empty.className = "loreloom-settings__empty";
        empty.textContent = this.context.translate(
          message(
            "loreloom.settings.empty",
            "No settings are available. Enable a compatible feature script to get started.",
          ),
        );
        this.content.append(empty);
      }
      this.content.append(this.status);
    }
    if (state && !state.pending)
      this.fields?.sync(
        state.group.snapshot.values,
        state.group.snapshot.resources,
      );
    const status = state?.pending
      ? this.context.translate(message("loreloom.settings.saving", "Saving…"))
      : state?.failed
        ? this.context.translate(
            state.reason === "conflict"
              ? message(
                  "loreloom.settings.conflict",
                  "Settings changed elsewhere. Reloaded the available values; review them before trying again.",
                )
              : state.reason === "timeout"
                ? message(
                    "loreloom.settings.timeout",
                    "The request timed out. Its outcome is unknown; reopen the panel to reload settings before retrying an action.",
                  )
                : message(
                    "loreloom.settings.saveFailed",
                    "Could not save or reload settings. Close and reopen the panel to retry loading the current values.",
                  ),
          )
        : "";
    if (this.status.textContent !== status) this.status.textContent = status;
    this.status.dataset.error = String(!!state?.failed);
    this.content.setAttribute("aria-busy", String(!!state?.pending));
  }
}
