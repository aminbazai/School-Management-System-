import { AppShell } from '../components/layout/AppShell';

/** Teacher workspace - only classes assigned in the main process. */
export function TeacherLayout() {
  return <AppShell role="teacher" />;
}

export default TeacherLayout;