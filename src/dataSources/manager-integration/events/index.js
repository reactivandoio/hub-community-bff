import managerNetworkUtils from '../../../utils/network/manager';

const { fetch, buildQuery } = managerNetworkUtils;

const createEvent = (data, headers) =>
    fetch('/events', 'POST', headers, { data });

const updateEvent = (id, data, headers) =>
    fetch(`/events/${id}`, 'PUT', headers, { data });

const deleteEvent = (id, headers) =>
    fetch(`/events/${id}`, 'DELETE', headers);

const findEventBySlug = async (slug, headers) => {
    const filters = { slug: { eq: slug } };
    const pagination = { pageSize: 1 };
    const populate = [
        'products',
        'products.batches',
        'talks.speakers',
        'talks.speakers.avatar',
        'images',
        'communities',
        'location',
        'tags',
    ];

    const query = buildQuery(filters, [], pagination, '', populate);
    const route = `/events${query ? `?${query}` : ''}`;

    return fetch(route, 'GET', headers);
};

const updateEventBySlug = async (slug, data, headers) => {
    const response = await findEventBySlug(slug, headers);
    const event = response?.data?.[0];
    if (!event) throw new Error(`Event with slug ${slug} not found`);
    return updateEvent(event.id, data, headers);
};

const deleteEventBySlug = async (slug, headers) => {
    const response = await findEventBySlug(slug, headers);
    const event = response?.data?.[0];
    if (!event) throw new Error(`Event with slug ${slug} not found`);
    return deleteEvent(event.id, headers);
};

const events = ({ headers }) => ({
    createEvent: (data) => createEvent(data, headers),
    updateEvent: (id, data) => updateEvent(id, data, headers),
    deleteEvent: (id) => deleteEvent(id, headers),
    findEventBySlug: (slug) => findEventBySlug(slug, headers),
    updateEventBySlug: (slug, data) => updateEventBySlug(slug, data, headers),
    deleteEventBySlug: (slug) => deleteEventBySlug(slug, headers),
});

export default events;
