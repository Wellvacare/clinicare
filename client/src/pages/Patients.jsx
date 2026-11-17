import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { api, qs, fmtDate } from '../api.js';
import { Card, Empty, ErrorBox, Loading, PageHeader, SearchInput, Table, useAsync, useDebounced } from '../ui.jsx';

export default function Patients() {
  const nav = useNavigate(); const [q, setQ] = useState(''); const dq = useDebounced(q);
  const { data, error, loading, reload } = useAsync(() => api.get(`/patients${qs({ q: dq })}`), [dq]);
  return (
    <>
      <PageHeader title="Patients" subtitle="Every patient's reports, prescriptions and visit history." actions={<SearchInput value={q} onChange={setQ} placeholder="Search name or phone" />} />
      <Card>
        {error && <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && (
          <Table rows={data} onRowClick={(p) => nav(`/patients/${p.id}`)} empty={<Empty icon={Users} title="No patients found" hint={dq ? 'Try another name or phone number.' : 'Patients appear here after their first booking.'} />}
            columns={[
              { key: 'name', header: 'Patient', render: (p) => <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">{p.name.slice(0, 1)}</span><span className="font-medium text-slate-900 dark:text-white">{p.name}</span></div> },
              { key: 'phone', header: 'Phone' },
              { key: 'visits', header: 'Visits', className: 'text-right tabular-nums' },
              { key: 'last_visit', header: 'Last visit', render: (p) => fmtDate(p.last_visit) },
            ]} />
        )}
      </Card>
    </>
  );
}
