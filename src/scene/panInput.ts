/**
 * Arrow-key pan bridge, kept out of React (same pattern as cameraPose).
 *
 * App owns the global keyboard (see App.tsx) and writes the current pan
 * direction here on arrow key down/up: x = +1 right / -1 left, y = +1 up /
 * -1 down, 0 when the axis isn't held. CameraRig reads it every frame and
 * applies a smooth, framerate-independent pan. A plain mutable object so the
 * ~60fps read path never triggers a React render.
 */

export const panInput = { x: 0, y: 0 };
