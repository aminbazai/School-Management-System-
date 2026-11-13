-- Normalise level_order for the standard class ladder on databases upgraded earlier.
UPDATE classes SET level_order = 1  WHERE name = 'Play Group' AND is_deleted = 0;
UPDATE classes SET level_order = 2  WHERE name = 'Nursery' AND is_deleted = 0;
UPDATE classes SET level_order = 3  WHERE name = 'KG' AND is_deleted = 0;
UPDATE classes SET level_order = 4  WHERE name = 'Class 1' AND is_deleted = 0;
UPDATE classes SET level_order = 5  WHERE name = 'Class 2' AND is_deleted = 0;
UPDATE classes SET level_order = 6  WHERE name = 'Class 3' AND is_deleted = 0;
UPDATE classes SET level_order = 7  WHERE name = 'Class 4' AND is_deleted = 0;
UPDATE classes SET level_order = 8  WHERE name = 'Class 5' AND is_deleted = 0;
UPDATE classes SET level_order = 9  WHERE name = 'Class 6' AND is_deleted = 0;
UPDATE classes SET level_order = 10 WHERE name = 'Class 7' AND is_deleted = 0;
UPDATE classes SET level_order = 11 WHERE name = 'Class 8' AND is_deleted = 0;
UPDATE classes SET level_order = 12 WHERE name = 'Class 9' AND is_deleted = 0;
UPDATE classes SET level_order = 13 WHERE name = 'Class 10' AND is_deleted = 0;