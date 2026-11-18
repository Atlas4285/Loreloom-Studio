import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import { title } from "../settings/index.ts";

export interface PanelImages {
  background: Promise<string | undefined>;
  marker: Promise<string | undefined>;
}

function applyImage(
  panel: HTMLElement,
  image: Promise<string | undefined>,
  property: string,
  isCurrent: () => boolean,
  marker = false,
): void {
  void image.then((url) => {
    if (!url || !panel.isConnected || !isCurrent()) return;
    panel.style.setProperty(property, `url(${JSON.stringify(url)})`);
    if (marker) panel.dataset.hasMarker = "true";
  });
}

export function createPanel(
  context: ModuleContext,
  actions: string[],
  images: PanelImages,
  isCurrent: () => boolean,
  activate: (event: Event) => void,
): { panel: HTMLElement; unmount: () => void } {
  const page = context.host.document;
  const panel = page.createElement("div");
  panel.className = "loreloom-next-actions";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", context.translate(title));
  panel.dataset.owner = context.instanceId;
  const heading = page.createElement("div");
  heading.className = "loreloom-next-actions__heading";
  const caption = page.createElement("span");
  caption.className = "loreloom-next-actions__title";
  caption.textContent = context.translate(title);
  heading.append(caption);
  panel.append(heading);
  for (const [index, action] of actions.entries()) {
    // Text rows retain selection on browsers that suppress selection in buttons.
    const row = page.createElement("div");
    row.className = "loreloom-next-actions__button";
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.dataset.actionIndex = String(index);
    row.style.setProperty(
      "--action-accent",
      `var(--theme-accent-${["primary", "secondary", "tertiary"][index % 3]})`,
    );
    const label = page.createElement("span");
    label.className = "loreloom-next-actions__label";
    label.textContent = action;
    row.append(label);
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (event) => {
      if (
        event.target !== row ||
        event.repeat ||
        (event.key !== "Enter" && event.key !== " ")
      )
        return;
      if (row.dataset.available !== "true") return;
      event.preventDefault();
      activate(event);
    });
    panel.append(row);
  }
  panel.dataset.hasMarker = "false";
  applyImage(panel, images.background, "--next-actions-panel-image", isCurrent);
  applyImage(
    panel,
    images.marker,
    "--next-actions-marker-image",
    isCurrent,
    true,
  );
  return { panel, unmount: context.theme.mount(panel) };
}

export function setAvailability(row: HTMLElement, available: boolean): void {
  if (row.dataset.available !== String(available))
    row.dataset.available = String(available);
  row.setAttribute("aria-disabled", String(!available));
  row.classList.toggle("loreloom-next-actions__button--inactive", !available);
  row.tabIndex = available ? 0 : -1;
  // Inactive actions remain selectable and must never become native disabled controls.
  row.removeAttribute("disabled");
  row.removeAttribute("inert");
}
