import { useLingui } from "@lingui/react";
import { Outlet } from "react-router";
import { SwitchLanguage } from "~/components/ui/actions-controls/switch-language/switch-language";
import { SwitchTheme } from "~/components/ui/actions-controls/switch-theme/switch-theme";
import { Layout } from "~/components/ui/layout/layout/layout";
import { useLanguage } from "~/hooks/use-language";
import { useTheme } from "~/hooks/use-theme";

/** Wraps every `/auth/*` page: centered column plus the theme and language switchers. */
export default function AuthLayout() {
  const { _ } = useLingui();
  const theme = useTheme();
  const language = useLanguage();

  return (
    <div className="relative h-full w-full">
      <Layout.HStack
        className="absolute top-4 right-4 z-10"
        gap="sm"
      >
        <SwitchLanguage
          lang={{
            en: _("language.en"),
            es: _("language.es"),
            groupLabel: _("language.group"),
            system: _("language.system"),
          }}
          onValueChange={language.setPreference}
          value={language.preference}
        />
        <SwitchTheme
          lang={{
            dark: _("theme.dark"),
            groupLabel: _("theme.group"),
            light: _("theme.light"),
            system: _("theme.system"),
          }}
          onValueChange={theme.setPreference}
          value={theme.preference}
        />
      </Layout.HStack>
      <Layout.Container
        className="h-full max-w-sm flex flex-col items-center justify-center"
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
