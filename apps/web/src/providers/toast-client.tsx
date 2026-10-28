import { Toaster } from 'sonner';
import { useTheme } from '../hooks/use-theme';

export function ToasterProvider() {
	const { preference } = useTheme();
	return (
		<Toaster
			position='bottom-right'
			theme={preference}
			toastOptions={{
				classNames: {
					description: '!text-inverse-foreground-tertiary',
					toast: '!border !border-line !bg-bg-foreground-secondary !text-inverse-background !font-secondary !text-[12px] !shadow-none !rounded-none',
				},
			}}
		/>
	);
}
