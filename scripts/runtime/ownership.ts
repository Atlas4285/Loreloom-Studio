import type { ServiceProvider } from "../../shared/contracts/services.ts";
export function selectProvider(
  providers: ServiceProvider[],
  service: string,
  protocol: number,
  scriptOrder: readonly string[] = [],
): ServiceProvider | undefined {
  return providers
    .filter(
      (provider) =>
        provider.service === service &&
        provider.protocol === protocol &&
        (service !== "settings-panel" || provider.target === "preset"),
    )
    .sort((left, right) => {
      const leftIndex = left.scriptId ? scriptOrder.indexOf(left.scriptId) : -1;
      const rightIndex = right.scriptId
        ? scriptOrder.indexOf(right.scriptId)
        : -1;
      const priority =
        (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
      if (priority) return priority;
      return left.instanceId < right.instanceId
        ? -1
        : left.instanceId > right.instanceId
          ? 1
          : right.generation - left.generation;
    })[0];
}
