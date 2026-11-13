import {
  LayoutDashboard,
  Users,
  IdCard,
  School,
  BookOpen,
  CalendarCheck,
  Wallet,
  Banknote,
  ClipboardList,
  CalendarRange,
  Megaphone,
  BarChart3,
  Settings,
  DatabaseBackup,
  ScrollText,
  Receipt,
  TrendingDown,
  UserPlus,
  Clock,
  PencilRuler,
  Table2,
  UserCog,
  UserCheck,
  KeyRound,
  GraduationCap,
  Umbrella,
  MessagesSquare,
} from 'lucide-react';

/**
 * Role based navigation.
 *
 * `phase` marks modules that ship in a later phase - the sidebar shows them
 * with a small badge so the full information architecture is visible from day one.
 */
export const MENUS = {
  admin: {
    accent: 'admin',
    home: '/admin/dashboard',
    groups: [
      {
        labelKey: 'nav.group_main',
        items: [{ to: '/admin/dashboard', labelKey: 'nav.admin.dashboard', icon: LayoutDashboard, phase: 1 }],
      },
      {
        labelKey: 'nav.group_manage',
        items: [
          { to: '/admin/students', labelKey: 'nav.admin.students', icon: GraduationCap, phase: 2, done: true },
          { to: '/admin/staff', labelKey: 'nav.admin.staff', icon: IdCard, phase: 3, done: true },
          { to: '/admin/messaging', labelKey: 'nav.admin.messaging', icon: MessagesSquare, phase: 9, done: true },
          { to: '/admin/classes', labelKey: 'nav.admin.classes', icon: School, phase: 2, done: true },
          { to: '/admin/subjects', labelKey: 'nav.admin.subjects', icon: BookOpen, phase: 2, done: true },
        ],
      },
      {
        labelKey: 'nav.group_academic',
        items: [
          { to: '/admin/attendance', labelKey: 'nav.admin.attendance', icon: CalendarCheck, phase: 3, done: true },
          { to: '/admin/exams', labelKey: 'nav.admin.exams', icon: ClipboardList, phase: 6, done: true },
          { to: '/admin/timetable', labelKey: 'nav.admin.timetable', icon: CalendarRange, phase: 7, done: true },
          { to: '/admin/notices', labelKey: 'nav.admin.notices', icon: Megaphone, phase: 7, done: true },
        ],
      },
      {
        labelKey: 'nav.group_finance',
        items: [
          { to: '/admin/fees', labelKey: 'nav.admin.fees', icon: Wallet, phase: 5, done: true },
          { to: '/admin/expenses', labelKey: 'nav.admin.expenses', icon: TrendingDown, phase: 5, done: true },
          { to: '/admin/salary', labelKey: 'nav.admin.salary', icon: Banknote, phase: 4, done: true },
        ],
      },
      {
        labelKey: 'nav.group_system',
        items: [
          { to: '/admin/users', labelKey: 'nav.admin.users', icon: UserCog, phase: 1 },
          { to: '/admin/attendance-reports', labelKey: 'nav.admin.attendanceReports', icon: UserCheck, phase: 3, done: true },
          { to: '/admin/settings', labelKey: 'nav.admin.settings', icon: Settings, phase: 2, done: true },
          { to: '/admin/backup', labelKey: 'nav.admin.backup', icon: DatabaseBackup, phase: 8, done: true },
          { to: '/admin/audit', labelKey: 'nav.admin.audit', icon: ScrollText, phase: 8, done: true },
        ],
      },
    ],
  },

  office: {
    accent: 'office',
    home: '/office/dashboard',
    groups: [
      {
        labelKey: 'nav.group_main',
        items: [{ to: '/office/dashboard', labelKey: 'nav.office.dashboard', icon: LayoutDashboard, phase: 1 }],
      },
      {
        labelKey: 'nav.group_manage',
        items: [
          { to: '/office/staff', labelKey: 'nav.office.staff', icon: IdCard, phase: 3, done: true },
          { to: '/office/staff-attendance', labelKey: 'nav.office.staffAttendance', icon: CalendarCheck, phase: 3, done: true },
          { to: '/office/admissions', labelKey: 'nav.office.admissions', icon: UserPlus, phase: 2, done: true },
        ],
      },
      {
        labelKey: 'nav.group_finance',
        items: [
          { to: '/office/salary', labelKey: 'nav.office.salary', icon: Banknote, phase: 4, done: true },
          { to: '/office/fees', labelKey: 'nav.office.fees', icon: Receipt, phase: 5, done: true },
          { to: '/office/expenses', labelKey: 'nav.office.expenses', icon: TrendingDown, phase: 5, done: true },
        ],
      },
      {
        labelKey: 'nav.group_academic',
        items: [
          { to: '/office/attendance', labelKey: 'nav.office.attendance', icon: CalendarCheck, phase: 3, done: true },
          { to: '/office/timetable', labelKey: 'nav.office.timetable', icon: CalendarRange, phase: 7, done: true },
          { to: '/office/notices', labelKey: 'nav.office.notices', icon: Megaphone, phase: 7, done: true },
        ],
      },
      {
        labelKey: 'nav.group_more',
        items: [
          { to: '/office/reports', labelKey: 'nav.office.reports', icon: BarChart3, phase: 7, done: true },
          { to: '/office/messaging', labelKey: 'nav.office.messaging', icon: MessagesSquare, phase: 9, done: true },
        ],
      },
    ],
  },

  teacher: {
    accent: 'teacher',
    home: '/teacher/dashboard',
    groups: [
      {
        labelKey: 'nav.group_main',
        items: [
          { to: '/teacher/dashboard', labelKey: 'nav.teacher.dashboard', icon: LayoutDashboard, phase: 1 },
          { to: '/teacher/classes', labelKey: 'nav.teacher.classes', icon: School, phase: 3, done: true },
          { to: '/teacher/attendance', labelKey: 'nav.teacher.attendance', icon: CalendarCheck, phase: 3, done: true },
          { to: '/teacher/marks', labelKey: 'nav.teacher.marks', icon: PencilRuler, phase: 6, done: true },
          { to: '/teacher/timetable', labelKey: 'nav.teacher.timetable', icon: CalendarRange, phase: 7, done: true },
        ],
      },
      {
        labelKey: 'nav.group_more',
        items: [
          { to: '/teacher/my-attendance', labelKey: 'nav.teacher.myAttendance', icon: Clock, phase: 3, done: true },
          { to: '/teacher/my-leave', labelKey: 'nav.teacher.myLeave', icon: Umbrella, phase: 3, done: true },
          { to: '/teacher/salary', labelKey: 'nav.teacher.salary', icon: Banknote, phase: 4, done: true },
          { to: '/teacher/notices', labelKey: 'nav.teacher.notices', icon: Megaphone, phase: 7, done: true },
          { to: '/teacher/change-password', labelKey: 'nav.teacher.changePassword', icon: KeyRound, phase: 1 },
        ],
      },
    ],
  },

  student: {
    accent: 'student',
    home: '/student/dashboard',
    groups: [
      {
        labelKey: 'nav.group_main',
        items: [
          { to: '/student/dashboard', labelKey: 'nav.student.dashboard', icon: LayoutDashboard, phase: 1 },
          { to: '/student/profile', labelKey: 'nav.student.profile', icon: Users, phase: 2, done: true },
          { to: '/student/class', labelKey: 'nav.student.class', icon: School, phase: 2, done: true },
          { to: '/student/attendance', labelKey: 'nav.student.attendance', icon: CalendarCheck, phase: 3, done: true },
          { to: '/student/results', labelKey: 'nav.student.results', icon: Table2, phase: 6, done: true },
          { to: '/student/fees', labelKey: 'nav.student.fees', icon: Wallet, phase: 5, done: true },
        ],
      },
      {
        labelKey: 'nav.group_more',
        items: [
          { to: '/student/timetable', labelKey: 'nav.student.timetable', icon: CalendarRange, phase: 7, done: true },
          { to: '/student/notices', labelKey: 'nav.student.notices', icon: Megaphone, phase: 7, done: true },
          { to: '/student/change-password', labelKey: 'nav.student.changePassword', icon: KeyRound, phase: 1 },
        ],
      },
    ],
  },
};

export const ROLE_HOME = {
  admin: MENUS.admin.home,
  office: MENUS.office.home,
  teacher: MENUS.teacher.home,
  student: MENUS.student.home,
};

export default MENUS;