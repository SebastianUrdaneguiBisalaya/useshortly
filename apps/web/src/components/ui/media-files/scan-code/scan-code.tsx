"use client";

import JsBarcode from "jsbarcode";
import { Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import * as React from "react";
import { Button, type ButtonProps } from "../../actions-controls/button/button";
import { cn } from "../../utils/tailwind/cn";

/** Kind of machine-readable code `ScanCode` renders. */
export type ScanCodeType = "qr" | "barcode";

/** What `ScanCode` hands to `onDownload` so the consumer can implement the actual download. */
export interface ScanCodeDownloadPayload {
  /** The rendered `<svg>` element, ready to serialize or rasterize. `null` if the code could not be drawn (e.g. an invalid barcode value). */
  svg: SVGSVGElement | null;
  /** The encoded value. */
  value: string;
  /** Which kind of code was rendered. */
  type: ScanCodeType;
}

/** Texts rendered by `ScanCode`. Pass `lang` to `ScanCode` to override any of them. */
export interface ScanCodeLang {
  /** Accessible name of the download button. */
  download: string;
  /** Accessible name of a QR code, followed by its value. */
  qr: string;
  /** Accessible name of a barcode, followed by its value. */
  barcode: string;
  /** Shown instead of a barcode whose value is invalid for the chosen format. */
  invalid: string;
}

/** English defaults for `ScanCodeLang`. */
export const defaultScanCodeLang: ScanCodeLang = {
  barcode: "Barcode",
  download: "Download code",
  invalid: "This value can't be encoded in the selected format.",
  qr: "QR code",
};

interface ScanCodeContextValue {
  value: string;
  type: ScanCodeType;
  scheme: ScanCodeScheme;
  lang: ScanCodeLang;
  svgRef: React.RefObject<SVGSVGElement | null>;
  onDownload?: (payload: ScanCodeDownloadPayload) => void;
}

const ScanCodeContext = React.createContext<ScanCodeContextValue | null>(null);

function useScanCodeContext(): ScanCodeContextValue {
  const ctx = React.useContext(ScanCodeContext);
  if (!ctx) throw new Error("ScanCode.* must be used within <ScanCode>.");
  return ctx;
}

/**
 * `"theme"` draws the code in the current theme's ink over its canvas (light on dark in dark mode);
 * `"fixed"` always draws near-black on white, which every scanner reads — some fail on inverted codes.
 */
export type ScanCodeScheme = "theme" | "fixed";

export interface ScanCodeRootProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "lang"> {
  /** The string to encode. */
  value: string;
  /**
   * Kind of code to render.
   * @default "qr"
   */
  type?: ScanCodeType;
  /**
   * Colour scheme of the code.
   * @default "theme"
   */
  scheme?: ScanCodeScheme;
  /** Called when the download button is activated. `ScanCode` never downloads anything itself. The button is not rendered without it. */
  onDownload?: (payload: ScanCodeDownloadPayload) => void;
  /**
   * Texts rendered by this component. Merges over English defaults.
   * @default defaultScanCodeLang
   */
  lang?: Partial<ScanCodeLang>;
}

/**
 * Root of the compound scan code. Shares the value, type and drawn `<svg>` with `ScanCode.Canvas` and
 * `ScanCode.DownloadButton` through context, and reveals the download button on hover or keyboard focus.
 * @example
 * ```tsx
 * <ScanCode value="https://example.com" onDownload={({ svg }) => save(svg)}>
 *   <ScanCode.Canvas />
 *   <ScanCode.DownloadButton />
 * </ScanCode>
 * ```
 */
function ScanCodeRoot({
  value,
  type = "qr",
  scheme = "theme",
  onDownload,
  lang,
  className,
  children,
  ...props
}: ScanCodeRootProps) {
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const resolvedLang = React.useMemo(
    () => ({
      ...defaultScanCodeLang,
      ...lang,
    }),
    [
      lang,
    ],
  );
  const context = React.useMemo(
    () => ({
      lang: resolvedLang,
      onDownload,
      scheme,
      svgRef,
      type,
      value,
    }),
    [
      resolvedLang,
      onDownload,
      scheme,
      type,
      value,
    ],
  );

  return (
    <ScanCodeContext.Provider value={context}>
      <div
        {...props}
        className={cn(
          "group relative flex w-fit items-center justify-center rounded-lg border border-border p-4",
          scheme === "fixed"
            ? "bg-(--white) text-(--black)"
            : "bg-background text-foreground",
          className,
        )}
      >
        {children}
      </div>
    </ScanCodeContext.Provider>
  );
}

export interface ScanCodeCanvasProps
  extends Omit<React.SVGAttributes<SVGSVGElement>, "ref"> {
  /**
   * Side of a QR code in pixels.
   * @default 160
   */
  size?: number;
  /**
   * QR error-correction level: higher survives more damage but needs a denser code.
   * @default "M"
   */
  level?: "L" | "M" | "Q" | "H";
  /**
   * Barcode symbology, any format `jsbarcode` supports.
   * @default "CODE128"
   */
  format?: string;
  /**
   * Barcode height in pixels.
   * @default 64
   */
  height?: number;
  /**
   * Width in pixels of the thinnest barcode bar.
   * @default 2
   */
  barWidth?: number;
  /**
   * Whether the barcode prints its value underneath.
   * @default true
   */
  displayValue?: boolean;
}

/** Draws the QR code or barcode as an `<svg>` painted with `currentColor`, so it follows the theme. */
function ScanCodeCanvas({
  size = 160,
  level = "M",
  format = "CODE128",
  height = 64,
  barWidth = 2,
  displayValue = true,
  className,
  "aria-label": ariaLabel,
  ...props
}: ScanCodeCanvasProps) {
  const { value, type, lang, svgRef } = useScanCodeContext();
  const [invalid, setInvalid] = React.useState(false);
  const label =
    ariaLabel ?? `${type === "qr" ? lang.qr : lang.barcode}: ${value}`;

  React.useEffect(() => {
    if (type !== "barcode" || !svgRef.current) return;
    try {
      JsBarcode(svgRef.current, value, {
        background: "transparent",
        displayValue,
        font: "inherit",
        fontSize: 14,
        format,
        height,
        lineColor: "currentColor",
        margin: 0,
        valid: (ok) => setInvalid(!ok),
        width: barWidth,
      });
    } catch {
      setInvalid(true);
    }
  }, [
    type,
    value,
    format,
    height,
    barWidth,
    displayValue,
    svgRef,
  ]);

  if (type === "qr") {
    return (
      <QRCodeSVG
        {...props}
        aria-label={label}
        bgColor="transparent"
        className={className}
        fgColor="currentColor"
        level={level}
        ref={svgRef}
        role="img"
        size={size}
        value={value}
      />
    );
  }

  return (
    <>
      <svg
        {...props}
        aria-label={label}
        className={cn(invalid && "hidden", className)}
        ref={svgRef}
        role="img"
      />
      {invalid && (
        <p
          className="max-w-48 text-center font-primary text-sm text-muted-foreground"
          role="alert"
        >
          {lang.invalid}
        </p>
      )}
    </>
  );
}

export interface ScanCodeDownloadButtonProps
  extends Omit<ButtonProps, "children" | "size" | "onClick"> {}

/**
 * Icon button, pinned to the top-right corner, that appears on hover or focus and calls the root's `onDownload`.
 * Always visible on devices without hover. Renders nothing when `onDownload` isn't set.
 */
function ScanCodeDownloadButton({
  className,
  variant = "secondary",
  "aria-label": ariaLabel,
  ...props
}: ScanCodeDownloadButtonProps) {
  const { onDownload, svgRef, value, type, lang } = useScanCodeContext();
  if (!onDownload) return null;

  return (
    <Button
      {...props}
      aria-label={ariaLabel ?? lang.download}
      className={cn(
        "absolute top-2 right-2 opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
        className,
      )}
      onClick={() =>
        onDownload({
          svg: svgRef.current,
          type,
          value,
        })
      }
      size="icon"
      variant={variant}
    >
      <Button.Icon icon={Download} />
    </Button>
  );
}

/**
 * Compound component that renders a QR code or a barcode and reveals a download button on hover.
 * The download itself is the consumer's: it arrives through `onDownload`.
 */
export const ScanCode = Object.assign(ScanCodeRoot, {
  Canvas: ScanCodeCanvas,
  DownloadButton: ScanCodeDownloadButton,
});
