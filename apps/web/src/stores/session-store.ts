import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Session } from '~/api/model';

interface SessionState {
	/** Who is signed in and until when. The tokens are httpOnly cookies the page cannot read. */
	session: Session | null;
	setSession: (session: Session) => void;
	clearSession: () => void;
}

/** The signed-in user and the session's expiry times, persisted so a reload keeps the user signed in. */
export const useSessionStore = create<SessionState>()(
	persist(
		set => ({
			clearSession: () => {
				set({
					session: null,
				});
			},
			session: null,
			setSession: session => {
				set({
					session,
				});
			},
		}),
		{
			name: 'ui-session',
			partialize: state => ({
				session: state.session,
			}),
			storage: createJSONStorage(() => localStorage),
		}
	)
);
