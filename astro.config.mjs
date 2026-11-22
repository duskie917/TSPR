// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// SITE / BASE_PATH are set in CI (see .github/workflows/deploy.yml).
// For GitHub Pages project sites the base path is the repository name, e.g. /TSPR.
const site = process.env.SITE || 'https://example.com';
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: { theme: 'github-light' },
  },
});
