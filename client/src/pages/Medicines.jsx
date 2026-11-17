import { useState } from 'react';
import { PackagePlus, Plus, Pencil, AlertTriangle, Boxes, Truck, Pill } from 'lucide-react';
import { api, qs, money, fmtDate, todayIso } from '../api.js';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Modal, PageHeader, SearchInput, Segmented, StatCard, StatusBadge, Table, useAsync, useDebounced, useToast } from '../ui.jsx';

const FILTERS = [{ value: '', label: 'All' }, { value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }, { value: 'expiring', label: 'Expiring soon' }];

export default function Medicines({ editable = false }) {
  const toast = useToast();
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [state, setState] = useState('');
  const [delivery, setDelivery] = useState(null); const [edit, setEdit] = useState(null); const [adding, setAdding] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.get(`/medicines${qs({ q: dq, state })}`), [dq, state]);
  const all = useAsync(() => api.get('/medicines'), [data]);
  const stats = all.data ? { total: all.data.length, low: all.data.filter((m) => m.state === 'low').length, out: all.data.filter((m) => m.state === 'out').length, exp: all.data.filter((m) => m.expiring).length } : null;

  return (
    <>
      <PageHeader title={editable ? 'Inventory' : 'Pharmacy stock'} subtitle={editable ? 'Live quantity of every medicine, updated on each sale and delivery.' : 'What the pharmacy holds right now, so you prescribe what the patient can collect today.'}
        actions={<>{<SearchInput value={q} onChange={setQ} placeholder="Search medicines" />}{editable && <Button icon={Plus} onClick={() => setAdding(true)}>New medicine</Button>}</>} />
      {stats && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Medicines" value={stats.total} icon={Pill} /><StatCard label="Low stock" value={stats.low} icon={AlertTriangle} tone="amber" />
          <StatCard label="Out of stock" value={stats.out} icon={Boxes} tone="rose" /><StatCard label="Expiring in 60 days" value={stats.exp} icon={Truck} tone="violet" />
        </div>
      )}
      <Card>
        <div className="border-b border-slate-100 p-4 dark:border-slate-800"><Segmented label="Stock filter" options={FILTERS} value={state} onChange={setState} /></div>
        {error && <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div>}
        {loading && !data ? <Loading /> : data && (
          <Table rows={data} empty={<Empty icon={Boxes} title="No medicines found" hint={dq || state ? 'Try different filters.' : 'Add the first medicine to start tracking stock.'} />}
            columns={[
              { key: 'name', header: 'Medicine', render: (m) => <span className="font-medium text-slate-900 dark:text-white">{m.name}</span> },
              { key: 'stock', header: 'In stock', render: (m) => <span className="tabular-nums"><b>{m.stock}</b> <span className="text-slate-500">{m.unit}</span></span> },
              { key: 'state', header: 'Status', render: (m) => <span className="flex flex-wrap gap-1"><StatusBadge status={m.state} />{m.expired ? <Badge tone="red">Expired</Badge> : m.expiring && <Badge tone="violet">Expires {fmtDate(m.expiry_date, { month: 'short', year: 'numeric' })}</Badge>}</span> },
              { key: 'reorder_level', header: 'Reorder at', className: 'hidden md:table-cell tabular-nums' },
              ...(editable ? [
                { key: 'price', header: 'Price', className: 'hidden md:table-cell', render: (m) => money(m.price) },
                { key: 'a', header: '', className: 'text-right', render: (m) => <div className="flex justify-end gap-1.5"><Button size="sm" variant="soft" icon={PackagePlus} onClick={() => setDelivery(m)}>Delivery</Button><Button size="sm" variant="ghost" aria-label={`Edit ${m.name}`} icon={Pencil} onClick={() => setEdit(m)} /></div> },
              ] : []),
            ]} />
        )}
      </Card>
      {editable && <>
        <DeliveryModal med={delivery} onClose={() => setDelivery(null)} onDone={(m) => { setDelivery(null); toast(`${m.name} is now at ${m.stock} ${m.unit}`); reload(); }} />
        <EditModal med={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); toast('Medicine updated'); reload(); }} />
        <NewModal open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); toast('Medicine added'); reload(); }} />
      </>}
    </>
  );
}

function DeliveryModal({ med, onClose, onDone }) {
  const [qty, setQty] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => {
    const n = Number(qty); if (!Number.isInteger(n) || n <= 0) return setErr('Enter a whole number above zero');
    setBusy(true); setErr('');
    try { onDone(await api.post(`/medicines/${med.id}/deliveries`, { quantity: n })); setQty(''); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!med} onClose={onClose} title={`Record delivery · ${med?.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Add to stock</Button></>}>
      <p className="text-sm text-slate-500">Currently <b>{med?.stock}</b> {med?.unit} in stock.</p>
      <Input label={`Quantity received (${med?.unit})`} type="number" min="1" step="1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      {qty && Number(qty) > 0 && <p className="text-sm text-brand-700 dark:text-brand-300">New stock will be <b>{(med?.stock || 0) + Number(qty)}</b> {med?.unit}.</p>}
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
    </Modal>
  );
}

function EditModal({ med, onClose, onDone }) {
  const [f, setF] = useState(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  if (med && (!f || f.id !== med.id)) setF({ id: med.id, reorderLevel: med.reorder_level, price: med.price, expiryDate: med.expiry_date || '' });
  const save = async () => {
    const reorderLevel = Number(f.reorderLevel); const price = Number(f.price);
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) return setErr('Reorder level must be zero or more');
    if (!(price >= 0)) return setErr('Price must be zero or more');
    setBusy(true); setErr('');
    try { await api.patch(`/medicines/${med.id}`, { reorderLevel, price, expiryDate: f.expiryDate || null }); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!med && !!f} onClose={onClose} title={`Edit · ${med?.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      {f && <>
        <Input label="Reorder level" type="number" min="0" value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} hint="The medicine is flagged as low stock at or below this quantity." />
        <Input label="Price per unit (USD)" type="number" min="0" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        <Input label="Expiry date" type="date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} />
        {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
      </>}
    </Modal>
  );
}

function NewModal({ open, onClose, onDone }) {
  const blank = { name: '', unit: 'strips', stock: '0', reorderLevel: '20', price: '0', expiryDate: '' };
  const [f, setF] = useState(blank); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { await api.post('/medicines', { name: f.name, unit: f.unit, stock: Number(f.stock), reorderLevel: Number(f.reorderLevel), price: Number(f.price), expiryDate: f.expiryDate || null }); setF(blank); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title="New medicine" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Add medicine</Button></>}>
      <Input label="Name" value={f.name} onChange={set('name')} placeholder="e.g. Paracetamol 500 mg" />
      <div className="grid grid-cols-2 gap-4"><Input label="Unit" value={f.unit} onChange={set('unit')} /><Input label="Opening stock" type="number" min="0" value={f.stock} onChange={set('stock')} /></div>
      <div className="grid grid-cols-2 gap-4"><Input label="Reorder level" type="number" min="0" value={f.reorderLevel} onChange={set('reorderLevel')} /><Input label="Price (USD)" type="number" min="0" step="0.01" value={f.price} onChange={set('price')} /></div>
      <Input label="Expiry date (optional)" type="date" min={todayIso()} value={f.expiryDate} onChange={set('expiryDate')} />
      {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
    </Modal>
  );
}
