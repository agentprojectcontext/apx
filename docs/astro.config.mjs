// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import remarkGfm from 'remark-gfm';

// https://astro.build/config
export default defineConfig({
	site: 'https://agentprojectcontext.github.io',
	// Docs publish under /apx/docs/ — the landing owns /apx/ (see pages.yml).
	base: '/apx/docs',
	// GFM (tables, strikethrough, …) is applied internally for .md but is not
	// exposed on markdown.remarkPlugins, so MDX (which extends this list) misses
	// it. Add it explicitly so tables render in both .md and .mdx.
	markdown: {
		remarkPlugins: [remarkGfm],
	},
	integrations: [
		starlight({
			title: 'APX',
			description:
				'APX — local runtime + CLI for the Agent Project Context (APC) standard. Daemon, agents, runtimes, engines, MCP, memory, and multi-surface UIs.',
			tagline: 'Local runtime for AI agents',
			logo: {
				// Real APX brand mark (green 4-arrow). Transparent → works on
				// both light and dark Starlight themes.
				src: './src/assets/logo.webp',
				replacesTitle: false,
			},
			favicon: '/favicon.ico',
			customCss: ['./src/styles/custom.css'],
			// Social card (green APX banner) for link previews.
			head: [
				{ tag: 'meta', attrs: { property: 'og:image', content: 'https://agentprojectcontext.github.io/apx/docs/og.png' } },
				{ tag: 'meta', attrs: { name: 'twitter:image', content: 'https://agentprojectcontext.github.io/apx/docs/og.png' } },
				{ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
			],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/agentprojectcontext/apx',
				},
			],
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				es: { label: 'Español', lang: 'es' },
			},
			editLink: {
				baseUrl:
					'https://github.com/agentprojectcontext/apx/edit/main/docs/',
			},
			lastUpdated: true,
			sidebar: [
				{
					label: 'Start Here',
					translations: { es: 'Empezar' },
					items: [{ autogenerate: { directory: 'start' } }],
				},
				{
					label: 'Concepts',
					translations: { es: 'Conceptos' },
					items: [{ autogenerate: { directory: 'concepts' } }],
				},
				{
					label: 'Surfaces',
					translations: { es: 'Interfaces' },
					items: [{ autogenerate: { directory: 'surfaces' } }],
				},
				{
					label: 'Engine',
					translations: { es: 'Motor' },
					items: [{ autogenerate: { directory: 'engine' } }],
				},
				{
					label: 'Capabilities',
					translations: { es: 'Capacidades' },
					items: [{ autogenerate: { directory: 'capabilities' } }],
				},
				{
					label: 'Reference',
					translations: { es: 'Referencia' },
					items: [{ autogenerate: { directory: 'reference' } }],
				},
			],

		}),
	],
});
