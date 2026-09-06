export interface LabelBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Perspective billboards keep the same readable CSS size at every zoom. */
export function labelWorldScale(
  fontSize: number,
  pixelSize: number,
  viewDepth: number,
  projectionY: number,
  viewportHeight: number,
): number {
  const pixelsPerWorldUnit = (viewportHeight * projectionY) / (2 * viewDepth);
  if (!Number.isFinite(pixelsPerWorldUnit) || pixelsPerWorldUnit <= 0 || fontSize <= 0) {
    return 0;
  }
  return pixelSize / (fontSize * pixelsPerWorldUnit);
}

/** Conservative Inter metrics reserve breathing room until SDF glyphs are ready. */
export function labelBounds(
  x: number,
  y: number,
  text: string,
  pixelSize: number,
  flat: boolean,
  maxWidth: number,
): LabelBounds {
  const estimatedWidth = Math.max(pixelSize, text.length * pixelSize * 0.62);
  const width = Math.min(estimatedWidth, maxWidth);
  const height = Math.ceil(estimatedWidth / maxWidth) * pixelSize * 1.35;
  const left = flat ? x : x - width / 2;
  const top = flat ? y - height / 2 : y - height;
  return { left: left - 5, top: top - 4, right: left + width + 5, bottom: top + height + 4 };
}

export function labelsOverlap(a: LabelBounds, b: LabelBounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
