import { Outlet } from "react-router";
import { SwitchLanguage } from "~/components/ui/actions-controls/switch-language/switch-language";
import { SwitchTheme } from "~/components/ui/actions-controls/switch-theme/switch-theme";
import { Layout } from "~/components/ui/layout/layout/layout";
import { useLanguage } from "~/hooks/use-language";
import { useTheme } from "~/hooks/use-theme";
import { useTranslate } from "~/hooks/use-translate";

/** Wraps every `/auth/*` page: centered column plus the theme and language switchers. */
export default function AuthLayout() {
  const t = useTranslate();
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
            en: t("language.en"),
            es: t("language.es"),
            groupLabel: t("language.group"),
            system: t("language.system"),
          }}
          onValueChange={language.setPreference}
          value={language.preference}
        />
        <SwitchTheme
          lang={{
            dark: t("theme.dark"),
            groupLabel: t("theme.group"),
            light: t("theme.light"),
            system: t("theme.system"),
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
