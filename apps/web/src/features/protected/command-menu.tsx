import { formatHotkey } from '@usehotkeys/core';
import { useBindings, useHotkeys } from '@usehotkeys/react';
import { LayoutDashboard, Link2, type LucideIcon, Search, Settings } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '~/components/ui/foundations/icon/icon';
import { Kbd } from '~/components/ui/foundations/kbd/kbd';
import { Command } from '~/components/ui/navigation/command/command';
import { SidebarFloat } from '~/components/ui/navigation/sidebar-float/sidebar-float';
import { useTranslate } from '~/hooks/use-translate';
import { useOrganizationTo } from './organization/use-current-organization';

/** One `Kbd` per key, in the user's platform: `⌘ + K` on a Mac, `Ctrl + K` on Windows and Linux. A sequence (`g i`) keeps its steps apart. */
function HotkeyKeys({ combo }: { combo: string }) {
	return (
		<span className='flex items-center gap-1.5'>
			{combo.split(' ').map((step, stepIndex) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: the steps of a combo never reorder
				<Fragment key={stepIndex}>
					<Kbd.Group>
						{step.split(/\+(?=.)/).map((key, keyIndex) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: the keys of a step never reorder
							<Fragment key={keyIndex}>
								{keyIndex > 0 && <span className='font-primary text-xs text-muted-foreground'>+</span>}
								<Kbd>{formatHotkey(key)}</Kbd>
							</Fragment>
						))}
					</Kbd.Group>
				</Fragment>
			))}
		</span>
	);
}

interface Destination {
	icon: LucideIcon;
	label: string;
	to: string;
}

/**
 * Sidebar entry that opens the command palette (also with Cmd/Ctrl+K). The palette jumps to any
 * protected page and lists every shortcut registered with a `label` anywhere in the app, so a page
 * that calls `useHotkeys(..., { label })` shows up here without touching this file.
 */
export function CommandMenu() {
	const t = useTranslate();
	const navigate = useNavigate();
	const toOrganization = useOrganizationTo();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const bindings = useBindings({
		labeledOnly: true,
	});

	useHotkeys('mod+k', () => setOpen(current => !current), {
		group: t('protected.command.general'),
		label: t('protected.command.open'),
	});

	const normalizedQuery = query.trim().toLowerCase();
	const matches = (label: string) => label.toLowerCase().includes(normalizedQuery);
	const destinations: Destination[] = [
		{ icon: LayoutDashboard, label: t('protected.nav.dashboard'), to: '/' },
		{ icon: Link2, label: t('protected.nav.links'), to: '/links' },
		{ icon: Settings, label: t('protected.nav.settings'), to: '/settings' },
	].filter(destination => matches(destination.label));
	const shortcuts = bindings.filter(binding => matches(binding.label ?? ''));

	return (
		<>
			<SidebarFloat.Item as='button' className='border border-border' icon={Search} label={t('protected.nav.search')} onClick={() => setOpen(true)} type='button' />
			<Command
				onOpenChange={next => {
					setOpen(next);
					if (!next) setQuery('');
				}}
				open={open}
				shortcut={null}
			>
				<Command.Content>
					<Command.Search hint={<Kbd>Esc</Kbd>} onValueChange={setQuery} placeholder={t('protected.command.placeholder')} value={query} />
					{destinations.length === 0 && shortcuts.length === 0 ? (
						<Command.Empty>{t('protected.command.empty')}</Command.Empty>
					) : (
						<Command.List>
							{destinations.length > 0 && <Command.Group>{t('protected.command.navigation')}</Command.Group>}
							{destinations.map(destination => (
								<Command.Item icon={<Icon icon={destination.icon} size='sm' />} key={destination.to} onSelect={() => void navigate(toOrganization(destination.to))}>
									{destination.label}
								</Command.Item>
							))}
							{shortcuts.length > 0 && <Command.Group>{t('protected.command.shortcuts')}</Command.Group>}
							{shortcuts.map(binding => (
								<div className='flex items-center justify-between gap-3 px-3 py-2 font-primary text-sm text-foreground' key={binding.id}>
									<span className='truncate'>{binding.label}</span>
									<span className='flex items-center gap-2'>
										{binding.combos.map(combo => (
											<HotkeyKeys combo={combo} key={combo} />
										))}
									</span>
								</div>
							))}
						</Command.List>
					)}
				</Command.Content>
			</Command>
		</>
	);
}
