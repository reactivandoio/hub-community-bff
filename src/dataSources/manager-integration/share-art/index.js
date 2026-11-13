import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

// REA-43: the custom "eu vou" art of an event (api::share-art-config in hub-community-backend).

const POPULATE = [
  'story_background', 'story_photo_area', 'story_name_text', 'story_role_text',
  'feed_background', 'feed_photo_area', 'feed_name_text', 'feed_role_text',
  'event',
];

// An event is addressed by its slug or by its documentId, as everywhere else.
const findShareArtConfigByEvent = async (slugOrId, headers) => {
  const filters = {
    event: {
      or: [
        { slug: { eq: slugOrId } },
        { documentId: { eq: slugOrId } },
      ],
    },
  };
  const query = buildQuery(filters, [], { pageSize: 1 }, '', POPULATE);
  const response = await fetch(`/share-art-configs?${query}`, 'GET', headers);
  return response?.data?.[0] || null;
};

const createShareArtConfig = (data, headers) => {
  const query = buildQuery({}, [], {}, '', POPULATE);
  return fetch(`/share-art-configs?${query}`, 'POST', headers, { data });
};

const updateShareArtConfig = (documentId, data, headers) => {
  const query = buildQuery({}, [], {}, '', POPULATE);
  return fetch(`/share-art-configs/${encodeURIComponent(documentId)}?${query}`, 'PUT', headers, { data });
};

// A file of the media library, with its width/height (to check the ratio of a background).
const findUploadFile = async (id, headers) => {
  const response = await fetch(`/upload/files/${encodeURIComponent(id)}`, 'GET', headers);
  return response?.data || null;
};

const shareArt = ({ headers }) => ({
  findShareArtConfigByEvent: (slugOrId) => findShareArtConfigByEvent(slugOrId, headers),
  createShareArtConfig: (data) => createShareArtConfig(data, headers),
  updateShareArtConfig: (documentId, data) => updateShareArtConfig(documentId, data, headers),
  findUploadFile: (id) => findUploadFile(id, headers),
});

export default shareArt;
