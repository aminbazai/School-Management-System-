-- Add the standard Pakistani school class ladder (Play Group .. Class 10)
-- to databases that were seeded before this migration. Idempotent.

INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Play Group', 'PLAYGROUP', 1);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Nursery', 'NURSERY', 2);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('KG', 'KG', 3);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Class 1', 'CLASS1', 4);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Class 2', 'CLASS2', 5);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Class 3', 'CLASS3', 6);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Class 4', 'CLASS4', 7);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Class 5', 'CLASS5', 8);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Class 6', 'CLASS6', 9);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Class 7', 'CLASS7', 10);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Class 8', 'CLASS8', 11);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Class 9', 'CLASS9', 12);
INSERT OR IGNORE INTO classes (name, code, level_order) VALUES ('Class 10', 'CLASS10', 13);

-- Ensure sections A and B exist for every class.
INSERT OR IGNORE INTO sections (class_id, name, capacity, room_no)
  SELECT id, 'A', 30, 'A' FROM classes WHERE is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM sections s WHERE s.class_id = classes.id AND s.name = 'A' AND s.is_deleted = 0);
INSERT OR IGNORE INTO sections (class_id, name, capacity, room_no)
  SELECT id, 'B', 30, 'B' FROM classes WHERE is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM sections s WHERE s.class_id = classes.id AND s.name = 'B' AND s.is_deleted = 0);