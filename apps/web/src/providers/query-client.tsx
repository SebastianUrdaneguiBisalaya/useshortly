import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { getApiErrorMessage, isSessionExpired } from "~/lib/api-error";

/**
 * Every failed request ends up here. A 401 on a protected endpoint has already been retried after a
 * refresh (see `api/axios-instance.ts`), so it means the session is over: back to sign-in.
 * Anything else is shown as a toast, so screens never handle API errors themselves.
 */
function handleError(error: Error, id?: string) {
  if (isSessionExpired(error)) {
    window.location.assign("/auth/sign-in");
    return;
  }
  toast.error(getApiErrorMessage(error), {
    id,
  });
}

/**
 * Module singleton so non-React code (route loaders, session-expiry handler)
 * shares the same cache as the hooks.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: false,
    },
    queries: {
      gcTime: 30 * 60 * 1000,
      networkMode: "online",
      refetchOnMount: true,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 15 * 60 * 1000,
    },
  },
  mutationCache: new MutationCache({
    onError: (error) => handleError(error),
  }),
  // One toast per failing resource.
  queryCache: new QueryCache({
    onError: (error, query) =>
      handleError(error, `query-${String(query.queryKey[0])}`),
  }),
});

export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
