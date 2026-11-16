import crypto from 'crypto';
import { GraphQLError } from 'graphql';
import { createTermhubClient, baseUrlOf } from './client';
import { decryptToken, encryptToken, hasTokenKey, tokenHint, TermhubKeyError } from './crypto';
import { TermhubError, isServerRestart, runErrorMessage, toGraphQLError } from './errors';
import { parseDraft, resultText } from './prompt';

// REA-51: AI drafts of e-mail campaign texts through the termhub runs API, with the personal token
// each admin user saved. The BFF creates the run (capabilities ["read"], always an idempotency_key),
// follows its events (SSE) in the background, and keeps the progress in memory and the result in
// api::ai-text-run; the admin page polls `aiTextGeneration`. The draft only goes back to the form:
// nothing here sends an e-mail.
//
// Limits of the contract, per token (= per user here): 2 runs at a time and 30 an hour. They are
// checked from api::ai-text-run before calling termhub (a clearer message than a 429), and termhub
// enforces them anyway (a 429 is waited out by the client).

export const LIMITS = Object.freeze({ concurrent: 2, perHour: 30 });
export const RUN_TIMEOUT_S = 300;
const HOUR_MS = 60 * 60 * 1000;
// A run still "active" in the table after this long is not counted against the concurrent limit
// (its BFF died before writing the end; polling it resumes the stream and settles it).
const STALE_MS = 20 * 60 * 1000;
const MAX_PREVIEW = 4000;
const ACTIVE = ['queued', 'running'];
const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

const userError = (message, code = 'BAD_USER_INPUT', extensions = {}) =>
  new GraphQLError(message, { extensions: { code, ...extensions } });

export const notConfiguredError = () => userError(
  'Configure o seu token do termhub antes de gerar textos com IA.',
  'TERMHUB_NOT_CONFIGURED',
);

const keyError = (err) => userError(err.message, 'TERMHUB_TOKEN_UNREADABLE');

const cleanToken = (token) => {
  const t = String(token || '').trim();
  if (!t) return '';
  if (/\s/.test(t) || t.length < 10 || t.length > 512) throw userError('Esse token do termhub não parece válido.');
  return t;
};

const cleanProject = (project) => {
  const p = String(project || '').trim();
  if (!PROJECT_RE.test(p)) throw userError('Informe a chave ou o id do projeto do termhub (ex.: TER).');
  return p;
};

/** What the screen may know about the saved credential. Never the token. */
export const toSettings = (row, env) => ({
  configured: Boolean(row),
  token_hint: row?.token_hint || null,
  project: row?.project || null,
  verified_at: row?.verified_at || null,
  server_ready: hasTokenKey(env),
  base_url: baseUrlOf(env),
});

export const createTermhubService = ({
  env = process.env,
  makeClient = (token) => createTermhubClient({ token, env }),
  now = () => new Date(),
  newKey = () => crypto.randomUUID(),
  log = console,
} = {}) => {
  // Runs followed by this process: generation id → { progress, controller, body }.
  const watchers = new Map();
  // Users with a start in flight in this process (double click).
  const starting = new Set();

  const requireServerKey = () => {
    if (!hasTokenKey(env)) {
      throw userError('A IA não está disponível neste servidor (falta TERMHUB_TOKEN_KEY).', 'TERMHUB_SERVER_NOT_READY');
    }
  };

  const tokenOf = (row, user) => {
    try {
      return decryptToken(row.token_ciphertext, user.id, env);
    } catch (err) {
      if (err instanceof TermhubKeyError) throw keyError(err);
      throw err;
    }
  };

  /** Lists one run of the project: checks token, scope and project without spending a run. */
  const check = async (token, project) => {
    try {
      await makeClient(token).listRuns({ project, limit: 1 });
    } catch (err) {
      throw toGraphQLError(err);
    }
  };

  // ---------------------------------------------------------------- settings

  const getSettings = async (integration, user) => toSettings(await integration.findTermhubCredential(user.id), env);

  const saveSettings = async (integration, user, input = {}) => {
    requireServerKey();
    const project = cleanProject(input.project);
    const typed = cleanToken(input.token);
    const row = await integration.findTermhubCredential(user.id);
    if (!typed && !row) throw userError('Cole o token do termhub.');
    const token = typed || tokenOf(row, user);
    await check(token, project);
    const data = {
      project,
      verified_at: now().toISOString(),
      user_email: user.email || null,
      ...(typed ? { token_ciphertext: encryptToken(token, user.id, env), token_hint: tokenHint(token) } : {}),
    };
    const saved = row
      ? await integration.updateTermhubCredential(row.documentId, data)
      : await integration.createTermhubCredential({ user_id: Number(user.id), ...data });
    return toSettings({ ...row, ...saved, ...data }, env);
  };

  const testSettings = async (integration, user) => {
    requireServerKey();
    const row = await integration.findTermhubCredential(user.id);
    if (!row) throw notConfiguredError();
    await check(tokenOf(row, user), row.project);
    const verified_at = now().toISOString();
    await integration.updateTermhubCredential(row.documentId, { verified_at });
    return toSettings({ ...row, verified_at }, env);
  };

  const deleteSettings = async (integration, user) => {
    const row = await integration.findTermhubCredential(user.id);
    if (row) await integration.deleteTermhubCredential(row.documentId);
    return toSettings(null, env);
  };

  // ---------------------------------------------------------------- generations

  const view = (row) => {
    const progress = watchers.get(row.documentId)?.progress;
    return {
      id: row.documentId,
      campaign_type: row.campaign_type,
      status: progress?.status || row.status,
      preview: progress?.preview || null,
      subject: row.subject || null,
      message: row.message ?? null,
      error_code: row.error_code || null,
      error_message: row.error_message || null,
      created_at: row.createdAt || null,
      finished_at: row.finished_at || null,
    };
  };

  const checkLimits = async (integration, user) => {
    const since = new Date(now().getTime() - HOUR_MS);
    const rows = (await integration.findAiTextRunsOfUserSince(user.id, since)).filter((r) => r.run_id);
    const fresh = now().getTime() - STALE_MS;
    const active = rows.filter((r) => ACTIVE.includes(r.status) && Date.parse(r.createdAt) > fresh);
    if (active.length >= LIMITS.concurrent) {
      throw userError(
        `Já há ${LIMITS.concurrent} gerações em andamento. Espere uma terminar ou cancele.`,
        'TERMHUB_BUSY',
      );
    }
    if (rows.length >= LIMITS.perHour) {
      const oldest = Date.parse(rows[0].createdAt) || now().getTime();
      const retryAfter = Math.max(1, Math.ceil((oldest + HOUR_MS - now().getTime()) / 1000));
      throw userError(
        `Limite de ${LIMITS.perHour} gerações por hora atingido. Tente de novo em ${Math.ceil(retryAfter / 60)} min.`,
        'TERMHUB_HOURLY_LIMIT',
        { retryAfter },
      );
    }
  };

  const settle = async (integration, row, data) => {
    const final = { ...data, finished_at: now().toISOString() };
    Object.assign(row, final);
    try {
      await integration.updateAiTextRun(row.documentId, final);
    } catch (err) {
      log.error?.(`[termhub] could not save generation ${row.documentId}: ${err.message}`);
    }
  };

  const finish = async (integration, row, done, progress) => {
    if (done.status === 'succeeded') {
      const draft = parseDraft(resultText(done.result)) || parseDraft(progress.lastText);
      if (draft) return settle(integration, row, { status: 'succeeded', subject: draft.subject, message: draft.message, last_seq: progress.lastSeq });
      return settle(integration, row, {
        status: 'failed',
        error_code: 'invalid_output',
        error_message: 'A IA respondeu fora do formato esperado. Tente gerar de novo.',
        last_seq: progress.lastSeq,
      });
    }
    if (done.status === 'cancelled') return settle(integration, row, { status: 'cancelled', last_seq: progress.lastSeq });
    const error = progress.error || {};
    return settle(integration, row, {
      status: 'failed',
      error_code: error.code || 'failed',
      error_message: isServerRestart(error)
        ? 'O termhub reiniciou durante a geração. Gere de novo.'
        : runErrorMessage(error.code, error.message),
      last_seq: progress.lastSeq,
    });
  };

  /** Follows the run's events in the background until `done` (or the stream gives up). */
  const watch = (integration, row, token, body = null) => {
    if (watchers.has(row.documentId)) return;
    const controller = new AbortController();
    const progress = { status: row.status, preview: '', lastText: '', error: null, lastSeq: Number(row.last_seq) || 0 };
    const entry = { progress, controller };
    watchers.set(row.documentId, entry);
    const client = makeClient(token);

    const onEvent = ({ seq, type, data }) => {
      progress.lastSeq = seq || progress.lastSeq;
      if (type === 'started') {
        // A second `started` is an account switch before any output, not an error.
        if (progress.status !== 'running') {
          progress.status = 'running';
          integration.updateAiTextRun(row.documentId, { status: 'running', last_seq: progress.lastSeq }).catch(() => {});
        }
      } else if (type === 'text_delta') {
        progress.preview = `${progress.preview}${data?.text || ''}`.slice(-MAX_PREVIEW);
      } else if (type === 'text') {
        progress.lastText = data?.text || '';
        progress.preview = progress.lastText.slice(-MAX_PREVIEW);
      } else if (type === 'error') {
        progress.error = { code: data?.code, message: data?.message };
      }
    };

    const run = async () => {
      let runId = row.run_id;
      let retried = false;
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { done } = await client.streamEvents(runId, { after: progress.lastSeq, onEvent, signal: controller.signal });
        // A server deploy ends runs with failed/cli_failed "server restarted": repeat it once with
        // the same idempotency_key (needs the body, so only in the process that started it).
        if (done.status === 'failed' && isServerRestart(progress.error) && body && !retried) {
          retried = true;
          // eslint-disable-next-line no-await-in-loop
          const created = await client.createRun(body, { signal: controller.signal });
          if (created?.run_id && created.run_id !== runId) {
            runId = created.run_id;
            Object.assign(progress, { status: 'queued', preview: '', lastText: '', error: null, lastSeq: 0 });
            row.run_id = runId;
            // eslint-disable-next-line no-await-in-loop
            await integration.updateAiTextRun(row.documentId, { run_id: runId, status: 'queued', last_seq: 0 }).catch(() => {});
            // eslint-disable-next-line no-continue
            continue;
          }
        }
        // eslint-disable-next-line no-await-in-loop
        await finish(integration, row, done, progress);
        return;
      }
    };

    entry.promise = run()
      .catch(async (err) => {
        if (controller.signal.aborted) return;
        // The run is gone or the token no longer works: settle it. A network give-up leaves the row
        // active; the next poll resumes the stream from last_seq.
        if (err instanceof TermhubError && err.code !== 'NETWORK' && err.code !== 'RATE_LIMITED') {
          await settle(integration, row, {
            status: 'failed', error_code: err.code, error_message: toGraphQLError(err).message, last_seq: progress.lastSeq,
          });
        } else {
          log.warn?.(`[termhub] stream of generation ${row.documentId} stopped: ${err?.code || err?.name || 'error'}`);
          integration.updateAiTextRun(row.documentId, { last_seq: progress.lastSeq }).catch(() => {});
        }
      })
      .finally(() => watchers.delete(row.documentId));
  };

  /**
   * Starts a draft. `prompt` is built by the caller from the event; `requestId` (from the page)
   * makes a repeated mutation return the same generation instead of a second run.
   */
  const start = async (integration, user, { event, type, prompt, requestId }) => {
    requireServerKey();
    const credential = await integration.findTermhubCredential(user.id);
    if (!credential) throw notConfiguredError();
    const token = tokenOf(credential, user);

    const key = `hub-ai-${user.id}-${String(requestId || newKey()).replace(/[^A-Za-z0-9-]/g, '').slice(0, 64) || newKey()}`;
    const existing = await integration.findAiTextRunByKey(key);
    if (existing) {
      if (Number(existing.user_id) !== Number(user.id)) throw userError('Geração não encontrada.', 'NOT_FOUND');
      return view(existing);
    }

    if (starting.has(user.id)) throw userError('Uma geração já está começando. Aguarde.', 'TERMHUB_BUSY');
    starting.add(user.id);
    try {
      await checkLimits(integration, user);
      const row = await integration.createAiTextRun({
        idempotency_key: key,
        user_id: Number(user.id),
        event_document_id: event.documentId,
        event_slug: event.slug,
        campaign_type: type,
        status: 'queued',
        last_seq: 0,
      });
      const body = {
        project: credential.project,
        prompt,
        capabilities: ['read'],
        model_class: 'default',
        budget: { timeout_s: RUN_TIMEOUT_S },
        idempotency_key: key,
      };
      let created;
      try {
        created = await makeClient(token).createRun(body);
      } catch (err) {
        const gqlError = toGraphQLError(err);
        await settle(integration, row, { status: 'failed', error_code: err?.code || 'error', error_message: gqlError.message });
        throw gqlError;
      }
      Object.assign(row, { run_id: created.run_id, status: 'queued' });
      await integration.updateAiTextRun(row.documentId, { run_id: created.run_id });
      watch(integration, row, token, body);
      return view(row);
    } finally {
      starting.delete(user.id);
    }
  };

  const ownRow = async (integration, user, id) => {
    const row = await integration.findAiTextRun(String(id));
    if (!row || Number(row.user_id) !== Number(user.id)) throw userError('Geração não encontrada.', 'NOT_FOUND');
    return row;
  };

  /** The page polls this. An active run nobody follows here (BFF restarted) is followed again. */
  const get = async (integration, user, id) => {
    const row = await ownRow(integration, user, id);
    if (ACTIVE.includes(row.status) && row.run_id && !watchers.has(row.documentId)) {
      const credential = await integration.findTermhubCredential(user.id);
      if (credential && hasTokenKey(env)) {
        try {
          watch(integration, row, tokenOf(credential, user));
        } catch (err) {
          log.warn?.(`[termhub] cannot resume generation ${row.documentId}: ${err.message}`);
        }
      }
    }
    return view(row);
  };

  const cancel = async (integration, user, id) => {
    const row = await ownRow(integration, user, id);
    if (!ACTIVE.includes(row.status)) return view(row);
    if (row.run_id) {
      const credential = await integration.findTermhubCredential(user.id);
      if (!credential) throw notConfiguredError();
      try {
        await makeClient(tokenOf(credential, user)).cancelRun(row.run_id);
      } catch (err) {
        // NOT_FOUND: the run already ended or is gone; settle it as cancelled here anyway.
        if (!(err instanceof TermhubError && err.code === 'NOT_FOUND')) throw toGraphQLError(err);
      }
    }
    watchers.get(row.documentId)?.controller.abort();
    watchers.delete(row.documentId);
    await settle(integration, row, { status: 'cancelled' });
    return view(row);
  };

  return {
    getSettings,
    saveSettings,
    testSettings,
    deleteSettings,
    start,
    get,
    cancel,
    /** Tests only: waits for the background stream of a generation. */
    settled: (id) => watchers.get(id)?.promise || Promise.resolve(),
  };
};
