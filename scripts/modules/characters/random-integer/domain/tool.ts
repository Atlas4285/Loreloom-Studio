import { message } from "../../../../../shared/i18n/message.ts";
import { MAX_COUNT } from "./random.ts";

export const TOOL_NAME = "random_integer";
export const DEFAULT_DESCRIPTION = message(
  "loreloom.randomInteger.toolDescription",
  "Generate an array of random integers within the specified closed interval [minimum, maximum].\n\n- Count defaults to 1.\n- Allowing duplicates defaults to true; when false, integers in this array are unique.\n- When duplicates are not allowed, count must not exceed the number of integers in the interval.",
);
export const parameters = {
  type: "object",
  properties: {
    lower: {
      type: "integer",
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
      description: "Inclusive lower bound.",
    },
    upper: {
      type: "integer",
      minimum: Number.MIN_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
      description: "Inclusive upper bound.",
    },
    count: {
      type: "integer",
      minimum: 1,
      maximum: MAX_COUNT,
      default: 1,
      description: "Number of integers. Defaults to 1.",
    },
    replacement: {
      type: "boolean",
      default: true,
      description:
        "True allows duplicates; false draws without replacement within this call. Defaults to true.",
    },
  },
  required: ["lower", "upper"],
  additionalProperties: false,
};
