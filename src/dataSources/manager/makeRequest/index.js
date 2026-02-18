/* eslint-disable import/no-extraneous-dependencies */
import axios from 'axios';

import dotenv from 'dotenv';
import graphqlUtils from '../../utils/graphqlUtils';

dotenv.config();

// Helper to recursively flatten filters into nested bracket notation for Strapi
const OPERATORS = new Set([
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'notIn',
  'contains',
  'notContains',
  'containsi',
  'notContainsi',
  'null',
  'notNull',
  'between',
  'startsWith',
  'endsWith',
  'or',
  'and',
  'not',
  'some',
  'every',
  'none',
  'is',
  'notIn',
  'like',
  'notLike',
  'iLike',
  'notILike',
  'overlap',
  'contains',
  'contained',
  'any',
  'all',
  'exists',
  'regex',
  'search',
  'size',
  'elemMatch',
]);

function flattenFiltersForStrapi(obj, path = []) {
  let result = [];
  Object.keys(obj).forEach((key) => {
    if (OPERATORS.has(key)) {
      // This key is an operator, so use the path as the field path
      result.push({ path: [...path], op: key, value: obj[key] });
    } else if (
      typeof obj[key] === 'object' &&
      obj[key] !== null &&
      !Array.isArray(obj[key])
    ) {
      // Recurse deeper
      const nested = flattenFiltersForStrapi(obj[key], [...path, key]);
      result = result.concat(nested);
    } else {
      // Primitive value, treat as eq
      result.push({ path: [...path, key], op: 'eq', value: obj[key] });
    }
  });
  return result;
}

/**
 * Build query string for Strapi v5 API
 * @param {Object} filters - Filters object
 * @param {Array} sort - Sort array
 * @param {Object} pagination - Pagination object
 * @param {String} search - Search string
 * @param {Array} populate - Populate array
 * @returns {String} Query string
 */
const buildQuery = (
  filters = {},
  sort = [],
  pagination = {},
  search = '',
  populate = []
) => {
  const params = new URLSearchParams();

  // Add pagination
  if (pagination.page) params.append('pagination[page]', pagination.page);
  if (pagination.pageSize)
    params.append('pagination[pageSize]', pagination.pageSize);

  // Add search
  if (search) {
    params.append('filters[$or][0][title][$containsi]', search);
    params.append('filters[$or][1][description][$containsi]', search);
    params.append('filters[$or][2][name][$containsi]', search);
  }

  // Add filters (flattened for Strapi with nested brackets)
  const flatFilters = flattenFiltersForStrapi(filters);
  flatFilters.forEach(({ path, op, value }) => {
    let val = value;
    if (Array.isArray(val)) {
      val = val.join(',');
    }
    // Build nested bracket notation for the path
    const field = path.reduce((acc, curr) => `${acc}[${curr}]`, 'filters');
    params.append(`${field}[$${op}]`, val);
  });

  // Add sort
  let sortIndex = 0;
  sort.forEach((sortItem) => {
    if (typeof sortItem === 'object' && sortItem !== null) {
      // Handle object-based sort (like { id: 'ASC', title: 'DESC' })
      Object.keys(sortItem).forEach((field) => {
        if (sortItem[field] && sortItem[field] !== null) {
          params.append(
            `sort[${sortIndex}]`,
            `${field}:${sortItem[field].toLowerCase()}`
          );
          sortIndex += 1;
        }
      });
    } else if (sortItem.field && sortItem.order) {
      // Handle array-based sort (like [{ field: 'id', order: 'ASC' }])
      params.append(
        `sort[${sortIndex}]`,
        `${sortItem.field}:${sortItem.order.toLowerCase()}`
      );
      sortIndex += 1;
    }
  });

  // Add populate
  populate.forEach((popItem, index) => {
    params.append(`populate[${index}]`, popItem);
  });

  return params.toString();
};

/**
 * Generic fetch function for Strapi v5
 * @param {String} route - API route
 * @param {String} method - HTTP method
 * @param {Object} customHeaders - Custom headers
 * @param {Object} body - Request body
 * @returns {Object} Response data
 */
const fetch = async (route, method, customHeaders = {}, body = null) => {
  let response;

  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  const url = `${process.env.MANAGER_URL}/api${route}`;

  console.log(`[${method}] - ${decodeURIComponent(url)}`);

  try {
    response = await axios({
      method,
      url,
      headers,
      data: body,
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.log('error: ', error.message);
    }

    throw new Error(`Error on try ${method} in ${url}`);
  }

  if (process.env.NODE_ENV === 'production') {
    console.info(`[${method}] ${route}`);
  }

  const meta = response?.data?.meta?.pagination || null;

  if (response.data.data) {
    return {
      data: graphqlUtils(response.data.data),
      meta,
    };
  }

  return {
    data: graphqlUtils(response.data),
    meta,
  };
};

const makeRequest = {
  fetch,
  buildQuery,
};

export default makeRequest;
