import { eslintCompatPlugin } from "@oxlint/plugins";
import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";

/** Selective generic anti-slop rules adapted from the SCUtilities toolchain. */
export default eslintCompatPlugin({
  meta: { name: "anti-slop" },
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertionsRule,
    "no-widen-then-assert": noWidenThenAssertRule,
  },
});
