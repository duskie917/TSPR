const MAX_WORDS = 300;
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

type Rule = { id: string; check: (v: string) => string | null };

const rules: Rule[] = [
  { id: 'name', check: (v) => (v.trim() ? null : 'Please tell us your name.') },
  { id: 'email', check: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'Please enter a valid email address.') },
  { id: 'pitch-topic', check: (v) => (v ? null : 'Please choose a topic.') },
  { id: 'title', check: (v) => (v.trim() ? null : 'Please add a working title.') },
  {
    id: 'pitch',
    check: (v) => {
      const n = wordCount(v);
      if (n < 30) return 'Please write at least 30 words so we can understand your argument.';
      if (n > MAX_WORDS) return `Please keep your pitch under ${MAX_WORDS} words (currently ${n}).`;
      return null;
    },
  },
  {
    id: 'samples',
    check: (v) => {
      if (!v.trim()) return null;
      try { new URL(v.trim()); return null; } catch { return 'Please enter a full link, starting with https://'; }
    },
  },
];

const errId = (id: string) => (id === 'pitch-topic' ? 'topic-err' : `${id}-err`);

export function initPitchForm() {
  const form = document.getElementById('pitch-form') as HTMLFormElement | null;
  if (!form) return;
  const status = document.getElementById('status')!;
  const submit = document.getElementById('submit') as HTMLButtonElement;
  const pitch = document.getElementById('pitch') as HTMLTextAreaElement;
  const counter = document.getElementById('pitch-count')!;
  const endpoint = form.dataset.endpoint ?? '';
  const email = form.dataset.email ?? '';

  const field = (id: string) => document.getElementById(id) as HTMLInputElement;

  function validate(id: string): boolean {
    const rule = rules.find((r) => r.id === id)!;
    const el = field(id);
    const msg = rule.check(el.value);
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    document.getElementById(errId(id))!.textContent = msg ?? '';
    return !msg;
  }

  pitch.addEventListener('input', () => {
    const n = wordCount(pitch.value);
    counter.textContent = `${n} / ${MAX_WORDS} words`;
    counter.style.color = n > MAX_WORDS ? '#b3261e' : '';
  });
  for (const r of rules) {
    field(r.id).addEventListener('blur', () => { if (field(r.id).value) validate(r.id); });
    field(r.id).addEventListener('input', () => { if (field(r.id).getAttribute('aria-invalid') === 'true') validate(r.id); });
  }

  function show(kind: 'ok' | 'err', text: string) {
    status.hidden = false;
    status.className = `form-status ${kind}`;
    status.textContent = text;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const results = rules.map((r) => validate(r.id));
    if (results.includes(false)) {
      const first = rules.find((r) => field(r.id).getAttribute('aria-invalid') === 'true');
      if (first) field(first.id).focus();
      show('err', 'Please fix the highlighted fields.');
      return;
    }
    const data = new FormData(form);
    if (data.get('_gotcha')) return; // bot

    if (!endpoint) {
      // No form backend configured: open the user's email client with the pitch pre-filled.
      const lines = ['name', 'email', 'affiliation', 'based', 'topic', 'country', 'samples']
        .map((k) => `${k[0].toUpperCase()}${k.slice(1)}: ${data.get(k) ?? ''}`)
        .join('\n');
      const subject = `Pitch: ${data.get('title')}`;
      const body = `${lines}\n\n${data.get('pitch')}`;
      location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      show('ok', `Your email app should open with the pitch ready to send to ${email}. If it doesn't, email us directly.`);
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      const res = await fetch(endpoint, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      counter.textContent = `0 / ${MAX_WORDS} words`;
      show('ok', 'Thank you — your pitch has been sent. An editor will reply within 10 working days.');
    } catch {
      show('err', `Sorry, something went wrong sending your pitch. Please try again or email ${email}.`);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send pitch';
    }
  });
}
