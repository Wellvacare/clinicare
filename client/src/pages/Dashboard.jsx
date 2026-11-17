import { useState } from 'react';
import { Users, Wallet, TrendingUp, Receipt, Plus, Trash2, UserPlus } from 'lucide-react';
import { api, qs, money, fmtDate, todayIso } from '../api.js';
import { BarChart, StackBar } from '../charts.jsx';
import { Button, Card, CardHeader, Empty, ErrorBox, Input, Loading, Modal, PageHeader, Segmented, Select, StatCard, Table, useAsync, useToast } from '../ui.jsx';

const PERIODS = [{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }, { value: 'year', label: 'This year' }, { value: 'custom', label: 'Custom' }];
const STATUS_COLORS = { Booked: '#0ea5e9', 'Checked in': '#f59e0b', Completed: '#10b981', Cancelled: '#94a3b8', 'No-show': '#f43f5e' };
const CATEGORIES = ['Rent', 'Salaries', 'Supplies', 'Utilities', 'Equipment', 'Cleaning', 'Marketing', 'Other'];

export default function Dashboard() {
  const toast = useToast();
  const [period, setPeriod] = useState('month');
  const [range, setRange] = useState({ from: todayIso().slice(0, 8) + '01', to: todayIso() });
  const [modal, setModal] = useState(false);
  const query = period === 'custom' ? qs(range) : qs({ period });
  const valid = period !== 'custom' || (range.from && range.to && range.from <= range.to);
  const { data, error, loading, reload } = useAsync(() => (valid ? api.get(`/admin/summary${query}`) : Promise.resolve(null)), [query, valid]);
  const exp = useAsync(() => (valid ? api.get(`/admin/expenses${query}`) : Promise.resolve([])), [query, valid]);

  const removeExpense = async (id) => {
    try { await api.del(`/admin/expenses/${id}`); toast('Expense removed'); exp.reload(); reload(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <>
      <PageHeader title="Admin panel" subtitle="Patient visits, revenue and profit for the clinic."
        actions={<Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />} />
      {period === 'custom' && (
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <Input label="From" type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Input label="To" type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          {!valid && <p className="pb-2 text-sm text-rose-600">The start date must be before the end date.</p>}
        </div>
      )}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data && <Loading />}
      {data && (
        <div className="space-y-6">
          <p className="text-sm text-slate-500">{fmtDate(data.from)} – {fmtDate(data.to)}</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Patient visits" value={data.visits} sub={`${data.newPatients} new patients`} icon={Users} />
            <StatCard label="Revenue" value={money(data.revenue)} sub={`Consultations ${money(data.consultationRevenue)} · Pharmacy ${money(data.pharmacyRevenue)}`} icon={Wallet} tone="violet" />
            <StatCard label="Expenses" value={money(data.expenses)} icon={Receipt} tone="amber" />
            <StatCard label="Profit" value={money(data.profit)} sub={data.revenue ? `${Math.round((data.profit / data.revenue) * 100)}% margin` : undefined} icon={TrendingUp} tone={data.profit >= 0 ? 'green' : 'rose'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Revenue vs expenses" subtitle="By day" />
              <div className="p-5">
                {data.byDay.length > 62 ? <p className="py-10 text-center text-sm text-slate-500">Pick a shorter range to see the daily chart.</p>
                  : <BarChart data={data.byDay} format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : Math.round(v))} series={[{ key: 'revenue', label: 'Revenue', color: '#0d9488' }, { key: 'expenses', label: 'Expenses', color: '#f59e0b' }]} />}
              </div>
            </Card>
            <div className="space-y-6">
              <Card><CardHeader title="Appointments" subtitle="Status mix" /><div className="p-5"><StackBar items={Object.entries(data.status).map(([label, value]) => ({ label, value, color: STATUS_COLORS[label] }))} /></div></Card>
              <Card>
                <CardHeader title="By doctor" />
                {data.byDoctor.length ? <ul className="divide-y divide-slate-100 dark:divide-slate-800">{data.byDoctor.map((d) => (
                  <li key={d.name} className="flex items-center justify-between px-5 py-3 text-sm"><span className="flex items-center gap-2"><UserPlus className="size-4 text-slate-400" />{d.name}</span><span><b>{d.visits}</b> visits · {money(d.fees)}</span></li>))}</ul>
                  : <Empty title="No completed visits" />}
              </Card>
            </div>
          </div>

          <Card>
            <CardHeader title="Expenses" subtitle="Deducted from revenue to get profit" action={<Button size="sm" icon={Plus} onClick={() => setModal(true)}>Add expense</Button>} />
            {exp.data && (
              <Table rows={exp.data} empty={<Empty title="No expenses in this period" hint="Add rent, salaries or supplies to see accurate profit." />}
                columns={[
                  { key: 'date', header: 'Date', render: (r) => fmtDate(r.date) }, { key: 'category', header: 'Category' }, { key: 'note', header: 'Note', render: (r) => r.note || '—' },
                  { key: 'amount', header: 'Amount', className: 'text-right', render: (r) => money(r.amount) },
                  { key: 'x', header: '', className: 'w-12 text-right', render: (r) => <button aria-label="Delete expense" onClick={() => removeExpense(r.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button> },
                ]} />
            )}
          </Card>
        </div>
      )}
      <ExpenseModal open={modal} onClose={() => setModal(false)} onSaved={() => { setModal(false); toast('Expense added'); exp.reload(); reload(); }} />
    </>
  );
}

function ExpenseModal({ open, onClose, onSaved }) {
  const [f, setF] = useState({ date: todayIso(), category: 'Supplies', amount: '', note: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => {
    const amount = Number(f.amount);
    if (!Number.isFinite(amount) || amount <= 0) return setErr('Enter an amount above zero');
    setBusy(true); setErr('');
    try { await api.post('/admin/expenses', { ...f, amount }); setF({ ...f, amount: '', note: '' }); onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add expense" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save expense</Button></>}>
      <Input label="Date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      <Select label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
      <Input label="Amount (USD)" type="number" min="0" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      <Input label="Note (optional)" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} />
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
    </Modal>
  );
}
