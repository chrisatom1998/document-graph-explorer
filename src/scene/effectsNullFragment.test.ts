import { describe, expect, it } from 'vitest';
import React from 'react';

describe('Effects null fragment rendering verification', () => {
  it('evaluates (null as unknown as React.ReactElement) to null without creating React.Fragment nodes', () => {
    const dofOn = false;
    const element = dofOn ? React.createElement('div') : (null as unknown as React.ReactElement);
    expect(element).toBeNull();
    expect(element).not.toEqual(React.createElement(React.Fragment));
  });

  it('filters out null children when passed into component children array like EffectComposer', () => {
    const dofOn = false;
    const children = [
      React.createElement('div', { key: '1' }),
      dofOn ? React.createElement('div', { key: '2' }) : (null as unknown as React.ReactElement),
      React.createElement('div', { key: '3' }),
    ];
    const filtered = React.Children.toArray(children);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((child) => React.isValidElement(child))).toBe(true);
  });
});
