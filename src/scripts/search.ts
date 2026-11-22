type IndexEntry = { id: string; text: string };

const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * Client-side filtering for /articles. State lives in the URL (?q=&topic=&country=)
 * so filtered views are shareable and survive reloads; works without JS as a plain list.
 */
export function initArticleFilters() {
  const form = document.getElementById('filters') as HTMLFormElement | null;
  if (!form) return;
  const q = form.querySelector<HTMLInputElement>('#q')!;
  const topic = form.querySelector<HTMLSelectElement>('#topic')!;
  const country = form.querySelector<HTMLSelectElement>('#country')!;
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-article]'));
  const count = document.getElementById('count')!;
  const empty = document.getElementById('empty')!;
  const bodies = new Map<string, string>();

  const params = new URLSearchParams(location.search);
  q.value = params.get('q') ?? '';
  topic.value = params.get('topic') ?? '';
  country.value = params.get('country') ?? '';

  function apply() {
    const terms = normalize(q.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const el of items) {
      const haystack = normalize(`${el.dataset.text ?? ''} ${bodies.get(el.dataset.id ?? '') ?? ''}`);
      const match =
        (!topic.value || (el.dataset.topics ?? '').split(' ').includes(topic.value)) &&
        (!country.value || (el.dataset.countries ?? '').split(' ').includes(country.value)) &&
        terms.every((t) => haystack.includes(t));
      el.hidden = !match;
      if (match) shown++;
    }
    count.textContent = `${shown} ${shown === 1 ? 'article' : 'articles'}`;
    empty.hidden = shown !== 0;

    const next = new URLSearchParams();
    if (q.value.trim()) next.set('q', q.value.trim());
    if (topic.value) next.set('topic', topic.value);
    if (country.value) next.set('country', country.value);
    const qs = next.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  function reset() {
    q.value = '';
    topic.value = '';
    country.value = '';
    apply();
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); apply(); });
  form.addEventListener('reset', (e) => { e.preventDefault(); reset(); });
  q.addEventListener('input', apply);
  topic.addEventListener('change', apply);
  country.addEventListener('change', apply);
  document.getElementById('reset2')?.addEventListener('click', reset);

  apply();

  // Load full article text so keywords also match body copy.
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  fetch(`${base}/search.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((index: IndexEntry[]) => {
      for (const { id, text } of index) bodies.set(id, text);
      apply();
    })
    .catch(() => { /* title/dek/author matching still works */ });
}
