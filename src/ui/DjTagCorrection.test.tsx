// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DjTagCorrection from './DjTagCorrection';
import type { DocNode } from '../model/types';
it('searches category aliases while retaining checked tags outside the search', () => {
  const node = {id:'clip', audio:{confirmedDjTags:{source:['voice'],production:['vocal chops'],character:[]}}} as unknown as DocNode;
  render(<DjTagCorrection node={node}/>);
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'reese'}});
  expect(screen.getByLabelText('reese bass')).toBeDefined();
  expect(screen.getByLabelText('vocal chops')).toHaveProperty('checked',true);
  expect(screen.queryByLabelText('riser')).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'uplifter'}});
  expect(screen.getByLabelText('riser')).toBeDefined();
});
it('finds a merged tag by the old name and its aliases', () => {
  const node = {id:'clip', audio:{confirmedDjTags:{source:[],production:[],character:[]}}} as unknown as DocNode;
  render(<DjTagCorrection node={node}/>);
  for (const value of ['vocal harmony', 'harmony vocals']) {
    fireEvent.change(screen.getByRole('searchbox'),{target:{value}});
    expect(screen.getByLabelText('choir')).toBeDefined();
  }
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'303 bass'}});
  expect(screen.getByLabelText('acid synth')).toBeDefined();
  expect(screen.queryByLabelText('acid bass')).toBeNull();
});
it('lists rarely used tags only when searched for, or when already picked', () => {
  const node = {id:'clip', audio:{confirmedDjTags:{source:['cello'],production:[],character:[]}}} as unknown as DocNode;
  render(<DjTagCorrection node={node}/>);
  expect(screen.getByLabelText('kick')).toBeDefined();
  expect(screen.queryByLabelText('oboe')).toBeNull();
  expect(screen.queryByLabelText('rolling')).toBeNull();
  expect(screen.getByLabelText('syncopated')).toBeDefined();
  expect(screen.getByLabelText('cello')).toHaveProperty('checked',true);
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'oboe'}});
  expect(screen.getByLabelText('oboe')).toBeDefined();
});
