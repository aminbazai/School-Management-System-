'use strict';

const { register } = require('./guard');
const C = require('./channels');
const classes = require('../services/classes.service');
const { validate, helpers } = require('../services/validation');

/**
 * Academic structure. Reads are open to staff roles (office needs them for
 * admissions), writes are admin-only.
 */

const ID = { id: helpers.int({ min: 1 }) };

function registerClassesIpc() {
  // --- one call that fills every dropdown (scoped for teachers) ------------
  register(C.STRUCTURE_GET, { roles: '*' }, ({ session }) => classes.structure(session));

  // --- classes -------------------------------------------------------------
  register(C.CLASSES_LIST, { roles: '*' }, ({ payload }) =>
    classes.listClasses(validate(payload || {}, { includeInactive: helpers.bool() })),
  );
  register(C.CLASSES_CREATE, { roles: ['admin'] }, ({ payload, session }) => classes.createClass(payload, session));
  register(C.CLASSES_UPDATE, { roles: ['admin'] }, ({ payload, session }) => {
    const { id, ...rest } = payload || {};
    return classes.updateClass(validate({ id }, ID).id, rest, session);
  });
  register(C.CLASSES_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    classes.deleteClass(validate(payload || {}, ID).id, session),
  );

  // --- sections ------------------------------------------------------------
  register(C.SECTIONS_LIST, { roles: '*' }, ({ payload }) =>
    classes.listSections(validate(payload || {}, { classId: helpers.int({ min: 1 }) })),
  );
  register(C.SECTIONS_CREATE, { roles: ['admin'] }, ({ payload, session }) => classes.createSection(payload, session));
  register(C.SECTIONS_UPDATE, { roles: ['admin'] }, ({ payload, session }) => {
    const { id, ...rest } = payload || {};
    return classes.updateSection(validate({ id }, ID).id, rest, session);
  });
  register(C.SECTIONS_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    classes.deleteSection(validate(payload || {}, ID).id, session),
  );

  // --- subjects ------------------------------------------------------------
  register(C.SUBJECTS_LIST, { roles: '*' }, ({ payload }) =>
    classes.listSubjects(validate(payload || {}, { includeInactive: helpers.bool() })),
  );
  register(C.SUBJECTS_CREATE, { roles: ['admin'] }, ({ payload, session }) => classes.createSubject(payload, session));
  register(C.SUBJECTS_UPDATE, { roles: ['admin'] }, ({ payload, session }) => {
    const { id, ...rest } = payload || {};
    return classes.updateSubject(validate({ id }, ID).id, rest, session);
  });
  register(C.SUBJECTS_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    classes.deleteSubject(validate(payload || {}, ID).id, session),
  );

  // --- class subjects ------------------------------------------------------
  register(C.CLASS_SUBJECTS_LIST, { roles: '*' }, ({ payload }) =>
    classes.listClassSubjects(validate(payload || {}, { classId: helpers.int({ min: 1 }) })),
  );
  register(C.CLASS_SUBJECTS_SAVE, { roles: ['admin'] }, ({ payload, session }) =>
    classes.saveClassSubject(payload, session),
  );
  register(C.CLASS_SUBJECTS_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    classes.deleteClassSubject(validate(payload || {}, ID).id, session),
  );

  // --- teacher assignments -------------------------------------------------
  // A teacher only ever sees their own rows; office and admin see them all.
  register(C.TEACHER_ASSIGNMENTS_LIST, { roles: ['admin', 'office', 'teacher'] }, ({ payload, session }) => {
    const clean = validate(payload || {}, {
      classId: helpers.int({ min: 1 }),
      sectionId: helpers.int({ min: 1 }),
      subjectId: helpers.int({ min: 1 }),
      teacherId: helpers.int({ min: 1 }),
    });
    if (session.role === 'teacher') clean.teacherId = session.linkedId;
    return classes.listAssignments(clean);
  });
  register(C.TEACHER_ASSIGNMENTS_SAVE, { roles: ['admin'] }, ({ payload, session }) =>
    classes.saveAssignment(payload, session),
  );
  register(C.TEACHER_ASSIGNMENTS_DELETE, { roles: ['admin'] }, ({ payload, session }) =>
    classes.deleteAssignment(validate(payload || {}, ID).id, session),
  );

  // --- academic sessions ---------------------------------------------------
  register(C.SESSIONS_LIST, { roles: '*' }, () => classes.listSessions());
  register(C.SESSIONS_CREATE, { roles: ['admin'] }, ({ payload, session }) => classes.createSession(payload, session));
  register(C.SESSIONS_ACTIVATE, { roles: ['admin'] }, ({ payload, session }) =>
    classes.activateSession(validate(payload || {}, ID).id, session),
  );
}

module.exports = { registerClassesIpc };