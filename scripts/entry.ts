import {
  bootstrap,
  type RuntimeHandle,
  type RuntimeOptions,
} from "./runtime/bootstrap.ts";
export function startScripts(options: RuntimeOptions): Promise<RuntimeHandle> {
  return bootstrap(options);
}
