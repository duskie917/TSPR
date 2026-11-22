import { getCollection, type CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'articles'>;
export type Author = CollectionEntry<'authors'>;

/** Prefix an internal path with the configured base path (e.g. /TSPR on GitHub Pages). */
export function url(path = '/'): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}` || '/';
}

/** Published articles, newest first. Drafts are shown only in `astro dev`. */
export async function getArticles(): Promise<Article[]> {
  const all = await getCollection('articles', ({ data }) => import.meta.env.DEV || !data.draft);
  return all.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function readingTime(body = ''): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Articles sharing the most topics/countries with `article`, excluding itself. */
export function relatedArticles(article: Article, all: Article[], limit = 3): Article[] {
  const score = (a: Article) =>
    a.data.topics.filter((t) => article.data.topics.includes(t)).length * 2 +
    a.data.countries.filter((c) => article.data.countries.includes(c)).length;
  return all
    .filter((a) => a.id !== article.id)
    .map((a) => ({ a, s: score(a) }))
    .filter(({ s }) => s > 0)
    .sort((x, y) => y.s - x.s || y.a.data.date.valueOf() - x.a.data.date.valueOf())
    .slice(0, limit)
    .map(({ a }) => a);
}

export const SITE = {
  name: 'Tian Shan Policy Review',
  short: 'TSPR',
  tagline: 'Youth-led analysis of Central Asian geopolitics, energy, foreign policy and economics.',
  email: import.meta.env.PUBLIC_EDITORIAL_EMAIL || 'editors@tianshanpolicy.org',
};
