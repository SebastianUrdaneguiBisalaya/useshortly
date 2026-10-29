import { describe, expect, it } from 'vitest';
import { ApiNotFoundError, ApiRequestError } from '../../api/errors.js';
import { describeError } from './helpers.js';

describe('describeError', () => {
	it.each([
		['name_taken', 'already in use'],
		['invalid_name', '1 to 100 characters'],
		['invalid_description', '500 characters'],
		['too_many_channels', 'at most 100 channels'],
		['campaign_url_too_long', '255 characters'],
		['invalid_range', '366 days'],
		['invalid_filter', 'positive integers'],
		['campaigns_disabled', 'not enabled'],
	])('tells the model how to recover from %s', (code, hint) => {
		const text = describeError(new ApiRequestError(400, code, 'the API message'));
		expect(text).toContain('the API message');
		expect(text).toContain(hint);
	});

	it('says what to do when a channel is not found', () => {
		const text = describeError(new ApiNotFoundError(404, 'channel_not_found', 'channel not found'));
		expect(text).toContain('channel not found');
		expect(text).toContain("List the campaign's channels");
	});

	it('keeps the generic advice for a code without a hint', () => {
		expect(describeError(new ApiNotFoundError(404, 'not_found', 'link not found'))).toContain('list the items again');
		expect(describeError(new ApiRequestError(400, 'invalid_url', 'bad url'))).toBe('useshortly rejected the request: bad url.');
	});

	it('does not treat a code like a property of Object as a hint', () => {
		expect(describeError(new ApiRequestError(400, 'constructor', 'odd'))).toBe('useshortly rejected the request: odd.');
	});
});
