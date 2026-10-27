"use client";

import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { Icon } from "../../foundations/icon/icon";
import { Dropdown } from "../../overlays-feedback/dropdown/dropdown";
import { cn } from "../../utils/tailwind/cn";

function UserProfileRoot(props: React.ComponentProps<typeof Dropdown>) {
  return <Dropdown {...props} />;
}

export interface UserProfileTriggerProps {
  /** The user's avatar — typically an `Avatar`. */
  avatar: React.ReactNode;
  name: React.ReactNode;
  email?: React.ReactNode;
  /**
   * Shows only `avatar`, dropping `name`/`email` — for a collapsed sidebar
   * rail or a compact corner of the page. Responsive by nature: `avatar`
   * keeps its own size and the row's text simply truncates at any width, so
   * this only needs to flip at whatever breakpoint the layout collapses at.
   * @default false
   */
  collapsed?: boolean;
  className?: string;
}

/** Opens `UserProfile.Content` on click — a row showing the avatar plus name/email (or just the avatar while `collapsed`). */
function UserProfileTrigger({
  avatar,
  name,
  email,
  collapsed = false,
  className,
}: UserProfileTriggerProps) {
  return (
    <Dropdown.Trigger>
      <button
        className={cn(
          "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg p-1.5 text-left transition-colors duration-150 ease-in-out",
          "hover:bg-muted",
          "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
          collapsed && "justify-center",
          className,
        )}
        type="button"
      >
        {avatar}
        {!collapsed && (
          <span className="flex min-w-0 flex-1 flex-col items-start">
            <span className="w-full truncate font-primary text-sm font-medium text-foreground">
              {name}
            </span>
            {email && (
              <span className="w-full truncate font-primary text-xs text-muted-foreground">
                {email}
              </span>
            )}
          </span>
        )}
      </button>
    </Dropdown.Trigger>
  );
}

export interface UserProfileContentProps
  extends Omit<React.ComponentProps<typeof Dropdown.Content>, "align"> {
  /** Horizontal alignment relative to the trigger. @default "start" */
  align?: "start" | "end";
}

/** Portaled, positioned popover panel — wraps `Dropdown.Content` with a wider default (room for an email address) and the same flip/keyboard behavior. */
function UserProfileContent({ className, ...props }: UserProfileContentProps) {
  return (
    <Dropdown.Content
      className={cn("min-w-56", className)}
      {...props}
    />
  );
}

export interface UserProfileHeaderProps {
  avatar: React.ReactNode;
  name: React.ReactNode;
  email?: React.ReactNode;
  className?: string;
}

/** Larger identity block at the top of `UserProfile.Content`, repeating the avatar/name/email so the popover confirms who's signed in before showing actions. */
function UserProfileHeader({
  avatar,
  name,
  email,
  className,
}: UserProfileHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2.5 px-2 py-2", className)}>
      {avatar}
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-primary text-sm font-medium text-foreground">
          {name}
        </span>
        {email && (
          <span className="truncate font-primary text-xs text-muted-foreground">
            {email}
          </span>
        )}
      </span>
    </div>
  );
}

export interface UserProfileItemProps
  extends Omit<React.ComponentProps<typeof Dropdown.Item>, "children"> {
  /** Lucide icon rendered before the label (e.g. `Settings`, `User`, `LogOut`). */
  icon?: LucideIcon;
  children: React.ReactNode;
}

/** One action in the popover (e.g. "Settings", "My profile", "Log out") — `Dropdown.Item` plus an optional leading icon. */
function UserProfileItem({ icon, children, ...props }: UserProfileItemProps) {
  return (
    <Dropdown.Item {...props}>
      {icon && (
        <Icon
          aria-hidden="true"
          className="shrink-0 text-muted-foreground"
          icon={icon}
          size="sm"
        />
      )}
      <span className="truncate">{children}</span>
    </Dropdown.Item>
  );
}

/**
 * Compound account menu — the pattern shown in a sidebar footer or a page's
 * top-right corner: an avatar/name/email row that opens a popover of account
 * actions ("My profile", "Settings", "Log out") on click. Built on `Dropdown`
 * for its menu semantics, positioning, and keyboard navigation.
 * @example
 * ```tsx
 * <UserProfile>
 *   <UserProfile.Trigger
 *     avatar={<Avatar size="sm"><Avatar.Fallback>JD</Avatar.Fallback></Avatar>}
 *     email="jane@acme.com"
 *     name="Jane Doe"
 *   />
 *   <UserProfile.Content>
 *     <UserProfile.Item icon={User} onSelect={goToProfile}>My profile</UserProfile.Item>
 *     <UserProfile.Item icon={Settings} onSelect={goToSettings}>Settings</UserProfile.Item>
 *     <UserProfile.Separator />
 *     <UserProfile.Item icon={LogOut} onSelect={logOut} variant="destructive">Log out</UserProfile.Item>
 *   </UserProfile.Content>
 * </UserProfile>
 * ```
 */
export const UserProfile = Object.assign(UserProfileRoot, {
  Content: UserProfileContent,
  Header: UserProfileHeader,
  Item: UserProfileItem,
  Separator: Dropdown.Separator,
  Trigger: UserProfileTrigger,
});
