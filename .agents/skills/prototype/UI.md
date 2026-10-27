# GoodTaste UI prototypes

Use this when competing layout choices matter more than fine styling.

1. Write the decision question and success criterion (e.g. 'Can a traveller compare two dishes and see ingredient uncertainty without opening detail pages?').
2. Build **2–3 structurally different** variants. Do not merely change palette or text. Examples: image-led browse, guided discovery, compact evidence-first comparison.
3. Use the same synthetic fixture set for each variant, including a long bilingual name, missing price, unknown ingredient, and loading/error state. A comparison using different content is misleading.
4. Keep each variant independently editable. Shared basic tokens are fine; a shared layout that forces the same structure on every variant is not.
5. For an existing TanStack route, expose a dev-only `?variant=A|B|C` switcher. Make URLs shareable. Keyboard switching must not steal arrow keys from focused inputs. Do not ship the switcher.
6. Capture screenshots for mobile and desktop; ask the human to compare task completion, comprehension, and visual quality, not which color they prefer.
7. Document the chosen elements and delete the discarded prototype variants before merge. Productionize the winner with validation, a11y, testing and real data contracts.

Do not wire destructive actions, live recommendations, real uploads, or external keys to this prototype.
