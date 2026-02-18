/* eslint-disable import/no-extraneous-dependencies */
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';

import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { createServer } from 'http';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import jwt from './utils/jwt';

import getTypes from './types';
import getResolvers from './resolvers';

import dataSources from './dataSources';

const startServer = async () => {
  const typeDefs = await getTypes();
  const resolvers = getResolvers();

  const app = express();
  const httpServer = createServer(app);

  const schema = makeExecutableSchema({
    typeDefs,
    resolvers,
  });

  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/',
  });

  const serverCleanup = useServer(
    {
      schema,
      context: async (ctx) => {
        const headers = {
          Authorization:
            ctx.connectionParams.authorization ||
            ctx.connectionParams.Authorization,
          'accept-language': ctx.connectionParams['accept-language'] || 'pt-br',
        };

        let user;

        if (headers.authorization) {
          try {
            user = jwt.decode(headers.authorization);
          } catch (_) {
            // do anything
          }
        }

        return {
          user,
          headers,
          dataSources: dataSources(headers),
        };
      },
    },
    wsServer,
  );

  const apolloServer = new ApolloServer({
    schema,
    plugins: [
      // Proper shutdown for the HTTP server.
      ApolloServerPluginDrainHttpServer({ httpServer }),

      // Proper shutdown for the WebSocket server.
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  });

  await apolloServer.start();

  app.use(
    '/',
    cors(),
    bodyParser.json(),
    expressMiddleware(apolloServer, {
      context: async ({ req }) => {
        const acceptLanguage = req.headers['accept-language'] || 'en';

        const headers = {
          Authorization: req.headers.authorization || req.headers.Authorization,
          'accept-language': acceptLanguage,
        };

        const dataSourcesInstance = dataSources(headers);

        let user;
        let decodedToken;

        if (headers.Authorization) {
          try {
            decodedToken = jwt.decode(headers.Authorization);
          } catch (err) {
            throw new Error(`Error decoding token: ${err.message}`);
          }

          try {
            const response = await dataSourcesInstance.managerAuthenticated.me({
              userId: decodedToken.id,
            });

            user = response.data;
          } catch (err) {
            throw new Error(`Error fetching user: ${err.message}`);
          }
        }

        return {
          user,
          dataSources: dataSourcesInstance,
          acceptLanguage,
        };
      },
    }),
  );

  const PORT = process.env.PORT || 4001;
  // Now that our HTTP server is fully set up, we can listen to it.
  httpServer.listen(PORT, () => {
    console.log(`Server is now running on http://localhost:${PORT}/`);
  });

  return `http://localhost:${PORT}/`;
};

startServer()
  .then((url) => {
    console.log(`🚀 Server ready at: ${url}`);
  })
  .catch((err) => {
    console.log('Failed to start server', err);
  });
