import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

/** The instructions the model gets when the user runs the prompt. The URL is quoted as data. */
export function shortenUrlText(input: { url: string; alias?: string; organization?: string }): string {
	return [
		'Shorten a URL with useshortly.',
		'',
		`URL to shorten: ${JSON.stringify(input.url)}`,
		input.alias ? `Custom alias requested: ${JSON.stringify(input.alias)}` : 'No custom alias was requested: let useshortly generate the code.',
		input.organization ? `Organization to use: ${JSON.stringify(input.organization)} (a name or an id).` : 'No organization was named.',
		'',
		'Steps:',
		'1. Call list_organizations. Use the organization the user named; if none was named and there is exactly one, use it; if there are several, ask the user which one before continuing.',
		'2. Call create_link with that organization, the URL and the alias if one was requested.',
		'3. Reply with the short URL on its own line, then one sentence confirming where it points. If the alias is taken or the URL is rejected, say why and suggest a fix instead of retrying blindly.',
		'4. Offer to make a QR code (get_link_qr) but do not create it unless the user says yes.',
	].join('\n');
}

export function registerShortenUrlPrompt(server: McpServer) {
	server.registerPrompt(
		'shorten_url',
		{
			title: 'Shorten a URL',
			description: 'Shorten a URL with useshortly, optionally with a custom alias, and get the short link back.',
			argsSchema: z.object({
				url: z
					.string()
					.max(255)
					.refine(v => /^https?:\/\/[^\s/]+/i.test(v), 'must be an http or https URL')
					.describe('The URL to shorten.'),
				alias: z
					.string()
					.regex(/^[A-Za-z0-9_-]{3,15}$/, '3 to 15 letters, digits, - or _')
					.optional()
					.describe('Custom short code (optional).'),
				organization: z.string().max(100).optional().describe('Organization name or id (optional).'),
			}),
		},
		args => ({
			messages: [{ role: 'user' as const, content: { type: 'text' as const, text: shortenUrlText(args) } }],
		})
	);
}
