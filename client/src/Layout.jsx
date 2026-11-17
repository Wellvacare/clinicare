import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, CalendarDays, Users, Pill, ClipboardList, Bell, LogOut, Sun, Moon, Menu, X, Boxes, Stethoscope, CalendarPlus } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { cx } from './ui.jsx';

const NAV = {
  admin: [['/dashboard', 'Dashboard', LayoutDashboard], ['/appointments', 'Appointments', CalendarDays], ['/patients', 'Patients', Users], ['/stock', 'Pharmacy stock', Pill], ['/notifications', 'Reminders & messages', Bell]],
  doctor: [['/appointments', 'Appointments', CalendarDays], ['/patients', 'Patients', Users], ['/stock', 'Pharmacy stock', Pill], ['/notifications', 'Reminders & messages', Bell]],
  pharmacist: [['/inventory', 'Inventory', Boxes], ['/slips', 'Prescription slips', ClipboardList]],
};
const ROLE_LABEL = { admin: 'Clinic admin', doctor: 'Doctor', pharmacist: 'Pharmacist' };

export function Logo({ light }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="CliniCare home">
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/30"><Stethoscope className="size-5" /></span>
      <span className={cx('text-lg font-bold tracking-tight', light ? 'text-white' : 'text-slate-900 dark:text-white')}>Clini<span className="text-brand-500">Care</span></span>
    </Link>
  );
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark; setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.theme = next ? 'dark' : 'light'; } catch { /* ignore */ }
  };
  return [dark, toggle];
}
export function ThemeButton() {
  const [dark, toggle] = useTheme();
  return (
    <button onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const items = NAV[user.role];

  const sidebar = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="px-5 py-5"><Logo light /></div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Main">
        {items.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-brand-600 text-white shadow-md shadow-brand-900/40' : 'hover:bg-slate-800 hover:text-white')}>
            <Icon className="size-[18px]" />{label}
          </NavLink>
        ))}
        <a href="/book" target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-slate-700 px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:border-brand-500 hover:text-white">
          <CalendarPlus className="size-[18px]" />Patient booking page
        </a>
      </nav>
      <div className="border-t border-slate-800 p-4">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">{user.name.replace(/^Dr\.\s*/, '').slice(0, 1)}</span>
          <div className="min-w-0"><p className="truncate text-sm font-medium text-white">{user.name}</p><p className="text-xs text-slate-400">{ROLE_LABEL[user.role]}</p></div>
        </div>
        <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:bg-slate-800 hover:text-white"><LogOut className="size-4" />Sign out</button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72 max-w-[85%]">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 lg:px-8">
          <button className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800" onClick={() => setOpen(!open)} aria-label="Open menu">{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
          <p className="hidden text-sm text-slate-500 lg:block">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <div className="lg:hidden"><Logo /></div>
          <ThemeButton />
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8"><div className="mx-auto max-w-6xl"><Outlet /></div></main>
      </div>
    </div>
  );
}
