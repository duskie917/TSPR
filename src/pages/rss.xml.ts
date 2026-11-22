import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getArticles, SITE } from '../lib/utils';

export async function GET(context: APIContext) {
  const articles = await getArticles();
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return rss({
    title: SITE.name,
    description: SITE.tagline,
    site: context.site ?? 'https://example.com',
    items: articles.map((a) => ({
      title: a.data.title,
      description: a.data.dek,
      pubDate: a.data.date,
      link: `${base}/articles/${a.id}/`,
      categories: [...a.data.topics, ...a.data.countries],
    })),
  });
}
