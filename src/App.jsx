import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './store/AuthProvider';
import { Spinner } from './components/ui/Button';
import { LoginPage } from './pages/auth/LoginPage';
import { ChangePasswordPage } from './pages/auth/ChangePasswordPage';
import { AdminLayout } from './layouts/AdminLayout';
import { OfficeLayout } from './layouts/OfficeLayout';
import { TeacherLayout } from './layouts/TeacherLayout';
import { StudentLayout } from './layouts/StudentLayout';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { UsersPage } from './pages/admin/UsersPage';
import { StudentsPage } from './pages/admin/StudentsPage';
import { ClassesPage } from './pages/admin/ClassesPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { OfficeDashboard } from './pages/office/OfficeDashboard';
import { OfficeAdmissionsPage } from './pages/office/OfficeAdmissionsPage';
import { TeacherDashboard } from './pages/teacher/TeacherDashboard';
import { MyClassesPage } from './pages/teacher/MyClassesPage';
import { StudentDashboard } from './pages/student/StudentDashboard';
import { StudentClassPage } from './pages/student/StudentClassPage';
import { MyAttendancePage } from './pages/student/MyAttendancePage';
import { StaffPage } from './pages/shared/StaffPage';
import { StaffAttendancePage } from './pages/shared/StaffAttendancePage';
import { StudentAttendancePage } from './pages/shared/StudentAttendancePage';
import { MyStaffAttendancePage } from './pages/teacher/MyStaffAttendancePage';
import { MyLeavePage } from './pages/teacher/MyLeavePage';
import { AttendanceReportsPage } from './pages/admin/AttendanceReportsPage';
import { SalaryPage } from './pages/shared/SalaryPage';
import { MySalaryPage } from './pages/teacher/MySalaryPage';
import { FeePage } from './pages/shared/FeePage';
import { ExpensesPage } from './pages/shared/ExpensesPage';
import { StudentFeesPage } from './pages/student/StudentFeesPage';
import { ExamsPage } from './pages/admin/ExamsPage';
import { MarksEntryPage } from './pages/teacher/MarksEntryPage';
import { StudentResultsPage } from './pages/student/StudentResultsPage';
import { TimetablePage } from './pages/shared/TimetablePage';
import { MyTimetablePage } from './pages/shared/MyTimetablePage';
import { NoticesPage } from './pages/shared/NoticesPage';
import { MessagingPage } from './pages/shared/MessagingPage';
import { ReportsPage } from './pages/office/ReportsPage';
import { BackupPage } from './pages/admin/BackupPage';
import { AuditPage } from './pages/admin/AuditPage';
import { ComingSoon } from './pages/shared/ComingSoon';
import { NotFound } from './pages/shared/NotFound';
import { ROLE_HOME } from './config/menu';

function FullScreenLoader() {
  return (
    <div className="app-bg flex h-screen w-screen items-center justify-center" data-accent="admin">
      <Spinner size={26} className="text-[var(--color-muted)]" />
    </div>
  );
}

/**
 * Route guard (UI side).
 * The main process re-checks everything - this only avoids rendering the
 * wrong workspace and gives a smooth experience.
 */
function Guard({ role }) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullScreenLoader />;
  if (status !== 'authed' || !user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;

  return <Outlet />;
}

function PublicOnly({ children }) {
  const { status, user } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authed' && user) return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
  return children;
}

function RootRedirect() {
  const { status, user } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'authed' && user) return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;
  return <Navigate to="/login" replace />;
}

export function App() {
  useTranslation(); // ensure i18n is initialised before first paint

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <LoginPage />
          </PublicOnly>
        }
      />

      {/* Admin / Principal */}
      <Route path="/admin" element={<Guard role="admin" />}>
        <Route element={<AdminLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="students" element={<StudentsPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="messaging" element={<MessagingPage />} />
          <Route path="classes" element={<ClassesPage />} />
          <Route path="subjects" element={<ClassesPage initialTab="subjects" />} />
          <Route path="attendance" element={<StudentAttendancePage role="admin" />} />
          <Route path="attendance-reports" element={<AttendanceReportsPage />} />
          <Route path="salary" element={<SalaryPage role="admin" />} />
          <Route path="fees" element={<FeePage role="admin" />} />
          <Route path="expenses" element={<ExpensesPage role="admin" />} />
          <Route path="exams" element={<ExamsPage />} />
          <Route path="timetable" element={<TimetablePage />} />
          <Route path="notices" element={<NoticesPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="backup" element={<BackupPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="change-password" element={<ChangePasswordPage role="admin" />} />
          <Route path="*" element={<ComingSoon role="admin" />} />
        </Route>
      </Route>

      {/* Office / Accounts */}
      <Route path="/office" element={<Guard role="office" />}>
        <Route element={<OfficeLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<OfficeDashboard />} />
          <Route path="admissions" element={<OfficeAdmissionsPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="messaging" element={<MessagingPage />} />
          <Route path="staff-attendance" element={<StaffAttendancePage />} />
          <Route path="attendance" element={<StudentAttendancePage role="office" />} />
          <Route path="salary" element={<SalaryPage role="office" />} />
          <Route path="fees" element={<FeePage role="office" />} />
          <Route path="expenses" element={<ExpensesPage role="office" />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="timetable" element={<TimetablePage />} />
          <Route path="notices" element={<NoticesPage />} />
          <Route path="change-password" element={<ChangePasswordPage role="office" />} />
          <Route path="*" element={<ComingSoon role="office" />} />
        </Route>
      </Route>

      {/* Teacher */}
      <Route path="/teacher" element={<Guard role="teacher" />}>
        <Route element={<TeacherLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<TeacherDashboard />} />
          <Route path="classes" element={<MyClassesPage />} />
          <Route path="attendance" element={<StudentAttendancePage role="teacher" />} />
          <Route path="my-attendance" element={<MyStaffAttendancePage />} />
          <Route path="my-leave" element={<MyLeavePage />} />
          <Route path="salary" element={<MySalaryPage />} />
          <Route path="marks" element={<MarksEntryPage />} />
          <Route path="timetable" element={<MyTimetablePage role="teacher" />} />
          <Route path="notices" element={<NoticesPage />} />
          <Route path="change-password" element={<ChangePasswordPage role="teacher" />} />
          <Route path="*" element={<ComingSoon role="teacher" />} />
        </Route>
      </Route>

      {/* Student */}
      <Route path="/student" element={<Guard role="student" />}>
        <Route element={<StudentLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<StudentDashboard />} />
          <Route path="profile" element={<StudentClassPage mode="profile" />} />
          <Route path="class" element={<StudentClassPage mode="class" />} />
          <Route path="attendance" element={<MyAttendancePage />} />
          <Route path="fees" element={<StudentFeesPage />} />
          <Route path="results" element={<StudentResultsPage />} />
          <Route path="timetable" element={<MyTimetablePage role="student" />} />
          <Route path="notices" element={<NoticesPage />} />
          <Route path="change-password" element={<ChangePasswordPage role="student" />} />
          <Route path="*" element={<ComingSoon role="student" />} />
        </Route>
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;