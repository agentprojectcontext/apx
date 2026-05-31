// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://agentprojectcontext.github.io',
	base: '/apx',
	integrations: [
		starlight({
			title: 'APX',
			description:
				'APX — local runtime + CLI for the Agent Project Context (APC) standard. Daemon, agents, runtimes, engines, MCP, memory, and multi-surface UIs.',
			tagline: 'Local runtime for AI agents',
			logo: {
				src: './src/assets/logo.svg',
				replacesTitle: false,
			},
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
