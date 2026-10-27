import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { I18nextProvider } from "react-i18next";
import { Layout as L } from "~/components/ui/layout/layout/layout";

import type { Route } from "./+types/root";
import "~/app/app.css";
import { ToasterProvider } from "~/providers/toast-client";
import { QueryProvider } from "~/providers/query-client";
import { i18n } from "~/i18n";

/** Applies the stored theme before first paint so a dark preference does not flash light. Reads the shape `stores/theme-store.ts` persists. */
const THEME_INIT_SCRIPT = `try{var t=JSON.parse(localStorage.getItem("ui-theme")).state.preference;if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export const links: Route.LinksFunction = () => [];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={i18n.language} suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        <L.Container
          className="flex h-screen w-full flex-col overflow-hidden p-0 sm:p-0 lg:p-0"
          size="full"
        >
          <I18nextProvider i18n={i18n}>
            <QueryProvider>
              {children}
            </QueryProvider>
          </I18nextProvider>
          <ToasterProvider />
        </L.Container>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
