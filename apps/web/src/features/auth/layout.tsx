import { Outlet } from "react-router";
import { Layout } from "~/components/ui/layout/layout/layout";

/** Wraps every `/auth/*` page: centered column plus the theme and language switchers. */
export default function AuthLayout() {
  return (
    <div className="relative h-full w-full">
      <Layout.Container
        className="h-full max-w-md flex flex-col items-center justify-center"
        size="full"
      >
        <Layout.Stack
          className="w-full flex flex-col items-center justify-center"
          gap="xl"
        >
          <Outlet />
        </Layout.Stack>
      </Layout.Container>
    </div>
  );
}
