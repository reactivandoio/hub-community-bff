/* eslint-disable import/no-extraneous-dependencies */
import dotenv from 'dotenv';
import { buildQuery, createStrapiFetch } from '../strapi/helpers';

dotenv.config();

const fetch = createStrapiFetch(process.env.EVENTANDO_MANAGER_URL);

const eventandoNetworkUtils = {
    fetch,
    buildQuery,
};

export default eventandoNetworkUtils;
