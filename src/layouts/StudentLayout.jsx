import { AppShell } from '../components/layout/AppShell';

/** Student workspace - read only, scoped to the linked student record. */
export function StudentLayout() {
  return <AppShell role="student" />;
}

export default StudentLayout;