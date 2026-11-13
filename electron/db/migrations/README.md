# Database migrations

`electron/db/schema.sql` is the canonical schema and is applied once, on an empty database.

Every later schema change goes in this folder as `NNN_short_description.sql`:

* `NNN` is the version number and is what matters — files are applied in ascending order.
* The runner (`electron/db/connection.js`) applies each file whose number is greater than the
  highest version in `schema_version`, inside a transaction, and records the version afterwards.
* Keep migrations additive and idempotent where possible (`ADD COLUMN`, `CREATE TABLE IF NOT EXISTS`)
  so that restoring an older backup still applies everything missing.
* Never edit an already released migration - add a new one instead.

Example:

```sql
-- 002_add_student_photo.sql
ALTER TABLE students ADD COLUMN photo_size INTEGER;
CREATE INDEX IF NOT EXISTS idx_students_photo ON students(photo_path);
```

## Rebuilding a table

SQLite cannot drop or add a table level `UNIQUE` constraint, so replacing one
(usually with a partial unique index, for example to make it soft-delete aware)
means rebuilding the table. Follow the procedure in
<https://sqlite.org/lang_altertable.html>: create the new table under a
temporary name, copy the rows, drop the old table, rename the new one into
place. Never rename the *old* table out of the way - that rewrites the foreign
keys of every child table to point at the temporary name.

Such a migration must open with:

```sql
-- @no-foreign-keys
```

Dropping a table runs an implicit `DELETE FROM`, which foreign keys reject when
child rows exist, and `PRAGMA foreign_keys` is a no-op inside a transaction.
The runner therefore toggles the pragma around the whole migration for files
carrying that marker, and refuses to record the migration unless
`PRAGMA foreign_key_check` comes back clean.

The autoincrement watermark lives in `sqlite_sequence` and does not survive a
rebuild on its own. Carry it across before dropping the old table, otherwise ids
can be handed out twice:

```sql
UPDATE sqlite_sequence SET seq = MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'x'), 0),
                                     (SELECT COALESCE(MAX(id), 0) FROM x_v2))
 WHERE name = 'x_v2';
DELETE FROM sqlite_sequence WHERE name = 'x';
DROP TABLE x;
ALTER TABLE x_v2 RENAME TO x;
```