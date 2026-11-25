# Tian Shan Policy Review (TSPR)

An independent, youth-led digital publication and analytical platform on Central Asian
geopolitics, energy security, foreign policy and regional economics.

This repository is the MVP website: a fast static site built with [Astro](https://astro.build),
with articles written in Markdown.

> **Also in this repository:** [`kalkan/`](kalkan/README.md) — «Калкан», an anti-fraud Telegram bot MVP (separate Node project).

## Features

- **Article feed and reader pages**: a long-form reading layout with topic and country tags, reading time, an author box and related articles
- **Topic and country pages**: Geopolitics, Energy Security, Foreign Policy, Economy; Kazakhstan, Kyrgyzstan, Tajikistan, Turkmenistan, Uzbekistan, Regional
- **Contributor profiles** and an **About** page with the mission and editorial standards
- **Search and filters** on `/articles`: keyword (matches titles, standfirsts, authors and full text) plus topic and country, kept in the URL so you can share a filtered view
- **Pitch form** on `/contribute`, with validation, a word counter and a spam honeypot
- RSS feed (`/rss.xml`), sitemap, Open Graph tags and article structured data. Light and dark themes; works on phones

## Getting started

```bash
npm install
npm run dev       # http://localhost:4321
npm run build     # type-check + build to dist/
npm run preview   # serve the built site
```

Requires Node 18.20+ (Node 22 recommended).

## Publishing an article

1. Add a Markdown file to `src/content/articles/`. The file name becomes the URL slug.
2. Fill in the frontmatter. It is checked at build time, so a typo in a topic or author breaks the build instead of the page:

```yaml
---
title: "Headline"
dek: "One- or two-sentence standfirst shown under the headline and on cards."
author: aigerim-sadykova          # file name (without .json) in src/content/authors/
date: 2026-11-20
topics: [geopolitics, economy]    # geopolitics | energy-security | foreign-policy | economy
countries: [kazakhstan]           # kazakhstan | kyrgyzstan | tajikistan | turkmenistan | uzbekistan | regional
featured: false                   # the newest featured article leads the home page
draft: false                      # drafts appear in `npm run dev` only
---
```

New contributors go in `src/content/authors/<id>.json`. Set `"editor": true` to list them under the editorial team.
Topics and countries are defined in `src/data/taxonomy.ts`.

> **Sample content:** the authors and articles included now are placeholders that show the layout. Replace them with real contributors and pieces before launch.

## Pitch form setup

The form needs somewhere to send submissions. Set these as environment variables (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `PUBLIC_PITCH_FORM_ENDPOINT` | A form backend URL, for example a free [Formspree](https://formspree.io) form. Submissions are POSTed there. |
| `PUBLIC_EDITORIAL_EMAIL` | The editorial inbox. If no endpoint is set, the form opens the visitor's email app with the pitch filled in and addressed here. |

## Deployment

`.github/workflows/deploy.yml` builds the site and deploys it to GitHub Pages on every push to `main`.

1. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Optionally add `PUBLIC_PITCH_FORM_ENDPOINT` and `PUBLIC_EDITORIAL_EMAIL` under **Settings → Secrets and variables → Actions → Variables**.

The workflow serves the site at `https://<owner>.github.io/<repo>/` by setting `BASE_PATH`. With a custom domain, set `SITE` to the domain and `BASE_PATH` to `/`.
The site is fully static, so Netlify, Vercel or Cloudflare Pages also work: build with `npm run build` and serve `dist/`.

## Project structure

```
src/
  content/articles/   Markdown articles
  content/authors/    Contributor profiles (JSON)
  content.config.ts   Content schemas
  data/taxonomy.ts    Topics and countries
  layouts/            Page and article layouts
  components/         Cards, tags, header, footer
  pages/              Routes (home, articles, topics, countries, authors, about, contribute, rss, search index)
  scripts/            Client-side search filters and pitch form logic
  styles/global.css   Design tokens and styles
```

## Next steps after the MVP

- A headless CMS (for example Decap CMS) so editors can publish without Git
- Russian and other regional-language editions
- Newsletter signup and analytics
- Article images and social share cards
