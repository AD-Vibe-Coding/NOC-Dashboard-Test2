// Brand mark for the dashboard — the vCom (An AppDirect Company) logo.
//
// Centralised so we have a single source of truth: change the asset
// file or the alt text here and every header / sign-in card / favicon
// usage updates together.
//
// The logo PNG lives in /public so it's served unhashed at a stable
// URL (used by index.html for the favicon + apple-touch-icon).
//
// CROP NOTE: the source PNG has substantial empty light-blue padding
// around the actual cube + "vCom" wordmark. In framed mode we render
// it as a centered background-image with `background-size: <zoom>% auto`
// so the empty padding is clipped by the frame and the brand fills the
// box. The default `cropZoom = 165` lands the cube + wordmark cleanly
// inside the rectangle.
import { Box } from "@mantine/core";

export const BRAND_LOGO_SRC = "/vcom-logo.png";
export const BRAND_NAME = "vCom";
export const BRAND_TAGLINE = "An AppDirect Company";

interface BrandLogoProps {
  /**
   * Rendered height in pixels. In framed mode this is the height of
   * the cropped frame; width auto-derives from `aspectRatio`. In
   * unframed mode this is the natural image height and width follows
   * the PNG's own aspect ratio.
   * Defaults to 32 (header size).
   */
  size?: number;
  /**
   * Whether to wrap the mark in a subtle rounded background + border
   * AND apply the zoom-crop. Looks great on dark surfaces. Defaults
   * to true.
   */
  framed?: boolean;
  /**
   * How aggressively to zoom into the source image when cropping.
   * 100 = no crop (full PNG with padding visible). 165 (default)
   * crops the empty light-blue padding so the cube + "vCom"
   * wordmark fill the frame nicely. Values above ~190 start to clip
   * the wordmark.
   */
  cropZoom?: number;
  /**
   * Aspect ratio (width / height) of the cropped frame. The source
   * PNG is roughly 1.78:1 (16:9). We default to 2.6 which keeps the
   * cube + wordmark proportional inside a wider header rectangle.
   * Use 1 for a square crop.
   */
  aspectRatio?: number;
  /**
   * Optional drop-shadow color (CSS color). Used by the header to
   * tint the mark with the current role's accent color.
   */
  glowColor?: string;
  /** Accessible label. Defaults to "vCom — An AppDirect Company". */
  alt?: string;
}

export function BrandLogo({
  size = 32,
  framed = true,
  cropZoom = 165,
  aspectRatio = 2.6,
  glowColor,
  alt = `${BRAND_NAME} — ${BRAND_TAGLINE}`,
}: BrandLogoProps) {
  // Unframed: render the raw <img> so the user sees the full PNG with
  // its natural proportions and padding (rarely used).
  if (!framed) {
    return (
      <img
        src={BRAND_LOGO_SRC}
        alt={alt}
        height={size}
        style={{
          display: "block",
          height: size,
          width: "auto",
          objectFit: "contain",
        }}
      />
    );
  }

  // Framed: a fixed-size div with the logo as a centered, zoomed
  // background. `background-size: <cropZoom>% auto` (centered) means
  // we visually scale the image up while the box clips the
  // overflowing padding — yielding a clean, brand-filled tile.
  const width = Math.round(size * aspectRatio);
  return (
    <Box
      role="img"
      aria-label={alt}
      style={{
        display: "inline-block",
        width,
        height: size,
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid rgba(15, 23, 42, 0.08)",
        boxShadow: glowColor
          ? `0 0 14px ${glowColor}`
          : "0 1px 2px rgba(15, 23, 42, 0.08)",
        backgroundImage: `url(${BRAND_LOGO_SRC})`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        // `<cropZoom>% auto` => width = cropZoom% of container, height
        // auto-derived. Combined with center positioning this crops
        // the empty light-blue padding evenly on all sides.
        backgroundSize: `${cropZoom}% auto`,
        // The source PNG has a light-blue background (#a4c8db-ish).
        // Match it on the frame so any rounding-gap pixels blend in
        // instead of showing a hairline at the corners.
        backgroundColor: "#a4c8db",
      }}
    />
  );
}
