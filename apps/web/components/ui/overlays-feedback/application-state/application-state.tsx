"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  LoaderCircle,
  Lock,
  type LucideIcon,
  SearchX,
  ShieldAlert,
  WifiOff,
  Wrench,
} from "lucide-react";
import type * as React from "react";
import { Icon } from "../../foundations/icon/icon";
import { cn } from "../../utils/tailwind/cn";

export interface ApplicationStateProps
  extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Root of the compound application-state screen (empty, loading, error, and
 * every "you can't see the real content right now" screen a page needs) —
 * renders `children` in a centered column. `ApplicationState.ErrorState`
 * etc. below cover the common named states with sensible defaults, but the
 * primitives (`Icon`/`Title`/`Description`/`Actions`) compose directly for
 * anything bespoke.
 * @example
 * ```tsx
 * <ApplicationState>
 *   <ApplicationState.Icon icon={Inbox} />
 *   <ApplicationState.Title>No messages yet</ApplicationState.Title>
 *   <ApplicationState.Description>New messages will show up here.</ApplicationState.Description>
 *   <ApplicationState.Actions>
 *     <Button variant="secondary"><Button.Text>Refresh</Button.Text></Button>
 *   </ApplicationState.Actions>
 * </ApplicationState>
 * ```
 */
function ApplicationStateRoot({ className, ...props }: ApplicationStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 px-6 py-12 text-center",
        className,
      )}
      {...props}
    />
  );
}

const stateIconVariants = cva(
  "mb-3 flex size-12 items-center justify-center rounded-full",
  {
    defaultVariants: {
      tone: "default",
    },
    variants: {
      /** Badge tint hinting at the kind of state (e.g. `"negative"` for an error). */
      tone: {
        default: "bg-muted text-muted-foreground",
        negative: "bg-destructive/10 text-destructive",
        positive: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
      },
    },
  },
);

export type ApplicationStateTone = VariantProps<
  typeof stateIconVariants
>["tone"];

export interface ApplicationStateIconProps {
  /** Lucide icon rendered inside the tone-colored badge. */
  icon: LucideIcon;
  /**
   * Badge tint hinting at the kind of state.
   * @default "default"
   */
  tone?: ApplicationStateTone;
  /**
   * Spins the icon glyph — used by `ApplicationState.LoadingState`.
   * @default false
   */
  spin?: boolean;
  className?: string;
}

/** Icon in a tone-colored circular badge above `ApplicationState.Title`. */
function ApplicationStateIcon({
  icon,
  tone = "default",
  spin = false,
  className,
}: ApplicationStateIconProps) {
  return (
    <div
      className={cn(
        stateIconVariants({
          tone,
        }),
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(spin && "animate-spin")}
        icon={icon}
        size="lg"
      />
    </div>
  );
}

export interface ApplicationStateTitleProps
  extends React.HTMLAttributes<HTMLHeadingElement> {}

/** Heading. Renders `<h3>` — an application state is still real page content, not decoration. */
function ApplicationStateTitle({
  className,
  ...props
}: ApplicationStateTitleProps) {
  return (
    <h3
      className={cn(
        "font-primary text-sm font-medium text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface ApplicationStateDescriptionProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

/** Optional supporting text below `ApplicationState.Title`. */
function ApplicationStateDescription({
  className,
  ...props
}: ApplicationStateDescriptionProps) {
  return (
    <p
      className={cn(
        "max-w-sm font-primary text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface ApplicationStateActionsProps {
  children: React.ReactNode;
  className?: string;
}

/** Row of actions (typically `Button`s). Optional — plain children (e.g. a `Link`) work just as well for a single, non-button action. */
function ApplicationStateActions({
  children,
  className,
}: ApplicationStateActionsProps) {
  return (
    <div
      className={cn(
        "mt-3 flex flex-wrap items-center justify-center gap-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Shared prop shape every named `ApplicationState.*State` preset takes — a fully-formed screen with sensible copy, overridable per usage. */
export interface ApplicationStatePresetProps
  extends Omit<ApplicationStateProps, "children" | "title"> {
  /** Heading text. */
  title?: React.ReactNode;
  /** Supporting text below the title. Pass `null` to omit it entirely. */
  description?: React.ReactNode;
  /** Icon override. */
  icon?: LucideIcon;
  /** Actions row (typically `Button`s), rendered via `ApplicationState.Actions`. */
  actions?: React.ReactNode;
}

function buildPreset(
  defaultIcon: LucideIcon,
  defaultTone: ApplicationStateTone,
  spin = false,
) {
  return function ApplicationStatePreset({
    title,
    description,
    icon = defaultIcon,
    actions,
    className,
    ...props
  }: ApplicationStatePresetProps) {
    return (
      <ApplicationStateRoot
        className={className}
        {...props}
      >
        <ApplicationStateIcon
          icon={icon}
          spin={spin}
          tone={defaultTone}
        />
        <ApplicationStateTitle>{title}</ApplicationStateTitle>
        {description !== null && description !== undefined && (
          <ApplicationStateDescription>
            {description}
          </ApplicationStateDescription>
        )}
        {actions && (
          <ApplicationStateActions>{actions}</ApplicationStateActions>
        )}
      </ApplicationStateRoot>
    );
  };
}

const ApplicationStateErrorBase = buildPreset(AlertTriangle, "negative");

/**
 * Preset "something went wrong" screen. One of the compound
 * `ApplicationState` types; see `ApplicationState` itself for the full set.
 * @example
 * ```tsx
 * <ApplicationState.ErrorState actions={<Button><Button.Text>Retry</Button.Text></Button>} />
 * ```
 */
function ApplicationStateError({
  title = "Something went wrong",
  description = "An unexpected error occurred. Try again, or contact support if it keeps happening.",
  ...props
}: ApplicationStatePresetProps) {
  return (
    <ApplicationStateErrorBase
      description={description}
      title={title}
      {...props}
    />
  );
}

const ApplicationStateLoadingBase = buildPreset(LoaderCircle, "default", true);

/**
 * Preset loading/in-progress screen, with a spinning icon. One of the
 * compound `ApplicationState` types; see `ApplicationState` itself for the
 * full set.
 * @example
 * ```tsx
 * <ApplicationState.LoadingState />
 * ```
 */
function ApplicationStateLoading({
  title = "Loading…",
  description = null,
  ...props
}: ApplicationStatePresetProps) {
  return (
    <ApplicationStateLoadingBase
      description={description}
      title={title}
      {...props}
    />
  );
}

const ApplicationStateEmptyBase = buildPreset(Inbox, "default");

/**
 * Preset "no data yet" screen. One of the compound `ApplicationState`
 * types; see `ApplicationState` itself for the full set.
 * @example
 * ```tsx
 * <ApplicationState.EmptyState actions={<Button><Button.Text>Create</Button.Text></Button>} />
 * ```
 */
function ApplicationStateEmpty({
  title = "Nothing here yet",
  description = "New items will show up here once you add some.",
  ...props
}: ApplicationStatePresetProps) {
  return (
    <ApplicationStateEmptyBase
      description={description}
      title={title}
      {...props}
    />
  );
}

const ApplicationStateSuccessBase = buildPreset(CheckCircle2, "positive");

/**
 * Preset confirmation screen for a completed flow. One of the compound
 * `ApplicationState` types; see `ApplicationState` itself for the full set.
 * @example
 * ```tsx
 * <ApplicationState.SuccessState title="Payment received" />
 * ```
 */
function ApplicationStateSuccess({
  title = "All set",
  description = "Your changes have been saved.",
  ...props
}: ApplicationStatePresetProps) {
  return (
    <ApplicationStateSuccessBase
      description={description}
      title={title}
      {...props}
    />
  );
}

const ApplicationStateOfflineBase = buildPreset(WifiOff, "warning");

/**
 * Preset "no network connection" screen. One of the compound
 * `ApplicationState` types; see `ApplicationState` itself for the full set.
 * @example
 * ```tsx
 * <ApplicationState.OfflineState actions={<Button><Button.Text>Retry</Button.Text></Button>} />
 * ```
 */
function ApplicationStateOffline({
  title = "You're offline",
  description = "Check your internet connection and try again.",
  ...props
}: ApplicationStatePresetProps) {
  return (
    <ApplicationStateOfflineBase
      description={description}
      title={title}
      {...props}
    />
  );
}

const ApplicationStateNotFoundBase = buildPreset(SearchX, "default");

/**
 * Preset 404 screen. One of the compound `ApplicationState` types; see
 * `ApplicationState` itself for the full set.
 * @example
 * ```tsx
 * <ApplicationState.NotFound actions={<Link href="/"><Link.Text>Go home</Link.Text></Link>} />
 * ```
 */
function ApplicationStateNotFound({
  title = "Page not found",
  description = "The page you're looking for doesn't exist or has been moved.",
  ...props
}: ApplicationStatePresetProps) {
  return (
    <ApplicationStateNotFoundBase
      description={description}
      title={title}
      {...props}
    />
  );
}

const ApplicationStateUnauthorizedBase = buildPreset(Lock, "default");

/**
 * Preset 401 screen — the viewer isn't signed in. One of the compound
 * `ApplicationState` types; see `ApplicationState` itself for the full set.
 * @example
 * ```tsx
 * <ApplicationState.Unauthorized actions={<Button><Button.Text>Sign in</Button.Text></Button>} />
 * ```
 */
function ApplicationStateUnauthorized({
  title = "Sign in required",
  description = "You need to sign in to view this page.",
  ...props
}: ApplicationStatePresetProps) {
  return (
    <ApplicationStateUnauthorizedBase
      description={description}
      title={title}
      {...props}
    />
  );
}

const ApplicationStateForbiddenBase = buildPreset(ShieldAlert, "negative");

/**
 * Preset 403 screen — the viewer is signed in but lacks permission. One of
 * the compound `ApplicationState` types; see `ApplicationState` itself for
 * the full set.
 * @example
 * ```tsx
 * <ApplicationState.Forbidden />
 * ```
 */
function ApplicationStateForbidden({
  title = "Access denied",
  description = "You don't have permission to view this page.",
  ...props
}: ApplicationStatePresetProps) {
  return (
    <ApplicationStateForbiddenBase
      description={description}
      title={title}
      {...props}
    />
  );
}

const ApplicationStateMaintenanceBase = buildPreset(Wrench, "warning");

/**
 * Preset scheduled-maintenance screen. One of the compound
 * `ApplicationState` types; see `ApplicationState` itself for the full set.
 * @example
 * ```tsx
 * <ApplicationState.Maintenance />
 * ```
 */
function ApplicationStateMaintenance({
  title = "Under maintenance",
  description = "We're making some improvements. Please check back soon.",
  ...props
}: ApplicationStatePresetProps) {
  return (
    <ApplicationStateMaintenanceBase
      description={description}
      title={title}
      {...props}
    />
  );
}

export const ApplicationState = Object.assign(ApplicationStateRoot, {
  Actions: ApplicationStateActions,
  Description: ApplicationStateDescription,
  EmptyState: ApplicationStateEmpty,
  ErrorState: ApplicationStateError,
  Forbidden: ApplicationStateForbidden,
  Icon: ApplicationStateIcon,
  LoadingState: ApplicationStateLoading,
  Maintenance: ApplicationStateMaintenance,
  NotFound: ApplicationStateNotFound,
  OfflineState: ApplicationStateOffline,
  SuccessState: ApplicationStateSuccess,
  Title: ApplicationStateTitle,
  Unauthorized: ApplicationStateUnauthorized,
});
