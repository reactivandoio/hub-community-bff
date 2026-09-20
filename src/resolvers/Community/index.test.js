import { describe, it, expect } from 'vitest';
import Community from './index';

describe('Community.events', () => {
  it('leaves out the unlisted events, so they stay off the community page', () => {
    const events = [
      { id: '1', title: 'Meetup' },
      { id: '2', title: 'Interno', unlisted: true },
      { id: '3', title: 'Antigo', unlisted: null },
    ];
    expect(Community.Community.events({ events }).map((e) => e.id)).toEqual(['1', '3']);
  });

  it('is an empty list when the community has no events populated', () => {
    expect(Community.Community.events({})).toEqual([]);
  });
});
