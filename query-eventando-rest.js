require('dotenv').config();
const { EventandoManagerAPI } = require('./src/utils/network/eventando-manager');
const api = new EventandoManagerAPI();
api.initialize({ context: {} });
api.findEvents({
  filters: { uuid: { eq: "eckytmk6f1mw4dgdisgwnvwc" } },
  populate: ['products', 'products.batches']
}).then(res => console.log(JSON.stringify(res, null, 2))).catch(console.error);
