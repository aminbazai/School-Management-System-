import { StudentsPage } from '../admin/StudentsPage';

/**
 * Office > Admissions.
 *
 * The same student module the admin uses; the role decides what is available:
 * the office may admit students, create their logins, import from Excel, export
 * lists and print ID cards, but it may never delete a student - that is
 * `canDelete` in StudentsPage, and the main process refuses it as well.
 */
export function OfficeAdmissionsPage() {
  return <StudentsPage />;
}

export default OfficeAdmissionsPage;
