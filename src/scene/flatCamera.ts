import type { CameraPose } from '../store/uiStore';

export const MIN_FLAT_CAMERA_DISTANCE = 8;

/**
 * Turn any saved/live camera pose into a front-on view of the z=0 map plane.
 *
 * 2D uses the same PerspectiveCamera as 3D so search, selection, collaboration,
 * saved views, and the minimap can keep one camera contract. The important
 * difference is orientation: the camera must sit directly above its target on
 * +z or a formerly rotated 3D camera sees the flat map edge-on.
 */
export function flattenCameraPose(
  pose: CameraPose,
  minDistance = MIN_FLAT_CAMERA_DISTANCE,
): CameraPose {
  const dx = pose.px - pose.tx;
  const dy = pose.py - pose.ty;
  const dz = pose.pz - pose.tz;
  const rawDistance = Math.hypot(dx, dy, dz);
  const distance = Number.isFinite(rawDistance)
    ? Math.max(rawDistance, minDistance)
    : minDistance;

  return {
    px: pose.tx,
    py: pose.ty,
    pz: distance,
    tx: pose.tx,
    ty: pose.ty,
    tz: 0,
  };
}
