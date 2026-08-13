/**
 * Per-frame camera pose, kept out of React (same pattern as positionBuffer).
 * CameraRig writes position + orbit target every frame; the Minimap overlay
 * (a plain 2D canvas outside the R3F tree) reads it on its own cadence to
 * draw the viewport indicator.
 */

export const cameraPose = {
  px: 0,
  py: 0,
  pz: 160,
  tx: 0,
  ty: 0,
  tz: 0,
  fov: 55, // vertical, degrees — sizes the minimap viewport box
  aspect: 16 / 9,
};

/**
 * Place the camera on +Z of the current target so a 2D (z=0) layout is
 * seen face-on. Polar-equator clamp alone keeps a leftover 3D azimuth,
 * which can look edge-on at the flattened graph (blank main view, live
 * minimap).
 */
export function faceLayoutPlane(
  px: number,
  py: number,
  pz: number,
  tx: number,
  ty: number,
  tz: number,
  minDist = 40,
): { px: number; py: number; pz: number; tx: number; ty: number; tz: number } {
  const dist = Math.max(Math.hypot(px - tx, py - ty, pz - tz), minDist);
  return { px: tx, py: ty, pz: tz + dist, tx, ty, tz };
}
