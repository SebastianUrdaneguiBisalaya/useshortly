/** Country the app starts in until the user picks another one in the settings. */
export const DEFAULT_COUNTRY = 'PE';

/**
 * Main IANA time zone of each country the settings offer (ISO 3166-1 alpha-2). Countries that span several zones use
 * the one of their capital or most populated area. Zones with daylight saving shift the per-hour charts by an hour
 * for part of the year, because the browser only knows the API's UTC hours.
 */
export const COUNTRY_TIME_ZONES: Record<string, string> = {
	AE: 'Asia/Dubai',
	AR: 'America/Argentina/Buenos_Aires',
	AU: 'Australia/Sydney',
	BO: 'America/La_Paz',
	BR: 'America/Sao_Paulo',
	CA: 'America/Toronto',
	CH: 'Europe/Zurich',
	CL: 'America/Santiago',
	CN: 'Asia/Shanghai',
	CO: 'America/Bogota',
	CR: 'America/Costa_Rica',
	CU: 'America/Havana',
	DE: 'Europe/Berlin',
	DO: 'America/Santo_Domingo',
	EC: 'America/Guayaquil',
	ES: 'Europe/Madrid',
	FR: 'Europe/Paris',
	GB: 'Europe/London',
	GT: 'America/Guatemala',
	HN: 'America/Tegucigalpa',
	IE: 'Europe/Dublin',
	IN: 'Asia/Kolkata',
	IT: 'Europe/Rome',
	JP: 'Asia/Tokyo',
	KR: 'Asia/Seoul',
	MX: 'America/Mexico_City',
	NI: 'America/Managua',
	NL: 'Europe/Amsterdam',
	NZ: 'Pacific/Auckland',
	PA: 'America/Panama',
	PE: 'America/Lima',
	PR: 'America/Puerto_Rico',
	PT: 'Europe/Lisbon',
	PY: 'America/Asuncion',
	SV: 'America/El_Salvador',
	US: 'America/New_York',
	UY: 'America/Montevideo',
	VE: 'America/Caracas',
	ZA: 'Africa/Johannesburg',
};

/** Countries the settings list, in the order of their codes. */
export const TIME_ZONE_COUNTRIES = Object.keys(COUNTRY_TIME_ZONES);

/** The time zone of `country`, or the default country's when it is unknown. */
export function timeZoneOf(country: string) {
	return COUNTRY_TIME_ZONES[country] ?? COUNTRY_TIME_ZONES[DEFAULT_COUNTRY];
}
