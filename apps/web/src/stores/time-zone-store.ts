import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_COUNTRY } from '~/lib/time-zones';

interface TimeZoneState {
	/** ISO 3166-1 alpha-2 code of the country whose time zone every date of the app is shown in. */
	country: string;
	/** `true` once the persisted value has been read; until then `country` is only the default. */
	hydrated: boolean;
	setCountry: (country: string) => void;
}

/**
 * Persisted country (localStorage) that decides the display time zone, see `lib/date-time`. `useTimeZone` rehydrates
 * the store after mount, so the server and the first client render agree on the default.
 */
export const useTimeZoneStore = create<TimeZoneState>()(
	persist(
		set => ({
			country: DEFAULT_COUNTRY,
			hydrated: false,
			setCountry: country => set({ country }),
		}),
		{
			name: 'time-zone',
			onRehydrateStorage: () => () => {
				useTimeZoneStore.setState({ hydrated: true });
			},
			partialize: state => ({ country: state.country }),
			skipHydration: true,
			storage: createJSONStorage(() => localStorage),
		}
	)
);
