import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BellRing, FileText, Phone, Mail, Pill, Stethoscope } from 'lucide-react';
import { api, fmtDate } from '../api.js';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Loading, StatusBadge, useAsync, useToast } from '../ui.jsx';

export default function PatientRecord() {
  const { id } = useParams(); const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.get(`/patients/${id}`), [id]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { patient, visits, followups } = data;
  const done = visits.filter((v) => v.status === 'Completed');
  const open = async (r) => {
    try { const res = await api.file(`/reports/${r.id}/file`); const url = URL.createObjectURL(await res.blob()); window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <>
      <div className="mb-4"><Link to="/patients" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-700"><ArrowLeft className="size-4" />Patients</Link></div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit p-6">
          <div className="flex flex-col items-center text-center">
            <span className="grid size-20 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-3xl font-bold text-white">{patient.name.slice(0, 1)}</span>
            <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">{patient.name}</h1>
            <p className="text-sm text-slate-500">{[patient.gender, patient.dob && `born ${fmtDate(patient.dob)}`].filter(Boolean).join(' · ') || 'Details not recorded'}</p>
          </div>
          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex items-center gap-3"><Phone className="size-4 text-slate-400" />{patient.phone}</div>
            {patient.email && <div className="flex items-center gap-3"><Mail className="size-4 text-slate-400" />{patient.email}</div>}
            <div className="flex items-center gap-3"><Stethoscope className="size-4 text-slate-400" />{done.length} completed visit{done.length === 1 ? '' : 's'}</div>
          </dl>
          {patient.allergies && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"><b>Allergies:</b> {patient.allergies}</p>}
          {followups.map((f) => <p key={f.id} className="mt-4 flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:bg-brand-900/30 dark:text-brand-200"><BellRing className="size-4" />Follow-up due {fmtDate(f.due_date)}</p>)}
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Visit history <span className="text-sm font-normal text-slate-500">newest first</span></h2>
          {visits.length === 0 && <Card><Empty title="No visits yet" /></Card>}
          {visits.map((v) => (
            <Card key={v.id} className="anim-in">
              <CardHeader title={v.diagnosis || (v.status === 'Completed' ? 'Visit' : v.reason || 'Appointment')} subtitle={`${fmtDate(v.date)} · ${v.time} · ${v.doctor_name}`} action={<StatusBadge status={v.status} />} />
              <div className="space-y-4 p-5 text-sm">
                {v.notes && <p className="text-slate-600 dark:text-slate-300">{v.notes}</p>}
                {v.prescription && (
                  <div>
                    <p className="mb-2 flex items-center gap-2 font-medium"><Pill className="size-4 text-violet-600" />Prescription <Badge tone={v.prescription.status === 'Collected' ? 'green' : 'amber'}>{v.prescription.status}</Badge></p>
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">{v.prescription.items.map((i) => (
                      <li key={i.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5"><span className="font-medium">{i.medicine_name}</span><span className="text-slate-500">{i.dose} · {i.duration} · qty {i.quantity}</span></li>))}</ul>
                  </div>
                )}
                {v.reports.length > 0 && (
                  <div><p className="mb-2 flex items-center gap-2 font-medium"><FileText className="size-4 text-brand-600" />Reports</p>
                    <div className="flex flex-wrap gap-2">{v.reports.map((r) => <Button key={r.id} size="sm" variant="secondary" icon={FileText} onClick={() => open(r)}>{r.title}</Button>)}</div></div>
                )}
                {!v.notes && !v.prescription && !v.reports.length && <p className="text-slate-400">{v.status === 'Completed' ? 'No further details recorded.' : 'No clinical details yet.'}</p>}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
