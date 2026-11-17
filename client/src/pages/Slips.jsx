import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, Clock, AlertTriangle, ClipboardList } from 'lucide-react';
import { api, qs, fmtDate, fmtDateTime, money } from '../api.js';
import { BarChart } from '../charts.jsx';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Loading, Modal, PageHeader, Segmented, StatCard, useAsync, useToast, cx } from '../ui.jsx';

const PERIODS = [{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }];

export default function Slips() {
  const toast = useToast();
  const [period, setPeriod] = useState('week'); const [tab, setTab] = useState('Pending');
  const [busy, setBusy] = useState(null); const [problem, setProblem] = useState(null);
  const stats = useAsync(() => api.get(`/slips/stats${qs({ period })}`), [period]);
  const list = useAsync(() => api.get(`/slips${qs({ status: tab })}`), [tab]);
  const refresh = () => { stats.reload(); list.reload(); };

  const collect = async (slip) => {
    setBusy(slip.id);
    try { await api.post(`/slips/${slip.id}/collect`); toast(`Slip collected for ${slip.patient_name}. Stock updated.`); refresh(); }
    catch (e) { if (e.status === 409 && e.data?.short) setProblem({ slip, message: e.message, short: e.data.short }); else toast(e.message, 'error'); refresh(); }
    finally { setBusy(null); }
  };

  const s = stats.data;
  return (
    <>
      <PageHeader title="Prescription slips" subtitle="Slips sent by doctors, and how many the pharmacy has served." actions={<Segmented label="Period" options={PERIODS} value={period} onChange={setPeriod} />} />
      {stats.error && <ErrorBox error={stats.error} onRetry={stats.reload} />}
      {s && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Collected today" value={s.today} icon={ClipboardCheck} tone="green" />
          <StatCard label={`Collected ${PERIODS.find((p) => p.value === period).label.toLowerCase()}`} value={s.total} sub={`${fmtDate(s.from)} – ${fmtDate(s.to)}`} icon={CheckCircle2} />
          <StatCard label="Waiting for collection" value={s.pending} icon={Clock} tone="amber" />
        </div>
      )}
      {s && (
        <Card className="mb-6">
          <CardHeader title="Slips collected per day" subtitle={`Total for the period: ${s.total}`} />
          <div className="p-5">{s.byDay.length > 62 ? <p className="py-8 text-center text-sm text-slate-500">Choose a shorter period.</p> : <BarChart data={s.byDay} series={[{ key: 'count', label: 'Slips collected', color: '#0d9488' }]} format={(v) => Math.round(v)} />}</div>
          {s.byDay.length <= 7 && (
            <div className="grid grid-cols-7 border-t border-slate-100 text-center text-sm dark:border-slate-800">
              {s.byDay.map((d) => <div key={d.date} className="px-1 py-3"><p className="text-xs text-slate-500">{fmtDate(d.date, { weekday: 'short' })}</p><p className="font-semibold">{d.count}</p></div>)}
            </div>
          )}
        </Card>
      )}

      <Card>
        <div className="border-b border-slate-100 p-4 dark:border-slate-800"><Segmented label="Slip status" options={[{ value: 'Pending', label: 'Not yet collected' }, { value: 'Collected', label: 'Collected' }]} value={tab} onChange={setTab} /></div>
        {list.error && <div className="p-4"><ErrorBox error={list.error} onRetry={list.reload} /></div>}
        {list.loading && !list.data ? <Loading /> : list.data && (list.data.length === 0 ? (
          <Empty icon={ClipboardList} title={tab === 'Pending' ? 'All caught up' : 'No collected slips yet'} hint={tab === 'Pending' ? 'There are no prescriptions waiting for collection.' : undefined} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.data.map((slip) => (
              <li key={slip.id} className="anim-in flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white">{slip.patient_name} <span className="font-normal text-slate-500">· {slip.patient_phone}</span></p>
                  <p className="text-xs text-slate-500">Issued {fmtDateTime(slip.issued_at)} by {slip.doctor_name}{slip.collected_at && ` · collected ${fmtDateTime(slip.collected_at)}`}</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {slip.items.map((i) => (
                      <li key={i.id} className={cx('rounded-lg border px-2.5 py-1 text-xs', slip.status === 'Pending' && i.quantity > i.stock ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200' : 'border-slate-200 dark:border-slate-700')}>
                        <b>{i.medicine_name}</b> × {i.quantity}<span className="text-slate-500"> · {i.dose}, {i.duration}</span>
                        {slip.status === 'Pending' && <span className="ml-1 font-medium">({i.stock} in stock)</span>}
                      </li>))}
                  </ul>
                </div>
                {slip.status === 'Pending' ? <Button icon={CheckCircle2} loading={busy === slip.id} onClick={() => collect(slip)}>Mark collected</Button> : <Badge tone="green">{money(slip.total)}</Badge>}
              </li>
            ))}
          </ul>
        ))}
      </Card>

      <Modal open={!!problem} onClose={() => setProblem(null)} title="Not enough stock" footer={<Button onClick={() => setProblem(null)}>OK</Button>}>
        <div className="flex gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
          <div className="space-y-2 text-sm"><p className="font-medium">The sale was blocked. Nothing was deducted.</p>
            {problem?.short.map((x) => <p key={x.medicine} className="text-slate-600 dark:text-slate-300"><b>{x.medicine}</b>: only <b>{x.available}</b> {x.unit} available, {x.requested} requested.</p>)}
            <p className="text-slate-500">Record a delivery in Inventory, or ask the doctor to adjust the prescription.</p></div></div>
      </Modal>
    </>
  );
}
