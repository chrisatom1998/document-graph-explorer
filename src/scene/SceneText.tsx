import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Text, type TextProps } from '@react-three/drei';
import { disposeSceneLabel, type SceneLabel } from './systemLabel';

/** The wrapper owns fallback resources for exactly the lifetime of its Text. */
const SceneText = forwardRef<SceneLabel, TextProps>(function SceneText(props, ref) {
  const mesh = useRef<SceneLabel>(null);
  useImperativeHandle(ref, () => mesh.current!, []);
  useEffect(() => {
    const label = mesh.current;
    // Geometry disposal also occurs during Troika buffer resizing; callback
    // refs also clear during rerenders. Neither event means this pool slot died.
    return () => { if (label) disposeSceneLabel(label); };
  }, []);
  return <Text {...props} ref={mesh} />;
});

export default SceneText;
