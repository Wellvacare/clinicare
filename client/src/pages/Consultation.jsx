import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, Paperclip, Pill, Plus, Printer, Save, Search, Trash2, Upload, History, BellRing, LogIn } from 'lucide-react';
import { api, qs, fmtDate, fmtDay, addDays, todayIso } from '../api.js';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Input, Loading, StatusBadge, Textarea, useAsync, useDebounced, useToast, cx } from '../ui.jsx';

const FOLLOWUPS = [['None', null], ['1 week', 7], ['2 weeks', 14], ['1 month', 30]];

export default function Consultation() {
  const { id } = useParams(); const nav = useNavigate(); const toast = useToast();
  const { data: appt, error, loading, reload } = useAsync(() => api.get(`/appointments/${id}`), [id]);
  const [form, setForm] = useState(null); const [items, setItems] = useState([]); const [rxDirty, setRxDirty] = useState(false);
  const [busy, setBusy] = useState(''); const [fuMode, setFuMode] = useState('None');

  useEffect(() => {
    if (!appt) return;
    setForm({ diagnosis: appt.diagnosis || '', notes: appt.notes || '', followupDate: appt.followup_date || '' });
    setItems((appt.prescription?.items || []).map((i) => ({ medicineId: i.medicine_id, name: i.medicine_name, unit: i.unit, stock: i.stock, state: i.state, dose: i.dose, duration: i.duration, quantity: i.quantity })));
    setRxDirty(false);
    const fu = appt.followup_date; const diff = fu ? Math.round((new Date(fu) - new Date(appt.date)) / 86400000) : null;
    setFuMode(!fu ? 'None' : { 7: '1 week', 14: '2 weeks', 30: '1 month' }[diff] || 'Custom');
  }, [appt]);

  if (loading && !appt) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!appt || !form) return null;

  const editable = appt.status === 'Checked in';
  const rxLocked = appt.prescription?.status === 'Collected';
  const patient = appt.record.patient;
  const past = appt.record.visits.filter((v) => v.id !== appt.id && v.status === 'Completed');

  const validateItems = () => items.every((i) => i.dose.trim() && i.duration.trim() && Number.isInteger(i.quantity) && i.quantity > 0);
  const saveRx = async () => {
    if (!validateItems()) { toast('Fill dose, duration and quantity for every medicine', 'error'); return false; }
    setBusy('rx');
    try {
      await api.put(`/appointments/${id}/prescription`, { items: items.map(({ medicineId, dose, duration, quantity }) => ({ medicineId, dose: dose.trim(), duration: duration.trim(), quantity })) });
      toast(items.length ? 'Prescription saved and sent to the pharmacy' : 'Prescription removed'); setRxDirty(false); reload(); return true;
    } catch (e) { toast(e.message, 'error'); return false; } finally { setBusy(''); }
  };
  const saveDraft = async () => {
    setBusy('draft');
    try { await api.patch(`/appointments/${id}/consultation`, { diagnosis: form.diagnosis, notes: form.notes, followupDate: form.followupDate || null }); toast('Draft saved'); reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const complete = async () => {
    if (!form.diagnosis.trim()) return toast('Please record a diagnosis first', 'error');
    if (rxDirty && !rxLocked && !(await saveRx())) return;
    setBusy('done');
    try {
      await api.post(`/appointments/${id}/status`, { status: 'Completed', diagnosis: form.diagnosis, notes: form.notes, followupDate: form.followupDate || null });
      toast(form.followupDate ? 'Consultation completed. A follow-up reminder is scheduled.' : 'Consultation completed'); nav('/appointments');
    } catch (e) { toast(e.message, 'error'); setBusy(''); }
  };
  const checkIn = async () => {
    try { await api.post(`/appointments/${id}/status`, { status: 'Checked in' }); toast('Patient checked in'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const pickFollowup = (label, days) => {
    setFuMode(label); setForm({ ...form, followupDate: days ? addDays(todayIso(), days) : '' });
  };

  return (
    <>
      <div className="no-print mb-4"><Link to="/appointments" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-700"><ArrowLeft className="size-4" />Appointments</Link></div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="grid size-14 place-items-center rounded-2xl bg-brand-100 text-xl font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">{patient.name.slice(0, 1)}</span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{patient.name}</h1>
            <p className="text-sm text-slate-500">{patient.phone}{patient.gender ? ` · ${patient.gender}` : ''}{patient.dob ? ` · born ${fmtDate(patient.dob)}` : ''}</p>
            <p className="mt-1 text-sm text-slate-500">{fmtDay(appt.date)} at {appt.time}{appt.reason ? ` · ${appt.reason}` : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2"><StatusBadge status={appt.status} />{appt.prescription && <Button variant="secondary" size="sm" icon={Printer} className="no-print" onClick={() => window.print()}>Print</Button>}</div>
      </div>

      {appt.status === 'Booked' && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-sm text-amber-900 dark:text-amber-200">This patient has not checked in yet.</p>
          {appt.date === todayIso() && <Button size="sm" icon={LogIn} onClick={checkIn}>Check in now</Button>}
        </Card>
      )}
      {patient.allergies && <div role="alert" className="mb-6 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"><AlertTriangle className="size-4" />Allergies: {patient.allergies}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Consultation" subtitle="Diagnosis and clinical notes" />
            <div className="space-y-4 p-5">
              <Input label="Diagnosis" value={form.diagnosis} disabled={!editable} maxLength={2000} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} placeholder="e.g. Viral fever" />
              <Textarea label="Notes" rows={4} value={form.notes} disabled={!editable} maxLength={5000} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Symptoms, examination findings, advice…" />
            </div>
          </Card>

          <Prescription items={items} setItems={(v) => { setItems(v); setRxDirty(true); }} editable={editable && !rxLocked} locked={rxLocked} slip={appt.prescription} dirty={rxDirty} busy={busy === 'rx'} onSave={saveRx} />
          <Reports appt={appt} editable={editable || appt.status === 'Completed'} onChange={reload} />

          <Card>
            <CardHeader title="Follow-up" subtitle="The patient is reminded 1 day before the due date" />
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-2">
                {[...FOLLOWUPS.map(([l, d]) => [l, d]), ['Custom', 'x']].map(([label, days]) => (
                  <button key={label} disabled={!editable} onClick={() => (days === 'x' ? setFuMode('Custom') : pickFollowup(label, days))}
                    className={cx('rounded-full px-4 py-1.5 text-sm font-medium transition disabled:opacity-60', fuMode === label ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300')}>{label}</button>
                ))}
              </div>
              {fuMode === 'Custom' && <Input label="Follow-up date" type="date" min={addDays(todayIso(), 1)} value={form.followupDate} disabled={!editable} onChange={(e) => setForm({ ...form, followupDate: e.target.value })} />}
              {form.followupDate && <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><BellRing className="size-4 text-brand-600" />Follow-up on <b>{fmtDay(form.followupDate)}</b>. Reminder goes out the day before.</p>}
            </div>
          </Card>

          {editable && (
            <div className="no-print sticky bottom-3 z-10 flex flex-wrap justify-end gap-3 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
              <Button variant="secondary" icon={Save} loading={busy === 'draft'} onClick={saveDraft}>Save draft</Button>
              <Button icon={CheckCircle2} loading={busy === 'done'} onClick={complete}>End consultation</Button>
            </div>
          )}
        </div>

        <div className="no-print space-y-6">
          <Card>
            <CardHeader title="Patient history" subtitle={`${past.length} past visit${past.length === 1 ? '' : 's'}`} />
            {past.length ? (
              <ol className="relative space-y-5 p-5 before:absolute before:left-[26px] before:top-6 before:h-[calc(100%-48px)] before:w-px before:bg-slate-200 dark:before:bg-slate-800">
                {past.slice(0, 6).map((v) => (
                  <li key={v.id} className="relative pl-8">
                    <span className="absolute left-0 top-1 grid size-5 place-items-center rounded-full bg-brand-100 text-brand-700 ring-4 ring-white dark:bg-brand-900 dark:ring-slate-900"><History className="size-3" /></span>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{v.diagnosis || 'Visit'}</p>
                    <p className="text-xs text-slate-500">{fmtDate(v.date)} · {v.doctor_name}</p>
                    {v.prescription && <p className="mt-1 flex flex-wrap gap-1">{v.prescription.items.map((i) => <Badge key={i.id} tone="violet">{i.medicine_name}</Badge>)}</p>}
                    {v.reports.length > 0 && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Paperclip className="size-3" />{v.reports.length} report{v.reports.length > 1 ? 's' : ''}</p>}
                  </li>
                ))}
              </ol>
            ) : <Empty icon={History} title="First visit" hint="No earlier visits on record." />}
            <div className="border-t border-slate-100 p-3 text-center dark:border-slate-800"><Link className="text-sm font-medium text-brand-700 hover:underline" to={`/patients/${patient.id}`}>Open full record</Link></div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Prescription({ items, setItems, editable, locked, slip, dirty, busy, onSave }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 200); const [focus, setFocus] = useState(false);
  const results = useAsync(() => (editable && focus ? api.get(`/medicines${qs({ q: dq })}`) : Promise.resolve([])), [dq, editable, focus]);
  const boxRef = useRef(null);
  useEffect(() => {
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setFocus(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, []);
  const add = (m) => {
    if (items.some((i) => i.medicineId === m.id)) { setQ(''); setFocus(false); return; }
    setItems([...items, { medicineId: m.id, name: m.name, unit: m.unit, stock: m.stock, state: m.state, dose: '1 tablet twice daily', duration: '5 days', quantity: 1 }]);
    setQ(''); setFocus(false);
  };
  const upd = (idx, patch) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const outOfStock = items.filter((i) => i.state === 'out');

  return (
    <Card>
      <CardHeader title="Prescription" subtitle="Stock left is shown live so you prescribe what the patient can collect today"
        action={slip && <Badge tone={slip.status === 'Collected' ? 'green' : 'amber'}>{slip.status === 'Collected' ? 'Collected at pharmacy' : 'Slip sent · awaiting collection'}</Badge>} />
      <div className="space-y-4 p-5">
        {editable && (
          <div className="relative" ref={boxRef}>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input aria-label="Search medicines" value={q} onFocus={() => setFocus(true)} onChange={(e) => { setQ(e.target.value); setFocus(true); }} placeholder="Search medicine, e.g. Paracetamol"
              className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800" />
            {focus && (
              <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                {results.loading && !results.data?.length ? <li className="px-3 py-2 text-sm text-slate-500">Searching…</li> : results.data?.length ? results.data.map((m) => (
                  <li key={m.id}><button onClick={() => add(m)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700">
                    <span className="font-medium">{m.name}</span>
                    <span className={cx('whitespace-nowrap text-xs font-medium', m.state === 'out' ? 'text-rose-600' : m.state === 'low' ? 'text-amber-600' : 'text-emerald-600')}>{m.state === 'out' ? 'Out of stock' : `${m.stock} ${m.unit} in stock${m.state === 'low' ? ' · low' : ''}`}</span>
                  </button></li>)) : <li className="px-3 py-2 text-sm text-slate-500">No medicine found.</li>}
              </ul>
            )}
          </div>
        )}
        {items.length === 0 ? <Empty icon={Pill} title="No medicines added" hint={editable ? 'Search above to add medicines to this prescription.' : 'No prescription was issued for this visit.'} />
          : (
            <ul className="space-y-3">
              {items.map((it, idx) => (
                <li key={it.medicineId} className="rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="font-medium text-slate-900 dark:text-white">{it.name}</p>
                    <div className="flex items-center gap-2">
                      <span className={cx('text-xs font-medium', it.state === 'out' ? 'text-rose-600' : it.state === 'low' ? 'text-amber-600' : 'text-slate-500')}>{it.state === 'out' ? 'Out of stock' : `${it.stock} ${it.unit} left`}</span>
                      {editable && <button aria-label={`Remove ${it.name}`} onClick={() => setItems(items.filter((_, i) => i !== idx))} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button>}
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_90px]">
                    <Input label="Dose" value={it.dose} disabled={!editable} onChange={(e) => upd(idx, { dose: e.target.value })} />
                    <Input label="Duration" value={it.duration} disabled={!editable} onChange={(e) => upd(idx, { duration: e.target.value })} />
                    <Input label="Qty" type="number" min="1" max="10000" value={it.quantity} disabled={!editable} onChange={(e) => upd(idx, { quantity: Number(e.target.value) })} />
                  </div>
                  {it.state !== 'out' && it.quantity > it.stock && <p className="mt-2 text-xs font-medium text-amber-600">Only {it.stock} {it.unit} in stock. The patient may need to collect the rest later.</p>}
                </li>
              ))}
            </ul>
          )}
        {outOfStock.length > 0 && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /><span><b>Out of stock:</b> {outOfStock.map((i) => i.name).join(', ')}. You can still prescribe it or choose another medicine.</span>
          </div>
        )}
        {locked && <p className="text-sm text-slate-500">This prescription has been collected and can no longer be edited.</p>}
        {editable && dirty && <div className="flex justify-end"><Button icon={Pill} loading={busy} onClick={onSave}>{items.length ? 'Save & send to pharmacy' : 'Save changes'}</Button></div>}
      </div>
    </Card>
  );
}

function Reports({ appt, editable, onChange }) {
  const toast = useToast(); const input = useRef(null); const [busy, setBusy] = useState(false); const [title, setTitle] = useState('');
  const upload = async (file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return toast('Files can be at most 8 MB', 'error');
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) return toast('Only PDF, PNG or JPG files are allowed', 'error');
    setBusy(true);
    try {
      const dataBase64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
      await api.post(`/appointments/${appt.id}/reports`, { title: title.trim() || file.name, filename: file.name, mime: file.type, dataBase64 });
      toast('Report attached to this visit'); setTitle(''); onChange();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const open = async (r) => {
    try { const res = await api.file(`/reports/${r.id}/file`); const url = URL.createObjectURL(await res.blob()); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Card className="no-print">
      <CardHeader title="Lab reports" subtitle="Attached to this visit in the patient's history" />
      <div className="space-y-3 p-5">
        {appt.reports.length > 0 && <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">{appt.reports.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="flex min-w-0 items-center gap-3"><FileText className="size-4 shrink-0 text-brand-600" /><span className="truncate font-medium">{r.title}</span><span className="text-xs text-slate-400">{Math.max(1, Math.round(r.size / 1024))} KB</span></span><Button size="sm" variant="ghost" onClick={() => open(r)}>View</Button></li>))}</ul>}
        {editable ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1"><Input label="Report title (optional)" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Complete blood count" /></div>
            <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => upload(e.target.files?.[0])} aria-label="Choose report file" />
            <Button variant="secondary" icon={Upload} loading={busy} onClick={() => input.current?.click()}>Upload report</Button>
          </div>
        ) : !appt.reports.length && <p className="text-sm text-slate-500">No reports attached.</p>}
        <p className="text-xs text-slate-400">PDF, PNG or JPG, up to 8 MB.</p>
      </div>
    </Card>
  );
}
