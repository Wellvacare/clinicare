import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, ShieldCheck, Pill, BarChart3, Mic } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Button, Input } from '../ui.jsx';
import { Logo, ThemeButton } from '../Layout.jsx';

const DEMOS = [['Clinic admin', 'admin@clinic.test', 'admin123'], ['Doctor', 'doctor@clinic.test', 'doctor123'], ['Pharmacist', 'pharmacy@clinic.test', 'pharmacy123']];
const FEATURES = [[CalendarCheck, 'Book by chat or voice', 'Patients self-book 24/7 and land straight in the EMR.'], [Pill, 'Prescriptions to pharmacy', 'Slips flow to the pharmacy and stock updates on every sale.'], [BarChart3, 'Visits and profit', 'Clear numbers for any period, always up to date.'], [ShieldCheck, 'Role-based access', 'Each person sees only what their role needs.']];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);

  const submit = async (e, creds) => {
    e?.preventDefault(); setBusy(true); setError('');
    try { await login(creds?.[0] ?? email, creds?.[1] ?? password); } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-slate-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-brand-400/20 blur-3xl" /><div className="absolute -bottom-24 -left-10 size-80 rounded-full bg-sky-400/10 blur-3xl" />
        <Logo light />
        <div className="relative">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">One patient record.<br />Clinic and pharmacy, connected.</h1>
          <p className="mt-4 max-w-md text-brand-100">From the first booking to the follow-up visit, every step is in one place.</p>
          <ul className="mt-10 grid max-w-lg gap-5 sm:grid-cols-2">
            {FEATURES.map(([Icon, t, d]) => (
              <li key={t}><span className="mb-2 grid size-9 place-items-center rounded-xl bg-white/10"><Icon className="size-5" /></span><p className="font-semibold">{t}</p><p className="text-sm text-brand-100/80">{d}</p></li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-brand-100/70">© {new Date().getFullYear()} CliniCare</p>
      </div>

      <div className="flex flex-col p-6">
        <div className="flex items-center justify-between lg:justify-end"><div className="lg:hidden"><Logo /></div><ThemeButton /></div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Welcome back</h2>
          <p className="mt-1 text-slate-500">Sign in to your workspace.</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <Input label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@clinic.com" />
            <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{error}</p>}
            <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
          </form>
          <div className="mt-8">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Demo accounts</p>
            <div className="grid gap-2">
              {DEMOS.map((d) => (
                <button key={d[1]} disabled={busy} onClick={() => submit(null, [d[1], d[2]])} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5 text-left text-sm transition hover:border-brand-400 hover:bg-brand-50 dark:border-slate-800 dark:hover:bg-slate-900">
                  <span className="font-medium">{d[0]}</span><span className="text-slate-400">{d[1]}</span>
                </button>
              ))}
            </div>
          </div>
          <Link to="/book" className="mt-8 flex items-center justify-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700 transition hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-200">
            <Mic className="size-4" />Patient? Book an appointment by chat or voice
          </Link>
        </div>
      </div>
    </div>
  );
}
