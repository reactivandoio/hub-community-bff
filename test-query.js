const https = require('https');

const query = `
  query {
    eventBySlugOrId(slugOrId: "eckytmk6f1mw4dgdisgwnvwc") {
      id
      title
      products {
        id
        name
        enabled
      }
    }
  }
`;

const req = https.request('https://bff.hubcommunity.io/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log(JSON.stringify(JSON.parse(data), null, 2)));
});

req.write(JSON.stringify({ query }));
req.end();
