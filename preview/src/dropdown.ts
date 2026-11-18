export type DropdownKind = "theme" | "locale";

export function bindDropdowns(
  root: HTMLElement,
  onSelect: (kind: DropdownKind, value: string) => void,
): () => void {
  let search = "";
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const openMenu = () =>
    root.querySelector<HTMLElement>('.dropdown[data-open="true"]');
  const options = (menu: HTMLElement) =>
    Array.from(menu.querySelectorAll<HTMLElement>('[role="option"]'));

  function close(): void {
    const menu = openMenu();
    if (!menu) return;
    menu.dataset.open = "false";
    const trigger = menu.querySelector<HTMLButtonElement>('[role="combobox"]');
    trigger?.setAttribute("aria-expanded", "false");
    trigger?.removeAttribute("aria-activedescendant");
    menu.querySelector<HTMLElement>('[role="listbox"]')!.hidden = true;
    search = "";
    clearTimeout(searchTimer);
  }

  function highlight(menu: HTMLElement, index: number, reveal = true): void {
    const items = options(menu);
    const active = items[(index + items.length) % items.length];
    if (!active) return;
    items.forEach((item) => {
      item.dataset.highlighted = String(item === active);
    });
    menu
      .querySelector('[role="combobox"]')
      ?.setAttribute("aria-activedescendant", active.id);
    if (reveal) active.scrollIntoView({ block: "nearest" });
  }

  function open(menu: HTMLElement, index?: number): void {
    close();
    menu.dataset.open = "true";
    menu
      .querySelector('[role="combobox"]')
      ?.setAttribute("aria-expanded", "true");
    menu.querySelector<HTMLElement>('[role="listbox"]')!.hidden = false;
    const items = options(menu);
    highlight(
      menu,
      index ??
        Math.max(
          0,
          items.findIndex(
            (item) => item.getAttribute("aria-selected") === "true",
          ),
        ),
    );
  }

  function choose(menu: HTMLElement, item: HTMLElement): void {
    const kind = menu.dataset.dropdown as DropdownKind;
    const value = item.dataset.dropdownValue;
    const triggerId = menu.querySelector('[role="combobox"]')?.id;
    close();
    if (value) onSelect(kind, value);
    if (triggerId)
      document.getElementById(triggerId)?.focus({ preventScroll: true });
  }

  function handleClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const menu = event.target.closest<HTMLElement>("[data-dropdown]");
    if (!menu || !root.contains(menu)) return;
    const option = event.target.closest<HTMLElement>('[role="option"]');
    if (option) choose(menu, option);
    else if (event.target.closest('[role="combobox"]')) {
      if (menu.dataset.open === "true") close();
      else open(menu);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!(event.target instanceof Element)) return;
    const menu = event.target.closest<HTMLElement>("[data-dropdown]");
    if (!menu) return;
    const items = options(menu);
    const expanded = menu.dataset.open === "true";
    const index = Math.max(
      0,
      items.findIndex((item) => item.dataset.highlighted === "true"),
    );
    if (event.key === "Tab") {
      close();
      return;
    }
    if (event.key === "Escape") {
      if (expanded) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      return;
    }
    if (
      ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)
    ) {
      event.preventDefault();
      if (event.key === "Enter" || event.key === " ") {
        if (expanded && items[index]) choose(menu, items[index]);
        else open(menu);
      } else if (event.key === "Home" || event.key === "End") {
        if (!expanded) open(menu);
        highlight(menu, event.key === "Home" ? 0 : items.length - 1);
      } else if (!expanded) {
        open(menu);
      } else {
        highlight(menu, index + (event.key === "ArrowDown" ? 1 : -1));
      }
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (!expanded) open(menu);
      search += event.key.toLocaleLowerCase();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        search = "";
      }, 650);
      const match = items.findIndex((item) =>
        item.dataset.label?.toLocaleLowerCase().startsWith(search),
      );
      if (match >= 0) highlight(menu, match);
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!(event.target instanceof Element)) return;
    const item = event.target.closest<HTMLElement>('[role="option"]');
    const menu = item?.closest<HTMLElement>("[data-dropdown]");
    if (item && menu?.dataset.open === "true") {
      highlight(menu, options(menu).indexOf(item), false);
    }
  }

  function handleOutside(event: PointerEvent): void {
    const menu = openMenu();
    if (menu && event.target instanceof Node && !menu.contains(event.target))
      close();
  }

  root.addEventListener("click", handleClick);
  root.addEventListener("keydown", handleKeydown);
  root.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerdown", handleOutside);
  return () => {
    close();
    root.removeEventListener("click", handleClick);
    root.removeEventListener("keydown", handleKeydown);
    root.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerdown", handleOutside);
    clearTimeout(searchTimer);
  };
}
