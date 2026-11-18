export interface ResourceAction {
  value: string;
  label: string;
  disabled?: boolean;
}
export interface ResourceOption {
  value: string;
  label: string;
  available: boolean;
  description?: string;
  progress?: number;
  activity?: string;
  loading?: { label: string; progress?: number };
  actions?: ResourceAction[];
}
export interface ResourceState {
  options: ResourceOption[];
  message?: string;
  action?: ResourceAction;
  onOpen?: ResourceAction;
}
export type ResourceStates = Record<string, ResourceState>;

export function validateResources(
  value: unknown,
  fieldIds: readonly string[],
): ResourceStates {
  const record = (item: unknown): item is Record<string, unknown> =>
    !!item && typeof item === "object" && !Array.isArray(item);
  const text = (item: unknown, limit = 256): item is string =>
    typeof item === "string" && !!item.trim() && item.length <= limit;
  const action = (item: unknown) =>
    record(item) &&
    text(item.value) &&
    text(item.label) &&
    (item.disabled === undefined || typeof item.disabled === "boolean");
  const progress = (item: unknown) =>
    item === undefined ||
    (typeof item === "number" &&
      Number.isFinite(item) &&
      item >= 0 &&
      item <= 1);
  if (!record(value)) throw new Error("Invalid resource states.");
  for (const [id, state] of Object.entries(value)) {
    if (
      !fieldIds.includes(id) ||
      !record(state) ||
      !Array.isArray(state.options) ||
      state.options.length > 128 ||
      (state.message !== undefined && !text(state.message, 2048)) ||
      (state.action !== undefined && !action(state.action)) ||
      (state.onOpen !== undefined && !action(state.onOpen))
    )
      throw new Error("Invalid resource state.");
    const ids = new Set<string>();
    for (const option of state.options) {
      if (
        !record(option) ||
        !text(option.value, 128) ||
        ids.has(option.value) ||
        !text(option.label) ||
        typeof option.available !== "boolean" ||
        (option.description !== undefined && !text(option.description, 2048)) ||
        !progress(option.progress) ||
        (option.activity !== undefined && !text(option.activity)) ||
        (option.loading !== undefined &&
          (!record(option.loading) ||
            !text(option.loading.label) ||
            !progress(option.loading.progress))) ||
        (option.actions !== undefined &&
          (!Array.isArray(option.actions) ||
            option.actions.length > 3 ||
            !option.actions.every(action)))
      )
        throw new Error("Invalid resource option.");
      ids.add(option.value);
    }
  }
  return structuredClone(value) as ResourceStates;
}
