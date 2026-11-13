-- 002_soft_delete_unique_indexes.sql
--
-- Why: classes.name, subjects.name and sections(class_id, name) were declared
-- UNIQUE at table level, while every service deliberately ignores soft-deleted
-- rows when it looks for duplicates ("WHERE name = ? AND is_deleted = 0").
-- Deleting a class and then adding a class with the same name therefore passed
-- the service check and then died on the database with
-- "UNIQUE constraint failed: classes.name", which the IPC guard reported to the
-- user as a generic SERVER_ERROR.
--
-- The fix: "unique" has to mean "unique among rows that are not deleted".
-- SQLite spells that as a partial unique index, but a partial index cannot
-- replace a table level UNIQUE constraint - the table has to be rebuilt.
-- schema.sql already ships this shape for new installations; this migration
-- brings existing installations to the same shape.
--
-- The rebuild follows the procedure in https://sqlite.org/lang_altertable.html
-- ("Making Other Kinds Of Table Schema Changes"):
--   1. build the new table under a temporary name,
--   2. copy the rows (ids included),
--   3. drop the old table,
--   4. rename the new table into place.
-- Renaming the new table into place is what keeps the foreign keys of the child
-- tables (sections, students, exams, fee_structures, timetable, ...) pointing
-- at the right parent: nothing ever referenced the temporary name.
--
-- Step 3 needs foreign keys switched off, because SQLite runs an implicit
-- DELETE FROM when a table is dropped. That pragma is a no-op inside a
-- transaction, which is why this file starts with the @no-foreign-keys marker
-- and the runner in db/connection.js honours it (and verifies the result with
-- PRAGMA foreign_key_check before letting the migration be recorded).

-- @no-foreign-keys

-- --- classes ---------------------------------------------------------------
CREATE TABLE classes_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT,
  level_order INTEGER NOT NULL DEFAULT 0,    -- Play Group .. Inter, for sorting/promotion
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO classes_v2 (id, name, code, level_order, is_active, created_at, updated_at, is_deleted)
  SELECT id, name, code, level_order, is_active, created_at, updated_at, is_deleted FROM classes;
-- keep ids from ever being handed out twice
UPDATE sqlite_sequence
   SET seq = MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'classes'), 0),
                 (SELECT COALESCE(MAX(id), 0) FROM classes_v2))
 WHERE name = 'classes_v2';
DELETE FROM sqlite_sequence WHERE name = 'classes';
DROP TABLE classes;
ALTER TABLE classes_v2 RENAME TO classes;
CREATE UNIQUE INDEX IF NOT EXISTS ux_classes_name ON classes(name) WHERE is_deleted = 0;

-- --- sections --------------------------------------------------------------
CREATE TABLE sections_v2 (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id          INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  capacity          INTEGER NOT NULL DEFAULT 30,
  class_teacher_id  INTEGER,
  room_no           TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted        INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sections_v2 (id, class_id, name, capacity, class_teacher_id, room_no, is_active, created_at, updated_at, is_deleted)
  SELECT id, class_id, name, capacity, class_teacher_id, room_no, is_active, created_at, updated_at, is_deleted FROM sections;
UPDATE sqlite_sequence
   SET seq = MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'sections'), 0),
                 (SELECT COALESCE(MAX(id), 0) FROM sections_v2))
 WHERE name = 'sections_v2';
DELETE FROM sqlite_sequence WHERE name = 'sections';
DROP TABLE sections;
ALTER TABLE sections_v2 RENAME TO sections;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sections_class_name ON sections(class_id, name) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_sections_class ON sections(class_id, is_deleted);

-- --- subjects --------------------------------------------------------------
CREATE TABLE subjects_v2 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted  INTEGER NOT NULL DEFAULT 0
);
INSERT INTO subjects_v2 (id, name, code, is_active, created_at, is_deleted)
  SELECT id, name, code, is_active, created_at, is_deleted FROM subjects;
UPDATE sqlite_sequence
   SET seq = MAX(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'subjects'), 0),
                 (SELECT COALESCE(MAX(id), 0) FROM subjects_v2))
 WHERE name = 'subjects_v2';
DELETE FROM sqlite_sequence WHERE name = 'subjects';
DROP TABLE subjects;
ALTER TABLE subjects_v2 RENAME TO subjects;
CREATE UNIQUE INDEX IF NOT EXISTS ux_subjects_name ON subjects(name) WHERE is_deleted = 0;