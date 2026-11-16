import { GraphQLError } from 'graphql';

// REA-51: errors of the termhub runs API ({"error":{"code","message"}}) and of the run events,
// turned into pt-BR messages for the admin. Nothing here ever carries the token.

export class TermhubError extends Error {
  constructor({ status = 0, code = 'UNKNOWN', message = '', retryAfter = null, candidates = null } = {}) {
    super(message || code);
    this.name = 'TermhubError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.candidates = candidates;
  }
}

const REASONS = {
  UNAUTHENTICATED: ['TERMHUB_TOKEN_INVALID', 'O termhub recusou o token (inválido, expirado ou revogado). Cadastre um novo token na configuração de IA.'],
  SCOPE_REQUIRED: ['TERMHUB_TOKEN_SCOPE', 'O token do termhub não tem o escopo "runs". Crie um token com esse escopo e salve de novo.'],
  NOT_FOUND: ['TERMHUB_NOT_FOUND', 'O termhub não encontrou o projeto (ou a run). Confira a chave do projeto na configuração de IA.'],
  AGENT_OUTDATED: ['TERMHUB_AGENT_OUTDATED', 'O agente do termhub da máquina está desatualizado. Atualize o agente e tente de novo.'],
  VALIDATION: ['TERMHUB_VALIDATION', 'O termhub recusou o pedido'],
  RATE_LIMITED: ['TERMHUB_RATE_LIMITED', 'Limite de runs do termhub atingido. Tente de novo em alguns minutos.'],
  NETWORK: ['TERMHUB_UNAVAILABLE', 'Não foi possível falar com o termhub agora. Tente de novo em instantes.'],
};

const reasonsOf = (candidates) => {
  const list = (Array.isArray(candidates) ? candidates : []).map((c) => c?.reason).filter(Boolean);
  return list.length ? ` (${[...new Set(list)].join('; ')})` : '';
};

/** The GraphQL error the admin sees for a TermhubError (or any other failure of the call). */
export const toGraphQLError = (err) => {
  if (err instanceof GraphQLError) return err;
  if (!(err instanceof TermhubError)) {
    return new GraphQLError(REASONS.NETWORK[1], { extensions: { code: REASONS.NETWORK[0] } });
  }
  if (err.code === 'NO_ACCOUNT_AVAILABLE') {
    return new GraphQLError(`Nenhuma conta de IA está disponível no termhub agora${reasonsOf(err.candidates)}. Tente mais tarde.`, {
      extensions: { code: 'TERMHUB_NO_ACCOUNT' },
    });
  }
  const known = REASONS[err.code];
  if (!known) {
    const message = err.status >= 500 || !err.status ? REASONS.NETWORK[1] : `O termhub recusou o pedido: ${err.message}`;
    return new GraphQLError(message, { extensions: { code: err.status >= 500 || !err.status ? 'TERMHUB_UNAVAILABLE' : 'TERMHUB_ERROR' } });
  }
  const [code, text] = known;
  const message = err.code === 'VALIDATION' ? `${text}: ${err.message}` : text;
  return new GraphQLError(message, {
    extensions: { code, ...(err.retryAfter ? { retryAfter: err.retryAfter } : {}) },
  });
};

// The `error` event of a run ({ code, message }), in the words of the admin screen.
const RUN_ERRORS = {
  account_limited: 'A conta de IA do termhub atingiu o limite de uso.',
  cli_failed: 'A IA falhou ao rodar no termhub.',
  timeout: 'A geração passou do tempo limite.',
  agent_offline: 'A máquina do termhub que roda a IA está offline.',
  permission_denied: 'O termhub negou a permissão para esta run.',
};

export const runErrorMessage = (code, message) => {
  const base = RUN_ERRORS[code] || 'A geração falhou no termhub.';
  return message && !RUN_ERRORS[code] ? `${base} ${message}` : base;
};

export const isServerRestart = (error) =>
  error?.code === 'cli_failed' && /server restarted/i.test(String(error?.message || ''));
