"use client";

import * as React from "react";
import { Skeleton } from "../../foundations/skeleton/skeleton";
import { cn } from "../../utils/tailwind/cn";

type ImageStatus = "loading" | "loaded" | "error";

interface ImageContextValue {
  status: ImageStatus;
  setStatus: React.Dispatch<React.SetStateAction<ImageStatus>>;
}

const ImageContext = React.createContext<ImageContextValue | null>(null);

function useImageContext(): ImageContextValue {
  const ctx = React.useContext(ImageContext);
  if (!ctx) throw new Error("Image.* must be used within <Image>.");
  return ctx;
}

export interface ImageRootProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Root of the compound image. Tracks load/error status and exposes it to
 * `Image.Img`/`Image.Skeleton`/`Image.Fallback` via context.
 * @example
 * ```tsx
 * <Image className="size-24 rounded-full">
 *   <Image.Img alt="Jane's avatar" src={jane.avatarUrl} />
 *   <Image.Skeleton />
 *   <Image.Fallback>JD</Image.Fallback>
 * </Image>
 * ```
 */
function ImageRoot({ className, children, ...props }: ImageRootProps) {
  const [status, setStatus] = React.useState<ImageStatus>("loading");
  const value = React.useMemo(
    () => ({
      setStatus,
      status,
    }),
    [
      status,
    ],
  );

  return (
    <ImageContext.Provider value={value}>
      <div
        className={cn("relative overflow-hidden", className)}
        {...props}
      >
        {children}
      </div>
    </ImageContext.Provider>
  );
}

export interface ImageImgProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "alt"> {
  /** Required — an image with no accessible description fails WCAG 1.1.1. Pass `alt=""` explicitly for a purely decorative image. */
  alt: string;
  /**
   * Absolutely fills `Image` (which must then be sized via `className`,
   * e.g. `size-24`), matching the aspect-ratio-driven layout `next/image`'s
   * `fill` prop gives you — without depending on Next.js.
   * @default true
   */
  fill?: boolean;
}

/** The actual `<img>` element. A plain tag, not `next/image` — this library ships to Vite/Storybook and any consumer, not only Next.js, and Next's image optimizer needs a server it can't assume exists here. */
function ImageImg({
  className,
  fill = true,
  onLoad,
  onError,
  ...props
}: ImageImgProps) {
  const { status, setStatus } = useImageContext();

  return (
    // biome-ignore lint/performance/noImgElement: this library isn't Next.js-only; `next/image` can't be assumed. Fill/lazy-loading are handled with plain CSS/HTML instead.
    <img
      className={cn(
        "object-cover transition-opacity duration-300 ease-in-out",
        fill && "absolute inset-0 h-full w-full",
        status === "loaded" ? "opacity-100" : "opacity-0",
        className,
      )}
      onError={(event) => {
        setStatus("error");
        onError?.(event);
      }}
      onLoad={(event) => {
        setStatus("loaded");
        onLoad?.(event);
      }}
      {...props}
    />
  );
}

export interface ImageSkeletonProps {
  className?: string;
}

/** Placeholder shown while `Image.Img` is loading. */
function ImageSkeleton({ className }: ImageSkeletonProps) {
  const { status } = useImageContext();
  if (status !== "loading") return null;

  return (
    <Skeleton className={cn("absolute inset-0", className)}>
      <Skeleton.Item className="h-full w-full rounded-none" />
    </Skeleton>
  );
}

export interface ImageFallbackProps {
  children: React.ReactNode;
  className?: string;
}

/** Shown instead of the image if it fails to load (e.g. initials in place of a broken avatar). */
function ImageFallback({ children, className }: ImageFallbackProps) {
  const { status } = useImageContext();
  if (status !== "error") return null;

  return (
    <div
      className={cn(
        "absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export const Image = Object.assign(ImageRoot, {
  Fallback: ImageFallback,
  Img: ImageImg,
  Skeleton: ImageSkeleton,
});
