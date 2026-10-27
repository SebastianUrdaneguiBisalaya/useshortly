import { Toaster } from 'sonner';

export function ToasterProvider() {
	return (
		<Toaster
			position='bottom-right'
			theme={'system'}
			toastOptions={{
				classNames: {
					description: '!text-inverse-foreground-tertiary',
					toast: '!border !border-line !bg-bg-foreground-secondary !text-inverse-background !font-secondary !text-[12px] !shadow-none !rounded-none',
				},
			}}
		/>
	);
}
