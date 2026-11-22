import type { APIRoute } from 'astro';
import { getArticles } from '../lib/utils';

/** Build-time full-text index used by the article filters for keyword matches in article bodies. */
export const GET: APIRoute = async () => {
  const articles = await getArticles();
  const index = articles.map((a) => ({
    id: a.id,
    text: (a.body ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`|[\]()-]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase(),
  }));
  return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } });
};
