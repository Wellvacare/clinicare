import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, LogIn, Play, X, UserX, Search, CalendarX2, Eye } from 'lucide-react';
import { api, qs, addDays, todayIso, fmtDay } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Modal, PageHeader, Select, StatusBadge, Table, useAsync, useDebounced, useToast, cx } from '../ui.jsx';

const FILTERS = ['All', 'Booked', 'Checked in', 'Completed', 'Cancelled', 'No-show'];
const SOURCE = { chat: ['Chat bot', 'violet'], voice: ['Voice', 'violet'], web: ['Web', 'blue'], reception: ['Reception', 'slate'] };

export default function Appointments() {
  const { user } = useAuth(); const nav = useNavigate(); const toast = useToast();
  const [date, setDate] = useState(todayIso());
  const [status, setStatus] = useState('All'); const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [modal, setModal] = useState(false); const [confirm, setConfirm] = useState(null); const [busyId, setBusyId] = useState(null);
  const { data, error, loading, reload } = useAsync(() => api.get(`/appointments${qs({ date, status: status === 'All' ? '' : status, q: dq })}`), [date, status, dq]);
  const counts = useAsync(() => api.get(`/appointments${qs({ date })}`), [date, data]);

  const act = async (a, newStatus, label) => {
    setBusyId(a.id);
    try { await api.post(`/appointments/${a.id}/status`, { status: newStatus }); toast(label); reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusyId(null); setConfirm(null); }
  };
  const isToday = date === todayIso();
  const tally = (s) => (counts.data ? counts.data.filter((a) => a.status === s).length : 0);

  return (
    <>
      <PageHeader title="Appointments" subtitle={fmtDay(date)} actions={<Button icon={Plus} onClick={() => setModal(true)}>New appointment</Button>} />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="size-4" /></Button>
            <input type="date" aria-label="Choose date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
            <Button variant="secondary" size="sm" aria-label="Next day" onClick={() => setDate(addDays(date, 1))}><ChevronRight className="size-4" /></Button>
            {!isToday && <Button variant="ghost" size="sm" onClick={() => setDate(todayIso())}>Today</Button>}
          </div>
          <div className="relative w-full sm:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input type="search" aria-label="Search patients" placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-800" /></div>
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-4 py-3 dark:border-slate-800" role="tablist" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f} role="tab" aria-selected={status === f} onClick={() => setStatus(f)}
              className={cx('whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition', status === f ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300')}>
              {f}{f !== 'All' && counts.data ? <span className="ml-1.5 opacity-70">{tally(f)}</span> : f === 'All' && counts.data ? <span className="ml-1.5 opacity-70">{counts.data.length}</span> : null}
            </button>
          ))}
        </div>
        {error && <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && (
          <Table rows={data} empty={<Empty icon={CalendarX2} title="No appointments" hint={status === 'All' && !dq ? 'Nothing is booked for this day yet.' : 'No appointments match these filters.'} />}
            columns={[
              { key: 'time', header: 'Time', render: (a) => <span className="font-semibold tabular-nums">{a.time}</span> },
              { key: 'patient', header: 'Patient', render: (a) => <button className="text-left font-medium text-slate-900 hover:text-brand-700 dark:text-white" onClick={() => nav(`/patients/${a.patient_id}`)}>{a.patient_name}<span className="block text-xs font-normal text-slate-500">{a.patient_phone}</span></button> },
              ...(user.role === 'admin' ? [{ key: 'doctor', header: 'Doctor', render: (a) => a.doctor_name }] : []),
              { key: 'reason', header: 'Reason', className: 'hidden md:table-cell', render: (a) => a.reason || '—' },
              { key: 'source', header: 'Source', className: 'hidden lg:table-cell', render: (a) => <Badge tone={SOURCE[a.source]?.[1]}>{SOURCE[a.source]?.[0] || a.source}</Badge> },
              { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
              { key: 'act', header: 'Actions', className: 'text-right', render: (a) => (
                <div className="flex justify-end gap-1.5">
                  {a.status === 'Booked' && isToday && <Button size="sm" variant="soft" icon={LogIn} loading={busyId === a.id} onClick={() => act(a, 'Checked in', `${a.patient_name} checked in`)}>Check in</Button>}
                  {a.status === 'Booked' && <Button size="sm" variant="ghost" icon={UserX} onClick={() => setConfirm({ a, status: 'No-show' })}>No-show</Button>}
                  {a.status === 'Booked' && <Button size="sm" variant="ghost" icon={X} onClick={() => setConfirm({ a, status: 'Cancelled' })}>Cancel</Button>}
                  {a.status === 'Checked in' && user.role === 'doctor' && <Button size="sm" icon={Play} onClick={() => nav(`/consultation/${a.id}`)}>Start consultation</Button>}
                  {a.status === 'Completed' && user.role === 'doctor' && <Button size="sm" variant="secondary" icon={Eye} onClick={() => nav(`/consultation/${a.id}`)}>View</Button>}
                </div>) },
            ]} />
        )}
      </Card>
      <NewAppointment open={modal} onClose={() => setModal(false)} date={date} onSaved={(a) => { setModal(false); toast('Appointment booked'); if (a.date === date) reload(); else setDate(a.date); }} />
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={`${confirm?.status === 'Cancelled' ? 'Cancel' : 'Mark as no-show'}?`}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Keep appointment</Button><Button variant="danger" loading={busyId === confirm?.a.id} onClick={() => act(confirm.a, confirm.status, `Appointment ${confirm.status === 'Cancelled' ? 'cancelled' : 'marked as no-show'}`)}>Yes, {confirm?.status === 'Cancelled' ? 'cancel it' : 'mark no-show'}</Button></>}>
        <p className="text-slate-600 dark:text-slate-300">{confirm?.a.patient_name} at {confirm?.a.time}. This frees the slot and cannot be undone.</p>
      </Modal>
    </>
  );
}

function NewAppointment({ open, onClose, date: initialDate, onSaved }) {
  const { user } = useAuth();
  const doctors = useAsync(() => (open && user.role === 'admin' ? api.get('/doctors') : Promise.resolve([])), [open]);
  const [f, setF] = useState({ doctorId: '', date: initialDate, time: '', name: '', phone: '', reason: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [found, setFound] = useState(null);
  const doctorId = user.role === 'doctor' ? user.id : f.doctorId || doctors.data?.[0]?.id;
  const slots = useAsync(() => (open && doctorId && f.date ? api.get(`/slots${qs({ doctorId, date: f.date })}`) : Promise.resolve({ slots: [] })), [open, doctorId, f.date]);

  const lookup = async (phone) => {
    setFound(null);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) return;
    try { const list = await api.get(`/patients${qs({ q: digits })}`); setFound(list.find((p) => p.phone.replace(/\D/g, '') === digits) || null); } catch { /* optional lookup */ }
  };
  const save = async () => {
    if (!f.time) return setErr('Choose a time slot');
    setBusy(true); setErr('');
    try {
      const body = { doctorId: Number(doctorId), date: f.date, time: f.time, reason: f.reason || undefined, ...(found ? { patientId: found.id } : { name: f.name, phone: f.phone }) };
      onSaved(await api.post('/appointments', body)); setF({ ...f, time: '', name: '', phone: '', reason: '' }); setFound(null);
    } catch (e) { setErr(e.message); slots.reload(); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New appointment" wide footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={busy} onClick={save}>Book appointment</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {user.role === 'admin' && <Select label="Doctor" value={doctorId || ''} onChange={(e) => setF({ ...f, doctorId: e.target.value, time: '' })}>{(doctors.data || []).map((d) => <option key={d.id} value={d.id}>{d.name} · {d.specialty}</option>)}</Select>}
        <Input label="Date" type="date" min={todayIso()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value, time: '' })} />
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">Free slots</p>
        {slots.loading ? <Loading label="Checking availability…" /> : slots.data?.slots.length ? (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Time slot">
            {slots.data.slots.map((t) => <button key={t} role="radio" aria-checked={f.time === t} onClick={() => setF({ ...f, time: t })} className={cx('rounded-lg border px-3 py-1.5 text-sm font-medium tabular-nums transition', f.time === t ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 hover:border-brand-400 dark:border-slate-700')}>{t}</button>)}
          </div>
        ) : <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:bg-slate-800">No free slots on this day (the clinic is closed on Sundays).</p>}
      </div>
      <Input label="Patient phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => { setF({ ...f, phone: e.target.value }); lookup(e.target.value); }} placeholder="+1 555 123 4567" hint={found ? undefined : 'An existing patient is matched by phone number.'} />
      {found ? <p className="rounded-xl bg-brand-50 px-4 py-2.5 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-200">Existing patient: <b>{found.name}</b> — the appointment will be linked to their record.</p>
        : <Input label="Patient name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Full name (new patient)" />}
      <Input label="Reason (optional)" value={f.reason} maxLength={300} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
    </Modal>
  );
}
