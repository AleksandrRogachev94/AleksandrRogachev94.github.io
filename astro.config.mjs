// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Deployed as the user-pages repo `aleksandrrogachev94.github.io`, which serves from
// root — so there is no `base` here, and there must never be one. `site` is what lets
// Astro emit absolute URLs for canonical tags and og:image.
export default defineConfig({
  site: 'https://alexrogachev.com',
  integrations: [react()],
});
