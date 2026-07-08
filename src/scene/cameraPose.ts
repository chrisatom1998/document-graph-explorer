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
