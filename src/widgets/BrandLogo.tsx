// Brand mark for the dashboard — the vCom (An AppDirect Company) logo.
//
// Centralised so we have a single source of truth: change the asset
// file or the alt text here and every header / sign-in card / favicon
// usage updates together.
//
// The logo PNG lives in /public so it's served unhashed at a stable
// URL (used by index.html for the favicon + apple-touch-icon).
//
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
   * Whether to wrap the mark in a subtle rounded background + border.
   * Defaults to true.
   */
  framed?: boolean;
  /**
   * Legacy prop kept for compatibility. No longer used for cropping.
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
  cropZoom: _cropZoom = 165,
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

  // Framed: preserve the rounded tile treatment, but render the image
  // directly so uploaded logos are never cropped.
  const width = Math.round(size * aspectRatio);
  return (
    <Box
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width,
        height: size,
        borderRadius: 8,
        overflow: "hidden",
        border: "1px solid rgba(15, 23, 42, 0.08)",
        boxShadow: glowColor
          ? `0 0 14px ${glowColor}`
          : "0 1px 2px rgba(15, 23, 42, 0.08)",
        backgroundColor: "#a4c8db",
        padding: Math.max(4, Math.round(size * 0.08)),
      }}
    >
      <img
        src={BRAND_LOGO_SRC}
        alt={alt}
        style={{
          display: "block",
          maxWidth: "100%",
          maxHeight: "100%",
          width: "100%",
          height: "100%",
          objectFit: "contain",
          objectPosition: "center",
        }}
      />
    </Box>
  );
}
