-- 003_drop_unused_rbac_tables.sql
--
-- Why: the schema carried a roles / permissions / role_permissions trio that
-- nothing ever read or wrote. The real permission model is the role list every
-- IPC channel declares for itself (electron/ipc/*.js) and the guard that
-- enforces it (electron/ipc/guard.js) - a channel *is* a permission, and it
-- is checked in the main process on every single call.
--
-- An empty RBAC trio in the schema is worse than no RBAC tables at all: it
-- suggests a feature the application does not have, and invites somebody to
-- "configure" permissions that are never consulted. Removing it makes the
-- code and the database tell the same story.
--
-- The tables are empty, and role_permissions is dropped first so that no
-- foreign key is left pointing at a table that is about to disappear.
-- schema.sql no longer creates them for new installations; this migration
-- brings existing installations to the same shape.

DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
