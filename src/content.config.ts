import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { countrySlugs, topicSlugs } from './data/taxonomy';

const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/articles' }),
  schema: z.object({
    title: z.string(),
    dek: z.string().describe('One- or two-sentence standfirst shown under the headline and on cards'),
    author: reference('authors'),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    topics: z.array(z.enum(topicSlugs)).min(1),
    countries: z.array(z.enum(countrySlugs)).min(1),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const authors = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/authors' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    location: z.string(),
    bio: z.string(),
    affiliation: z.string().optional(),
    editor: z.boolean().default(false),
    links: z
      .object({ website: z.string().url().optional(), linkedin: z.string().url().optional(), x: z.string().url().optional() })
      .default({}),
  }),
});

export const collections = { articles, authors };
