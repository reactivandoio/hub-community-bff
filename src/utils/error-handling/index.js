// REA-35: what an error shows to whoever called the BFF.
//
// The stacktrace (with server paths) and the other internal details of an error only go out
// with EXPOSE_ERROR_DETAILS=true, which only the development .env sets. Nothing here reads
// NODE_ENV: without the flag, whatever NODE_ENV says, the answer carries only the message and
// the code, and the detail stays in the server log.

export const exposeErrorDetails = (env = process.env) =>
  String(env.EXPOSE_ERROR_DETAILS || '').trim().toLowerCase() === 'true';

const INTERNAL = 'INTERNAL_SERVER_ERROR';

// formatError of the ApolloServer. Apollo already cuts the stacktrace when
// includeStacktraceInErrorResponses is false; here the error also loses every extension but
// the code (a data source can put the upstream answer in extensions), and server errors are
// logged with the stack.
export const createFormatError = ({ expose = false, log = console.error } = {}) =>
  (formatted, error) => {
    const code = formatted.extensions?.code || INTERNAL;
    if (code === INTERNAL) {
      const original = error?.originalError || error;
      log(`[graphql] ${formatted.path ? `${formatted.path.join('.')}: ` : ''}${original?.stack || formatted.message}`);
    }
    if (expose) return formatted;
    const { message, locations, path } = formatted;
    return {
      message,
      ...(locations ? { locations } : {}),
      ...(path ? { path } : {}),
      extensions: { code },
    };
  };

// Last Express handler, for the REST routes and the body parser: Express' own handler answers
// with an HTML page holding the stack when NODE_ENV is not production.
export const createExpressErrorHandler = ({ expose = false, log = console.error } = {}) =>
  // eslint-disable-next-line no-unused-vars
  (err, req, res, next) => {
    // MulterError: file too large, too many files... It is the client's fault.
    const status = Number(err?.status || err?.statusCode || (err?.name === 'MulterError' ? 400 : 0));
    const httpStatus = status >= 400 && status < 600 ? status : 500;
    log(`[http] ${req.method} ${req.originalUrl || req.url} -> ${httpStatus}: ${err?.stack || err}`);
    if (res.headersSent) return next(err);
    // Client errors (bad JSON, file too large) keep a message they can act on; 5xx never
    // shows its own. Body parser messages quote the input, so they are replaced too.
    let error = 'Erro interno.';
    if (httpStatus < 500) error = err?.type ? 'Requisição inválida.' : err?.message || 'Requisição inválida.';
    const body = { error };
    if (expose) body.stack = err?.stack;
    return res.status(httpStatus).json(body);
  };
