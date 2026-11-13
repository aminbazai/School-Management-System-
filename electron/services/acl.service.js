'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('./validation');

/**
 * Access control helpers shared by the IPC layer.
 *
 * These are the rules the specification cares about most:
 * a teacher may only touch classes assigned to them, and a student may only
 * ever reach their own linked record.
 */

function isAdminLike(session) {
  return session && (session.role === 'admin' || session.role === 'office');
}

/** Throws unless the session's role is in the list. */
function assertRole(session, roles) {
  if (!session || !roles.includes(session.role)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

/** Class/section ids a teacher is assigned to (empty array for other roles). */
function teacherAssignments(session) {
  if (!session || session.role !== 'teacher' || !session.linkedId) return [];
  return getDb()
    .prepare(
      `SELECT class_id, section_id, subject_id FROM teacher_assignments
       WHERE teacher_id = ? AND is_active = 1`,
    )
    .all(session.linkedId);
}

function teacherClassIds(session) {
  return [...new Set(teacherAssignments(session).map((a) => a.class_id))];
}

/**
 * Guards a class/section scoped operation.
 * Admins and office pass; a teacher must hold an assignment for that class
 * (and, when given, that section).
 */
function assertClassAccess(session, classId, sectionId = null) {
  if (isAdminLike(session)) return;
  if (!session || session.role !== 'teacher') throw new AppError('FORBIDDEN', 'FORBIDDEN');

  const assignments = teacherAssignments(session);
  const targetClass = Number(classId);
  const targetSection = sectionId ? Number(sectionId) : null;

  const allowed = assignments.some((a) => {
    if (a.class_id !== targetClass) return false;
    if (targetSection === null) return true;
    return a.section_id === targetSection;
  });
  if (!allowed) throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

/** Students may only read their own record; staff read what their role allows. */
function assertStudentAccess(session, studentId) {
  if (!session) throw new AppError('FORBIDDEN', 'FORBIDDEN');
  if (isAdminLike(session)) return;
  if (session.role === 'teacher') {
    const row = getDb()
      .prepare(`SELECT class_id, section_id FROM students WHERE id = ? AND is_deleted = 0`)
      .get(studentId);
    if (!row) throw new AppError('NOT_FOUND', 'NOT_FOUND');
    assertClassAccess(session, row.class_id, row.section_id);
    return;
  }
  if (session.role === 'student') {
    const link = getDb()
      .prepare(`SELECT linked_id FROM users WHERE id = ? AND is_deleted = 0`)
      .get(session.userId);
    if (!link || link.linked_id !== Number(studentId)) throw new AppError('FORBIDDEN', 'FORBIDDEN');
    return;
  }
  throw new AppError('FORBIDDEN', 'FORBIDDEN');
}

/** The student id behind a session (students only). */
function ownStudentId(session) {
  if (!session || session.role !== 'student') throw new AppError('FORBIDDEN', 'FORBIDDEN');
  const link = getDb()
    .prepare(`SELECT linked_id FROM users WHERE id = ? AND is_deleted = 0`)
    .get(session.userId);
  if (!link || !link.linked_id) throw new AppError('NOT_FOUND', 'NOT_FOUND');
  return link.linked_id;
}

/** The staff id behind a session (teachers only). */
function ownStaffId(session) {
  if (!session || session.role !== 'teacher' || !session.linkedId) {
    throw new AppError('FORBIDDEN', 'FORBIDDEN');
  }
  return session.linkedId;
}

module.exports = {
  isAdminLike,
  assertRole,
  assertClassAccess,
  assertStudentAccess,
  teacherAssignments,
  teacherClassIds,
  ownStudentId,
  ownStaffId,
};