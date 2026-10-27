import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";

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
  mutationCache: new MutationCache(),
  queryCache: new QueryCache({
    // One toast per failing resource; 401 is handled by the session-expired flow.
    onError: (error, query) => {
      toast.error(error.message, {
        id: `query-${String(query.queryKey[0])}`,
      });
    },
  }),
});


export function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}