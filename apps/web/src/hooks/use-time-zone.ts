import { useEffect } from 'react';
import { timeZoneOf } from '~/lib/time-zones';
import { useTimeZoneStore } from '~/stores/time-zone-store';

export interface UseTimeZone {
	/** ISO 3166-1 alpha-2 code the user picked (Peru by default). */
	country: string;
	setCountry: (country: string) => void;
	/** IANA time zone dates are shown in. */
	timeZone: string;
}

/** Display country and its time zone, backed by `useTimeZoneStore`; rehydrates it from localStorage after mount. */
export function useTimeZone(): UseTimeZone {
	const country = useTimeZoneStore(state => state.country);
	const setCountry = useTimeZoneStore(state => state.setCountry);

	useEffect(() => {
		void useTimeZoneStore.persist.rehydrate();
	}, []);

	return { country, setCountry, timeZone: timeZoneOf(country) };
}
