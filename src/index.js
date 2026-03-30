/* eslint-disable import/no-extraneous-dependencies */
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import multer from 'multer';
import FormData from 'form-data';
import fetch from 'node-fetch';

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

  // File upload endpoint - proxies to Strapi upload API
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Apenas imagens são permitidas.'));
      }
    },
  });

  app.post('/upload', cors(), upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }

      const managerUrl = process.env.MANAGER_URL || 'https://manager.hubcommunity.io';
      const token = process.env.MANAGER_TOKEN_INTEGRATION;

      // Build form data to send to Strapi
      const formData = new FormData();
      formData.append('files', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      const response = await fetch(`${managerUrl}/api/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...formData.getHeaders(),
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Strapi upload error:', errorText);
        return res.status(response.status).json({ error: 'Erro ao fazer upload.' });
      }

      const data = await response.json();
      // Strapi returns an array of uploaded files
      const uploadedFile = data[0];
      const fileUrl = uploadedFile.url.startsWith('http')
        ? uploadedFile.url
        : `${managerUrl}${uploadedFile.url}`;

      return res.json({
        url: fileUrl,
        id: uploadedFile.id,
        name: uploadedFile.name,
      });
    } catch (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ error: 'Erro interno ao fazer upload.' });
    }
  });

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
