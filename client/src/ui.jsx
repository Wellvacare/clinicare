import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, X, Loader2, Inbox } from 'lucide-react';

export const cx = (...a) => a.filter(Boolean).join(' ');

const BTN = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-600/20 disabled:bg-brand-600/50',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700',
  ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-600/50',
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-200 dark:hover:bg-brand-900/70',
};
export function Button({ variant = 'primary', size = 'md', loading, icon: Icon, className, children, disabled, ...p }) {
  return (
    <button
      type="button" disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-70',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'lg' ? 'px-6 py-3 text-base' : 'px-4 py-2 text-sm', BTN[variant], className)}
      {...p}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

export const Card = ({ className, children, ...p }) => (
  <div className={cx('rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900', className)} {...p}>{children}</div>
);
export const CardHeader = ({ title, subtitle, action }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
    <div><h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>{subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}</div>
    {action}
  </div>
);

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>{subtitle && <p className="mt-1 text-slate-500">{subtitle}</p>}</div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

const TONES = {
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', blue: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  red: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200', violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
};
export const Badge = ({ tone = 'slate', children, className }) => (
  <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', TONES[tone], className)}>{children}</span>
);
const STATUS_TONE = { Booked: 'blue', 'Checked in': 'amber', Completed: 'green', Cancelled: 'slate', 'No-show': 'red', Pending: 'amber', Collected: 'green', ok: 'green', low: 'amber', out: 'red' };
export const StatusBadge = ({ status }) => {
  const label = { ok: 'In stock', low: 'Low stock', out: 'Out of stock' }[status] || status;
  return <Badge tone={STATUS_TONE[status] || 'slate'}><span className="size-1.5 rounded-full bg-current opacity-70" />{label}</Badge>;
};

export function Field({ label, hint, error, children }) {
  const id = useId();
  return (
    <div>
      {label && <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>}
      {children(id)}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
const INPUT = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:disabled:bg-slate-800/50';
export const Input = ({ label, hint, error, className, ...p }) => (
  <Field label={label} hint={hint} error={error}>{(id) => <input id={id} className={cx(INPUT, className)} {...p} />}</Field>
);
export const Textarea = ({ label, hint, className, ...p }) => (
  <Field label={label} hint={hint}>{(id) => <textarea id={id} rows={3} className={cx(INPUT, 'resize-y', className)} {...p} />}</Field>
);
export const Select = ({ label, hint, children, className, ...p }) => (
  <Field label={label} hint={hint}>{(id) => <select id={id} className={cx(INPUT, className)} {...p}>{children}</select>}</Field>
);

export function SearchInput({ value, onChange, placeholder = 'Search…', className }) {
  return <input type="search" aria-label={placeholder} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cx(INPUT, 'sm:w-64', className)} />;
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {options.map((o) => {
        const v = o.value ?? o; const l = o.label ?? o;
        return (
          <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)}
            className={cx('rounded-lg px-3 py-1.5 text-sm font-medium transition', value === v ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200')}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

export const Spinner = ({ className }) => <Loader2 className={cx('size-5 animate-spin text-brand-600', className)} aria-label="Loading" />;
export const Loading = ({ label = 'Loading…' }) => <div className="flex items-center justify-center gap-3 py-16 text-slate-500" role="status"><Spinner />{label}</div>;
export const Empty = ({ title, hint, action, icon: Icon = Inbox }) => (
  <div className="flex flex-col items-center px-6 py-14 text-center">
    <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800"><Icon className="size-6" /></div>
    <p className="font-medium text-slate-700 dark:text-slate-200">{title}</p>
    {hint && <p className="mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);
export const ErrorBox = ({ error, onRetry }) => (
  <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
    <div className="flex-1">{error?.message || String(error)}</div>
    {onRetry && <button onClick={onRetry} className="font-medium underline">Retry</button>}
  </div>
);

export function StatCard({ label, value, sub, icon: Icon, tone = 'brand' }) {
  const t = { brand: 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200', green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200', rose: 'bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200', violet: 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200' }[tone];
  return (
    <Card className="anim-in p-5">
      <div className="flex items-start justify-between">
        <div><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</p>{sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}</div>
        {Icon && <div className={cx('grid size-10 place-items-center rounded-xl', t)}><Icon className="size-5" /></div>}
      </div>
    </Card>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input,select,textarea,button')?.focus();
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div ref={ref} className={cx('anim-in relative max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="size-5" /></button>
        </div>
        <div className="space-y-4 p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">{footer}</div>}
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setItems((s) => [...s, { id, message, type }]);
    setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('anim-in pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg', t.type === 'error' ? 'bg-rose-600' : 'bg-slate-900 dark:bg-slate-700')}>
            {t.type === 'error' ? <AlertTriangle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0 text-brand-300" />}{t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Small data-fetching hook: { data, error, loading, reload, setData } */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => live && setState({ data, error: null, loading: false }), (error) => live && setState((s) => ({ data: s.data, error, loading: false })));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1), setData: (data) => setState((s) => ({ ...s, data })) };
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Table({ columns, rows, rowKey = (r) => r.id, onRowClick, empty }) {
  if (!rows.length) return empty || null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
            {columns.map((c) => <th key={c.key} scope="col" className={cx('px-5 py-3 font-medium', c.className)}>{c.header}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cx('transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40', onRowClick && 'cursor-pointer')}>
              {columns.map((c) => <td key={c.key} className={cx('px-5 py-3.5', c.className)}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
