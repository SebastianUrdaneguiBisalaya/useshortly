"use client";

import type * as React from "react";
import { Image } from "../../media-files/image/image";
import { cn } from "../../utils/tailwind/cn";

export const avatarSizeClassName = {
  lg: "size-12 text-base",
  md: "size-10 text-sm",
  sm: "size-8 text-xs",
  xl: "size-16 text-lg",
} as const;

export type AvatarSize = keyof typeof avatarSizeClassName;

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Diameter of the avatar.
   * @default "md"
   */
  size?: AvatarSize;
}

/**
 * Circular avatar — a themed preset of `Image` (same `Img`/`Skeleton`/
 * `Fallback` compound pieces), not a separate implementation.
 * @example
 * ```tsx
 * <Avatar size="lg">
 *   <Avatar.Img alt="Jane's avatar" src={jane.avatarUrl} />
 *   <Avatar.Skeleton />
 *   <Avatar.Fallback>JD</Avatar.Fallback>
 * </Avatar>
 * ```
 */
function AvatarRoot({ size = "md", className, ...props }: AvatarProps) {
  return (
    <Image
      className={cn(
        "shrink-0 rounded-full font-medium font-primary",
        avatarSizeClassName[size],
        className,
      )}
      {...props}
    />
  );
}

export const Avatar = Object.assign(AvatarRoot, {
  Fallback: Image.Fallback,
  Img: Image.Img,
  Skeleton: Image.Skeleton,
});
