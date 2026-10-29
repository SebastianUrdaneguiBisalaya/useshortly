'use client';

import { type Config, type Driver, type DriveStep, driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour-guide.css';
import { cloneElement, createContext, type MouseEvent, type ReactElement, type ReactNode, useContext, useEffect, useRef } from 'react';

export type { Config as TourGuideConfig, DriveStep as TourGuideStep };

interface TourGuideContextValue {
	/** Lazily creates (once) and returns the underlying driver.js instance. */
	getDriver: () => Driver;
}

const TourGuideContext = createContext<TourGuideContextValue | null>(null);

function useTourGuideContext() {
	const context = useContext(TourGuideContext);
	if (!context) {
		throw new Error('TourGuide subcomponents must be used within <TourGuide.Root>.');
	}
	return context;
}

const DEFAULT_CONFIG: Config = {
	overlayOpacity: 0.5,
	showProgress: true,
};

export interface TourGuideRootProps {
	/** Ordered list of driver.js steps the tour walks through, e.g. `{ element: "#id", popover: { title, description } }`. */
	steps: DriveStep[];
	/** Additional driver.js options (button labels, hooks, `stagePadding`…) merged over the design system's defaults. */
	config?: Omit<Config, 'steps'>;
	/**
	 * Starts the tour as soon as it mounts, instead of waiting for a `Trigger` click.
	 * @default false
	 */
	autoStart?: boolean;
	/** A `Trigger` (and/or any other content) that can start the tour. */
	children?: ReactNode;
}

/**
 * Root of the compound product-tour guide — a thin wrapper around
 * `driver.js` that keeps this design system's own popover look (see
 * `tour-guide.css`, which restyles driver.js's default popover with this
 * project's CSS tokens) instead of building a bespoke overlay. driver.js
 * owns and renders its own highlight/popover DOM outside React, so `Root`
 * renders nothing itself: it only creates a single instance for `steps`,
 * keeps it in sync as `steps`/`config` change, and disposes of it on
 * unmount.
 * @example
 * ```tsx
 * <TourGuide.Root
 *   steps={[
 *     { element: "#dashboard-nav", popover: { title: "Dashboard", description: "See your KPIs at a glance." } },
 *     { element: "#invite-button", popover: { title: "Invite your team", description: "Bring your teammates in." } },
 *   ]}
 * >
 *   <TourGuide.Trigger>
 *     <Button><Button.Text>Take the tour</Button.Text></Button>
 *   </TourGuide.Trigger>
 * </TourGuide.Root>
 * ```
 */
function TourGuideRoot({ steps, config, autoStart = false, children }: TourGuideRootProps) {
	const driverRef = useRef<Driver | null>(null);

	function getDriver() {
		if (!driverRef.current) {
			driverRef.current = driver({
				...DEFAULT_CONFIG,
				...config,
				steps,
			});
		}
		return driverRef.current;
	}

	// Keeps the instance's steps/config current without destroying it (which would abort an in-progress tour).
	// biome-ignore lint/correctness/useExhaustiveDependencies: `getDriver` is stable in behavior (lazily creates the ref once); its function identity changing every render must not re-run this effect.
	useEffect(() => {
		getDriver().setConfig({
			...DEFAULT_CONFIG,
			...config,
			steps,
		});
	}, [steps, config]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount/unmount-only — `steps`/`config` are kept in sync by the effect above instead of re-triggering this one.
	useEffect(() => {
		if (autoStart) {
			getDriver().drive();
		}
		return () => {
			driverRef.current?.destroy();
			driverRef.current = null;
		};
	}, []);

	return (
		<TourGuideContext.Provider
			value={{
				getDriver,
			}}
		>
			{children}
		</TourGuideContext.Provider>
	);
}

type TriggerChildProps = {
	onClick?: (event: MouseEvent<HTMLElement>) => void;
};

export interface TourGuideTriggerProps {
	/** A single element (e.g. a `Button`) that starts the tour, from its first step, on click. */
	children: ReactElement<TriggerChildProps>;
}

/** Clones `children` and wires an `onClick` that starts the tour, preserving any existing handler. */
function TourGuideTrigger({ children }: TourGuideTriggerProps) {
	const { getDriver } = useTourGuideContext();

	return cloneElement(children, {
		onClick: (event: MouseEvent<HTMLElement>) => {
			children.props.onClick?.(event);
			getDriver().drive();
		},
	});
}

/**
 * Compound product-tour guide.
 * @example
 * ```tsx
 * <TourGuide.Root steps={steps}>
 *   <TourGuide.Trigger>
 *     <Button><Button.Text>Take the tour</Button.Text></Button>
 *   </TourGuide.Trigger>
 * </TourGuide.Root>
 * ```
 */
export const TourGuide = {
	Root: TourGuideRoot,
	Trigger: TourGuideTrigger,
};
