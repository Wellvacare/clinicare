import { useState } from 'react';
import { BellRing, MessageSquare, Send } from 'lucide-react';
import { api, fmtDate, fmtDateTime } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Loading, PageHeader, Segmented, useAsync, useToast } from '../ui.jsx';

const FU_TONE = { Scheduled: 'blue', Reminded: 'amber', Booked: 'green', Cancelled: 'slate' };
const KIND = { confirmation: ['Confirmation', 'green'], reminder: ['Follow-up reminder', 'violet'] };

export default function Notifications() {
  const { user } = useAuth(); const toast = useToast(); const [tab, setTab] = useState('followups'); const [busy, setBusy] = useState(false);
  const fu = useAsync(() => api.get('/followups'), []); const out = useAsync(() => api.get('/outbox'), []);
  const run = async () => {
    setBusy(true);
    try { const r = await api.post('/followups/run'); toast(r.sent ? `${r.sent} reminder${r.sent > 1 ? 's' : ''} sent` : 'No reminders are due right now'); fu.reload(); out.reload(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Reminders & messages" subtitle="Follow-ups waiting to be booked, and every message sent to patients."
        actions={<>
          <Segmented label="View" options={[{ value: 'followups', label: 'Follow-ups' }, { value: 'messages', label: 'Messages' }]} value={tab} onChange={setTab} />
          {user.role === 'admin' && <Button variant="secondary" icon={Send} loading={busy} onClick={run}>Send due reminders now</Button>}
        </>} />
      {tab === 'followups' ? (
        <Card>
          <CardHeader title="Follow-ups" subtitle="A reminder goes out 1 day before the due date. Booking stops further reminders." />
          {fu.error && <div className="p-4"><ErrorBox error={fu.error} onRetry={fu.reload} /></div>}
          {fu.loading && !fu.data ? <Loading /> : fu.data && (fu.data.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">{fu.data.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
                <div><p className="font-medium text-slate-900 dark:text-white">{f.patient_name}</p><p className="text-xs text-slate-500">Due {fmtDate(f.due_date)} · reminder {fmtDateTime(f.remind_at)}</p></div>
                <Badge tone={FU_TONE[f.status]}>{f.status === 'Booked' ? 'Booked ✓' : f.status}</Badge>
              </li>))}</ul>
          ) : <Empty icon={BellRing} title="No follow-ups yet" hint="Set a follow-up date when you end a consultation." />)}
        </Card>
      ) : (
        <Card>
          <CardHeader title="Message log" subtitle="Booking confirmations and reminders (SMS)" />
          {out.error && <div className="p-4"><ErrorBox error={out.error} onRetry={out.reload} /></div>}
          {out.loading && !out.data ? <Loading /> : out.data && (out.data.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">{out.data.map((m) => (
              <li key={m.id} className="px-5 py-3.5 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone={KIND[m.kind]?.[1]}>{KIND[m.kind]?.[0] || m.kind}</Badge><span className="font-medium">{m.patient_name}</span><span className="text-slate-400">{m.to_phone}</span><span className="ml-auto text-xs text-slate-400">{fmtDateTime(m.created_at)}</span></div>
                <p className="text-slate-600 dark:text-slate-300">{m.body}</p>
              </li>))}</ul>
          ) : <Empty icon={MessageSquare} title="No messages yet" />)}
        </Card>
      )}
    </>
  );
}
