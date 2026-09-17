---
name: sqlite-migration-guard
description: "Use ONLY when a change adds or edits database migration files (migrations/ dirs, *.sql schema changes, sqlx/rusqlite/diesel migrations). Runs a deterministic validator for destructive operations, then enforces review gates. Examples: \"add a migration\", \"review this migration\", \"change the schema\""
---

# SQLite Migration Guard

## When to Use

- New or edited `*.sql` migration / `migrations/` directory changes
- Any schema edit (tables, columns, indexes, constraints)

## Workflow (black box first)

1. Run the validator with `--help` first, then against the changed files. Treat it as a black box — run it, do not read its source:
   ```
   python3 skills/sqlite-migration-guard/scripts/validate_migration.py <migration files...>
   ```
   (Paths are relative to `~/.config/opencode`; from another repo, use the absolute path.)
2. **PASS** → continue to normal review: run `impact` on the touched tables/columns to find affected queries and code paths.
3. **FAIL** → fix the flagged statements or provide a backup/rename strategy in the same change. Never merge a FAIL without explicit user override.
4. **Reversibility gate:** every migration needs a down path (sibling `*.down.sql` or an in-file `-- migrate:down` section) or a documented forward-only reason.

## MonArtha notes

- **Signed-amount invariant** (expenses negative, income positive): any migration touching amount columns must preserve sign semantics — dropping a `CHECK` constraint on an amount column is a FAIL.
- Python read paths and their Rust fallbacks must be updated in the same change (repo convention).

## Example

```
$ python3 skills/sqlite-migration-guard/scripts/validate_migration.py migrations/0012_add_category.sql
PASS: 1 file, 0 errors, 1 warning (CREATE TABLE without explicit PRIMARY KEY → confirm intended)
```
