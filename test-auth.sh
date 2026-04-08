TOKEN="c25c632c0bc8073954af7339c692b0d504c449accd2d7e9f82d1fd9ce32a94665af16e495106817581353c448cea5ce5680c2c72146e903d2286c71751c03ef17fa05d87803c5a11f5e3f9bd34296829156e9ba52cd128e70c76716445141e9d3784f7a1ed1e31a6fdcc7adbe54d11a7849e05d69edd80b66daaade1a109188a"
echo "Testing createProduct"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://eventando.hubcommunity.io/api/products" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"data":{"name":"AuthTest","event":14}}'
echo "Testing updateEvent"
curl -s -o /dev/null -w "%{http_code}\n" -X PUT "https://eventando.hubcommunity.io/api/events/14" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"data":{"max_slots":50}}'
echo "Testing findEvents"
curl -s -o /dev/null -w "%{http_code}\n" -X GET "https://eventando.hubcommunity.io/api/events?filters\[id\]\[\$eq\]=14" -H "Authorization: Bearer $TOKEN"
