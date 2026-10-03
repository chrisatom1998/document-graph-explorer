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
