# Conceptual data ownership (not a final SQL schema)

This file states ownership for the scaffold. It does **not** authorize inventing physical tables, keys or migrations.

- `user`: member accounts, profile, saved items and preferences. Guests do not automatically correspond to stored member rows.
- `food-discovery`: dish identity, cuisines, ingredients, food descriptions, evidence/uncertainty about food attributes.
- `restaurant-discovery`: restaurant identity, location, menus and evidence that a venue serves a dish. A serving association references a stable dish identity but belongs to Restaurant Discovery.
- Binary menu photos belong in object storage; Postgres owns metadata and permission/retention information. AI-derived results are not assumed verified.

**Dish identity != restaurant menu offering.** Serving claims retain source, observation time and confidence/evidence semantics. User-owned fields always require actor-based ownership checks.

Postgres constraints enforce relational integrity, Reylo types the SQL interface, Zod 4.6 validates HTTP input, and Effect operations enforce application rules.

Before committing migrations, coordinate all affected module owners and update this file and `contracts.md` to reflect chosen relationships.
