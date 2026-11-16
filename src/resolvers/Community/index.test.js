import { describe, it, expect, vi } from 'vitest';
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

// REA-54: the organizer's photo on /communities/<slug> is the avatar of their speaker profile.
// Strapi only sends it when the populate asks for it; without it, speaker came back null.
describe('community queries populate the organizers photo', () => {
  const PATHS = ['organizers', 'organizers.speaker', 'organizers.speaker.avatar'];
  const community = { documentId: 'c-1', organizers: [] };

  it('communityBySlugOrId and communities ask Strapi for organizers.speaker.avatar', async () => {
    const findCommunities = vi.fn().mockResolvedValue({ data: [community] });
    const ctx = { dataSources: { managerIntegration: { findCommunities } } };

    await Community.Query.communityBySlugOrId(null, { slugOrId: 'techstars' }, ctx);
    await Community.Query.communities(null, {}, ctx);

    for (const [args] of findCommunities.mock.calls) {
      expect(args.populate).toEqual(expect.arrayContaining(PATHS));
    }
  });

  it('community(id) asks for it too', async () => {
    const findCommunityById = vi.fn().mockResolvedValue({ data: community });
    const ctx = { dataSources: { managerIntegration: { findCommunityById } } };

    await Community.Query.community(null, { id: 'c-1' }, ctx);

    expect(findCommunityById.mock.calls[0][1]).toEqual(expect.arrayContaining(PATHS));
  });
});
