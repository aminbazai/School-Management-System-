'use strict';

const ExcelJS = require('exceljs');
const { getDb } = require('../db/connection');
const { helpers } = require('./validation');
const { logger } = require('../logger');

/**
 * Excel import / export.
 *
 * The renderer never touches the file system: it asks main to open a dialog,
 * main reads or writes the workbook and returns plain data.
 */

const STUDENT_COLUMNS = [
  { header: 'Admission No', key: 'admission_no', width: 18 },
  { header: 'Name', key: 'name', width: 24 },
  { header: "Father's Name", key: 'father_name', width: 24 },
  { header: 'Gender', key: 'gender', width: 10 },
  { header: 'Date of Birth', key: 'dob', width: 14 },
  { header: 'B-Form', key: 'b_form', width: 18 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Address', key: 'address', width: 32 },
  { header: 'Class', key: 'class_name', width: 14 },
  { header: 'Section', key: 'section_name', width: 10 },
  { header: 'Roll No', key: 'roll_no', width: 10 },
  { header: 'Admission Date', key: 'admission_date', width: 15 },
  { header: 'Previous School', key: 'previous_school', width: 24 },
  { header: 'Guardian Name', key: 'guardian_name', width: 24 },
  { header: 'Guardian Phone', key: 'guardian_phone', width: 15 },
  { header: 'Status', key: 'status', width: 12 },
];

const STAFF_COLUMNS = [
  { header: 'Employee Code', key: 'employee_code', width: 18 },
  { header: 'Name', key: 'name', width: 24 },
  { header: "Father's Name", key: 'father_name', width: 24 },
  { header: 'CNIC', key: 'cnic', width: 18 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Email', key: 'email', width: 24 },
  { header: 'Address', key: 'address', width: 32 },
  { header: 'Qualification', key: 'qualification', width: 20 },
  { header: 'Designation', key: 'designation', width: 20 },
  { header: 'Staff Type', key: 'staff_type', width: 12 },
  { header: 'Joining Date', key: 'joining_date', width: 15 },
  { header: 'Basic Salary', key: 'basic_salary', width: 13 },
  { header: 'Blood Group', key: 'blood_group', width: 12 },
  { header: 'Status', key: 'status', width: 12 },
  { header: 'Notes', key: 'notes', width: 32 },
];

const HEADER_ALIASES = {
  admission_no: 'admission no',
  admissionnumber: 'admission no',
  'admission no.': 'admission no',
  'admission no': 'admission no',
  admno: 'admission no',
  name: 'name',
  studentname: 'name',
  'student name': 'name',
  father_name: "father's name",
  fathersname: "father's name",
  "father's name": "father's name",
  father: "father's name",
  gender: 'gender',
  dob: 'date of birth',
  dateofbirth: 'date of birth',
  'date of birth': 'date of birth',
  b_form: 'b-form',
  'b-form': 'b-form',
  bform: 'b-form',
  phone: 'phone',
  contact: 'phone',
  mobile: 'phone',
  address: 'address',
  class: 'class_name',
  class_name: 'class_name',
  section: 'section_name',
  section_name: 'section_name',
  roll_no: 'roll no',
  rollno: 'roll no',
  'roll no.': 'roll no',
  admission_date: 'admission date',
  admissiondate: 'admission date',
  'admission date': 'admission date',
  previous_school: 'previous school',
  previousschool: 'previous school',
  'previous school': 'previous school',
  guardian_name: 'guardian name',
  guardianname: 'guardian name',
  'guardian name': 'guardian name',
  guardian_phone: 'guardian phone',
  guardianphone: 'guardian phone',
  'guardian phone': 'guardian phone',
  status: 'status',
};

const STAFF_HEADER_ALIASES = {
  employee_code: 'employee code',
  employeecode: 'employee code',
  'employee code': 'employee code',
  'employee code.': 'employee code',
  empcode: 'employee code',
  'emp code': 'employee code',
  staff_code: 'employee code',
  name: 'name',
  staffname: 'name',
  'staff name': 'name',
  father_name: "father's name",
  fathersname: "father's name",
  "father's name": "father's name",
  father: "father's name",
  cnic: 'cnic',
  'cnic no': 'cnic',
  'cnic number': 'cnic',
  phone: 'phone',
  contact: 'phone',
  mobile: 'phone',
  email: 'email',
  'email address': 'email',
  address: 'address',
  qualification: 'qualification',
  designation: 'designation',
  staff_type: 'staff type',
  stafftype: 'staff type',
  'staff type': 'staff type',
  type: 'staff type',
  joining_date: 'joining date',
  joiningdate: 'joining date',
  'joining date': 'joining date',
  basic_salary: 'basic salary',
  basicsalary: 'basic salary',
  'basic salary': 'basic salary',
  salary: 'basic salary',
  blood_group: 'blood group',
  bloodgroup: 'blood group',
  'blood group': 'blood group',
  status: 'status',
  notes: 'notes',
  remarks: 'notes',
};

function normaliseHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Reads an .xlsx/.xls workbook and returns { headers, rows } of raw strings. */
async function readWorkbook(filePath, aliases = HEADER_ALIASES) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The selected file has no sheets.');

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values;
    const cells = values.slice(1).map((cell) => {
      if (cell === null || cell === undefined) return '';
      if (typeof cell === 'object') {
        if (cell.text !== undefined) return String(cell.text);
        if (cell.result !== undefined) return String(cell.result);
        if (cell instanceof Date) return cell.toISOString().slice(0, 10);
        return String(cell);
      }
      return String(cell).trim();
    });
    if (cells.some((c) => c !== '')) rows.push(cells);
  });

  if (!rows.length) throw new Error('The selected file is empty.');

  // Exported workbooks carry a title row above the header, so files that were
  // exported and then edited can be imported again. The first row that maps at
  // least two known columns is treated as the header; otherwise row 1 is used.
  let headerIndex = 0;
  let columns = [];
  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const candidate = rows[index].map((header) => aliases[normaliseHeader(header)] || null);
    if (candidate.filter(Boolean).length >= 2) {
      headerIndex = index;
      columns = candidate;
      break;
    }
  }
  if (!columns.some(Boolean)) {
    columns = rows[0].map((header) => aliases[normaliseHeader(header)] || null);
  }

  return {
    headers: rows[headerIndex],
    mapped: columns,
    rows: rows.slice(headerIndex + 1),
  };
}

/** Writes any list of objects into a styled workbook and returns a Buffer. */
async function writeWorkbook(sheets, creator = 'School Management System') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = creator;
  workbook.created = new Date();

  for (const sheet of sheets) {
    const { name, columns, rows, title } = sheet;
    const worksheet = workbook.addWorksheet(name);
    if (title) {
      worksheet.addRow([title]);
      worksheet.getRow(1).font = { bold: true, size: 14 };
      worksheet.mergeCells(1, 1, 1, Math.max(columns.length, 1));
      worksheet.addRow([]);
    }

    const headerIndex = worksheet.rowCount;
    const header = worksheet.addRow(columns.map((c) => c.header));
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C7DF0' } };
    header.alignment = { vertical: 'middle' };
    header.height = 20;

    for (const row of rows) worksheet.addRow(columns.map((c) => row[c.key] ?? ''));

    columns.forEach((col, index) => {
      worksheet.getColumn(index + 1).width = col.width || 18;
    });
    worksheet.views = [{ state: 'frozen', ySplit: headerIndex }];
    if (rows.length) {
      worksheet.autoFilter = {
        from: { row: headerIndex, column: 1 },
        to: { row: headerIndex, column: columns.length },
      };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

const LIST_SPEC = {
  search: helpers.text({ max: 100, default: '' }),
  classId: helpers.int({ min: 1 }),
  sectionId: helpers.int({ min: 1 }),
  status: helpers.enum(['active', 'left', 'passed_out']),
  page: helpers.int({ min: 1, default: 1 }),
  pageSize: helpers.int({ min: 5, max: 1000, default: 25 }),
  sortBy: helpers.enum([
    'name',
    'admission_no',
    'class_name',
    'roll_no',
    'admission_date',
    'created_at',
  ]),
  sortDir: helpers.enum(['asc', 'desc'], { default: 'asc' }),
  includeDeleted: helpers.bool(),
};

function countStudents(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM students WHERE is_deleted = 0`).get().n;
}

module.exports = {
  STUDENT_COLUMNS,
  STAFF_COLUMNS,
  HEADER_ALIASES,
  STAFF_HEADER_ALIASES,
  LIST_SPEC,
  readWorkbook,
  writeWorkbook,
  normaliseHeader,
  countStudents,
  logger,
};
