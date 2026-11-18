import type { ModuleContext } from "../../../../../shared/contracts/module.ts";
import { createOwnership as ownService } from "../../../../runtime/module-ownership.ts";
export function createOwnership(context: ModuleContext) {
  return ownService(context, "next-actions");
}
