import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Translate } from '~/i18n';

/**
 * `t` with typed keys. Its identity changes with the language, so it is a
 * valid `useMemo` dependency for anything built from translated text (zod
 * schemas, option lists).
 */
export function useTranslate(): Translate {
	const { t } = useTranslation();
	return useCallback<Translate>((key, values) => t(key, values), [t]);
}
