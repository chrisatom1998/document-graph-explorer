// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as THREE from 'three';
import { syncSceneLabel, type SceneLabel } from './systemLabel';
import SceneText from './SceneText';

let label: SceneLabel;
vi.mock('@react-three/drei', async () => {
  const React = await import('react');
  return {
    Text: React.forwardRef((_props, ref) => {
      React.useImperativeHandle(ref, () => label, []);
      return null;
    }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SceneText resource ownership', () => {
  it('retains the live fallback across ref changes and releases it on unmount', () => {
    const context = {
      measureText: () => ({ width: 64 }), scale: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    label = Object.assign(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()), {
      text: '', sync: vi.fn(), fontSize: 2,
    });
    const firstRef = vi.fn();
    const view = render(<SceneText ref={firstRef}>{''}</SceneText>);
    expect(firstRef).toHaveBeenCalledWith(label);
    syncSceneLabel(label, '東京 📚');
    const child = label.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    const disposeTexture = vi.spyOn(child.material.map!, 'dispose');
    const nextRef = vi.fn();
    view.rerender(<SceneText ref={nextRef}>{''}</SceneText>);
    expect(nextRef).toHaveBeenCalledWith(label);
    expect(label.children).toEqual([child]);
    expect(disposeTexture).not.toHaveBeenCalled();
    view.unmount();
    expect(label.children).toHaveLength(0);
    expect(disposeTexture).toHaveBeenCalledOnce();
  });
});
