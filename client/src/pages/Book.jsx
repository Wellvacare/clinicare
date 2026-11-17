import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bot, CalendarCheck, Mic, MicOff, MessageCircle, PhoneOff, Send, Volume2, User, ArrowLeft, Phone } from 'lucide-react';
import { api, fmtDay } from '../api.js';
import { Button, Card, ErrorBox, Loading, Select, Segmented, cx, useAsync } from '../ui.jsx';
import { Logo, ThemeButton } from '../Layout.jsx';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

export default function Book() {
  const [params] = useSearchParams();
  const doctors = useAsync(() => api.get('/public/doctors'), []);
  const [doctorId, setDoctorId] = useState(''); const [mode, setMode] = useState('chat');
  useEffect(() => { if (doctors.data?.length && !doctorId) setDoctorId(String(doctors.data[0].id)); }, [doctors.data, doctorId]);
  const doctor = doctors.data?.find((d) => String(d.id) === doctorId);

  return (
    <div className="min-h-full bg-gradient-to-b from-brand-50 via-slate-50 to-slate-50 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4"><Logo /><div className="flex items-center gap-1"><Link to="/login" className="rounded-xl px-3 py-2 text-sm text-slate-500 hover:bg-white dark:hover:bg-slate-800">Staff sign in</Link><ThemeButton /></div></header>
      <main className="mx-auto max-w-3xl px-4 pb-16">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Book your appointment</h1>
          <p className="mt-2 text-slate-500">Chat with our assistant or speak to it. No waiting for reception.</p>
        </div>
        {doctors.error && <ErrorBox error={doctors.error} onRetry={doctors.reload} />}
        {doctors.loading && !doctors.data ? <Loading /> : doctors.data && (
          doctors.data.length === 0 ? <p className="text-center text-slate-500">Online booking is not available right now.</p> : (
            <>
              <div className="mb-4 flex flex-wrap items-end justify-center gap-4">
                <div className="min-w-60"><Select label="Doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>{doctors.data.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.specialty}</option>)}</Select></div>
                <Segmented label="Booking channel" value={mode} onChange={setMode} options={[{ value: 'chat', label: '💬 Chat' }, { value: 'voice', label: '🎙️ Voice' }]} />
              </div>
              {doctorId && <Assistant key={`${doctorId}-${mode}`} doctorId={Number(doctorId)} doctor={doctor} mode={mode} prefillDate={params.get('date')} />}
            </>
          )
        )}
        <p className="mt-6 text-center text-xs text-slate-400">Your phone number is only used to confirm this booking.</p>
      </main>
    </div>
  );
}

function Assistant({ doctorId, doctor, mode, prefillDate }) {
  const voice = mode === 'voice';
  const [msgs, setMsgs] = useState([]); const [options, setOptions] = useState([]); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [booked, setBooked] = useState(null); const [error, setError] = useState('');
  const stateRef = useRef({ doctorId, source: voice ? 'voice' : 'chat', ...(prefillDate && /^\d{4}-\d{2}-\d{2}$/.test(prefillDate) ? { prefillDate } : {}) });
  const endRef = useRef(null);
  const [listening, setListening] = useState(false); const [live, setLive] = useState(''); const [callOn, setCallOn] = useState(false);
  const recRef = useRef(null); const callRef = useRef(false); const turnRef = useRef(() => {});

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, busy, live]);

  const stopListening = useCallback(() => { try { recRef.current?.abort(); } catch { /* ignore */ } recRef.current = null; setListening(false); setLive(''); }, []);
  const listen = useCallback(() => {
    if (!SR || !callRef.current) return;
    const rec = new SR(); recRef.current = rec; rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (e) => { let interim = ''; for (const r of e.results) { if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; } setLive(finalText + interim); };
    rec.onerror = (e) => { setListening(false); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { setError('Microphone access was blocked. Allow the microphone in your browser, or switch to Chat.'); callRef.current = false; setCallOn(false); } };
    rec.onend = () => { setListening(false); setLive(''); if (finalText.trim()) turnRef.current(finalText.trim()); else if (callRef.current) setTimeout(() => callRef.current && listen(), 400); };
    try { rec.start(); setListening(true); } catch { /* already started */ }
  }, []);

  const speak = useCallback((t, then) => {
    if (!canSpeak || !callRef.current) { then?.(); return; }
    const u = new SpeechSynthesisUtterance(t); u.lang = 'en-US'; u.rate = 1;
    u.onend = () => then?.(); u.onerror = () => then?.();
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  }, []);

  const turn = useCallback(async (userText) => {
    setError(''); setOptions([]);
    if (userText) setMsgs((m) => [...m, { from: 'me', text: userText }]);
    setBusy(true);
    try {
      const r = await api.post('/public/bot', { text: userText, state: stateRef.current });
      stateRef.current = r.state; setMsgs((m) => [...m, { from: 'bot', text: r.reply }]); setOptions(r.options || []);
      if (r.booked) { setBooked(r.booked); callRef.current = false; setCallOn(false); speak(r.reply); }
      else if (callRef.current) speak(r.reply, () => callRef.current && listen());
    } catch (e) { setError(e.message); if (callRef.current) setTimeout(() => callRef.current && listen(), 800); } finally { setBusy(false); }
  }, [listen, speak]);
  turnRef.current = turn;

  useEffect(() => { turn(''); return () => { callRef.current = false; try { recRef.current?.abort(); window.speechSynthesis?.cancel(); } catch { /* ignore */ } }; }, []); // eslint-disable-line

  const submit = (e) => { e.preventDefault(); const t = text.trim(); if (!t || busy) return; setText(''); turn(t); };
  const startCall = () => { callRef.current = true; setCallOn(true); setError(''); const last = msgs.filter((m) => m.from === 'bot').at(-1); if (last) speak(last.text, () => callRef.current && listen()); else listen(); };
  const endCall = () => { callRef.current = false; setCallOn(false); stopListening(); window.speechSynthesis?.cancel(); };

  if (booked) {
    return (
      <Card className="anim-in p-8 text-center">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40"><CalendarCheck className="size-8" /></div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">You're booked!</h2>
        <p className="mt-2 text-slate-600 dark:text-slate-300">{booked.patient}, your appointment with <b>{booked.doctor}</b> is on</p>
        <p className="mt-1 text-xl font-semibold text-brand-700 dark:text-brand-300">{fmtDay(booked.date)} at {booked.time}</p>
        <p className="mt-4 text-sm text-slate-500">A confirmation message has been sent to your phone.</p>
        <Button className="mt-6" variant="secondary" onClick={() => location.reload()}>Book another appointment</Button>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-5 py-3.5 dark:border-slate-800 dark:bg-slate-900">
        <span className="grid size-10 place-items-center rounded-full bg-brand-600 text-white"><Bot className="size-5" /></span>
        <div><p className="font-semibold text-slate-900 dark:text-white">Booking assistant</p><p className="text-xs text-slate-500">{doctor ? `For ${doctor.name}` : ''} · usually replies instantly</p></div>
      </div>

      <div className="h-[380px] space-y-3 overflow-y-auto bg-slate-50/70 p-4 dark:bg-slate-950/40" aria-live="polite" role="log">
        {msgs.map((m, i) => (
          <div key={i} className={cx('flex items-end gap-2', m.from === 'me' && 'flex-row-reverse')}>
            <span className={cx('grid size-7 shrink-0 place-items-center rounded-full', m.from === 'me' ? 'bg-slate-300 text-slate-700' : 'bg-brand-100 text-brand-700')}>{m.from === 'me' ? <User className="size-4" /> : <Bot className="size-4" />}</span>
            <p className={cx('anim-in max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm', m.from === 'me' ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-white text-slate-800 shadow-sm dark:bg-slate-800 dark:text-slate-100')}>{m.text}</p>
          </div>
        ))}
        {live && <div className="flex flex-row-reverse"><p className="max-w-[80%] rounded-2xl rounded-br-md bg-brand-600/60 px-4 py-2.5 text-sm italic text-white">{live}</p></div>}
        {busy && <div className="flex items-center gap-2 pl-9 text-slate-400" aria-label="Assistant is typing"><span className="size-2 animate-bounce rounded-full bg-current" /><span className="size-2 animate-bounce rounded-full bg-current [animation-delay:.15s]" /><span className="size-2 animate-bounce rounded-full bg-current [animation-delay:.3s]" /></div>}
        <div ref={endRef} />
      </div>

      {error && <div className="px-4 pt-3"><ErrorBox error={{ message: error }} /></div>}
      {options.length > 0 && !callOn && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">{options.map((o) => <button key={o.value} disabled={busy} onClick={() => turn(o.value)} className="rounded-full border border-brand-200 bg-brand-50 px-3.5 py-1.5 text-sm font-medium text-brand-800 transition hover:bg-brand-100 disabled:opacity-50 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-100">{o.label}</button>)}</div>
      )}

      {voice ? (
        <div className="flex flex-col items-center gap-3 p-5">
          {!SR ? <p className="rounded-xl bg-amber-50 px-4 py-3 text-center text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Voice needs a browser with speech recognition (Chrome, Edge or Safari). You can still type below, or use Chat.</p> : callOn ? (
            <>
              <button onClick={endCall} aria-label="End voice call" className={cx('grid size-16 place-items-center rounded-full bg-rose-600 text-white shadow-lg', listening && 'pulse-ring')}><PhoneOff className="size-7" /></button>
              <p className="flex items-center gap-2 text-sm text-slate-500">{busy ? 'Thinking…' : listening ? <><Mic className="size-4 text-brand-600" />Listening… speak now</> : <><Volume2 className="size-4" />Assistant is speaking…</>}</p>
            </>
          ) : (
            <><button onClick={startCall} aria-label="Start voice call" className="grid size-16 place-items-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 transition hover:bg-brand-700"><Phone className="size-7" /></button>
              <p className="text-sm text-slate-500">Tap to talk to the assistant. Allow the microphone when asked.</p></>
          )}
          <form onSubmit={submit} className="flex w-full gap-2">
            <input aria-label="Type instead" value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type your answer…" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
            <Button type="submit" icon={Send} disabled={!text.trim() || busy}>Send</Button>
          </form>
        </div>
      ) : (
        <form onSubmit={submit} className="flex gap-2 p-4">
          <input aria-label="Your message" autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="e.g. Tomorrow morning" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800" />
          <Button type="submit" icon={Send} disabled={!text.trim() || busy}>Send</Button>
        </form>
      )}
    </Card>
  );
}
