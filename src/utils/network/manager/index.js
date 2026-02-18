/* eslint-disable import/no-extraneous-dependencies */
import dotenv from 'dotenv';
import { buildQuery, createStrapiFetch } from '../strapi/helpers';

dotenv.config();

const fetch = createStrapiFetch(process.env.MANAGER_URL);

const managerNetworkUtils = {
  fetch,
  buildQuery,
};

export default managerNetworkUtils;
