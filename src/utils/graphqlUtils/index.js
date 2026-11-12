/* eslint-disable array-callback-return */
/* eslint-disable no-underscore-dangle */
/* eslint-disable consistent-return */
const isArray = (payload) => Array.isArray(payload);

const parseShadowResults = (response) => {
  let payload = null;
  if (response?.data?.data) {
    payload = response.data.data;
  }

  if (response?.data) {
    payload = response.data;
  }

  if (!response.data || !response.data.data) {
    payload = response;
  }

  if (payload === null) {
    return;
  }

  if (typeof payload !== 'object') {
    return;
  }

  let dataToParse;

  if (isArray(payload)) {
    dataToParse = [...payload];
  }

  if (!dataToParse) {
    dataToParse = { ...payload };
  }

  Object.keys(dataToParse).map((item) => {
    if (isArray(dataToParse[item])) {
      const parsedData = [];

      // Strings, numbers and nulls in a list (e.g. the REA-34 `warnings`) stay as they are.
      dataToParse[item].map((obj) => {
        parsedData.push(obj !== null && typeof obj === 'object' ? parseShadowResults(obj) : obj);
      });

      dataToParse[item] = parsedData;
      return;
    }

    if (dataToParse[item] === null) {
      return;
    }

    if (typeof dataToParse[item] === 'object') {
      if (item === 'attributes') {
        const tempId = dataToParse.id;

        dataToParse = {
          ...dataToParse[item],
        };

        if (tempId) {
          dataToParse.id = tempId;
        }

        const sweepedData = parseShadowResults(dataToParse);
        dataToParse = { ...dataToParse, ...sweepedData };
        delete dataToParse.__typename;
        return;
      }

      if (dataToParse[item].attributes) {
        const tempId = dataToParse[item].id;

        dataToParse[item] = {
          ...dataToParse[item].attributes,
        };

        if (tempId) {
          dataToParse[item].id = tempId;
        }

        const sweepedData = parseShadowResults(dataToParse[item]);
        dataToParse[item] = { ...dataToParse[item], ...sweepedData };
        delete dataToParse[item].__typename;
        return;
      }

      if (dataToParse[item].data) {
        if (isArray(dataToParse[item].data)) {
          dataToParse[item] = [...dataToParse[item].data];
          dataToParse[item] = parseShadowResults(dataToParse[item]);
          return;
        }

        if (typeof dataToParse[item].data === 'object') {
          const tempId = dataToParse[item].data.id;

          dataToParse[item] = {
            ...dataToParse[item].data.attributes,
          };

          if (tempId) {
            dataToParse[item].id = tempId;
          }

          const sweepedData = parseShadowResults(dataToParse[item]);
          dataToParse[item] = { ...dataToParse[item], ...sweepedData };

          delete dataToParse[item].data;
          delete dataToParse[item].__typename;
          return parseShadowResults(dataToParse[item]);
        }
      }
    }
  });
  return dataToParse;
};

export default parseShadowResults;
