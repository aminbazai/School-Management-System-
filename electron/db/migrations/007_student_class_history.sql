-- Track a student's class/section history (admission + promotions + manual changes).
CREATE TABLE IF NOT EXISTS student_class_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id),
  section_id INTEGER REFERENCES sections(id),
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_sch_student ON student_class_history(student_id, changed_at);

-- Backfill: one initial entry per existing student.
INSERT INTO student_class_history (student_id, class_id, section_id, changed_at, note)
SELECT s.id, s.class_id, s.section_id,
       COALESCE(s.admission_date, s.created_at, datetime('now')),
       'Admission'
FROM students s
WHERE s.is_deleted = 0
  AND NOT EXISTS (SELECT 1 FROM student_class_history h WHERE h.student_id = s.id);