import { GraphQLError } from 'graphql';
import { normalizeDateOfBirth } from '../../resolvers/Certificate/birthdate';

// REA-36: the Hub is for people aged 18 or more. Every signup form has the required checkbox
// "Declaro que tenho 18 anos ou mais" (sent as adult_declaration: true), and every date of birth
// must be of someone aged 18+. Ages count calendar days in São Paulo (no DST since 2019: UTC-3),
// the same rule the backend applies (hub-community-backend src/utils/age.ts).

export const MIN_AGE = 18;
export const ADULT_DECLARATION_REQUIRED = 'Confirme que você tem 18 anos ou mais.';
export const MINOR_MESSAGE = 'É preciso ter 18 anos ou mais.';
export const INVALID_DATE_MESSAGE = 'Informe uma data de nascimento válida.';

const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Today in São Paulo as { y, m, d }. */
export const todaySaoPaulo = (now = new Date()) => {
  const local = new Date(now.getTime() - SAO_PAULO_OFFSET_MS);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate() };
};

const pad = (n) => String(n).padStart(2, '0');

/** Age in whole years of a "YYYY-MM-DD" date, or null when the date is not usable. */
export const ageOn = (dateOfBirth, now = new Date()) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateOfBirth || '').trim());
  if (!match) return null;
  const [y, m, d] = match.slice(1).map(Number);
  const today = todaySaoPaulo(now);
  let age = today.y - y;
  if (today.m < m || (today.m === m && today.d < d)) age -= 1;
  return age;
};

/**
 * The latest date of birth of an adult today ("YYYY-MM-DD"): born on or before it is 18+.
 * A birthday on 29/02 counts from 01/03 in common years.
 */
export const adultCutoff = (now = new Date()) => {
  const today = todaySaoPaulo(now);
  const cutoff = new Date(Date.UTC(today.y - MIN_AGE, today.m - 1, today.d));
  if (cutoff.getUTCMonth() !== today.m - 1) cutoff.setUTCDate(0);
  return `${cutoff.getUTCFullYear()}-${pad(cutoff.getUTCMonth() + 1)}-${pad(cutoff.getUTCDate())}`;
};

export const isAdultDate = (dateOfBirth, now = new Date()) => {
  const age = ageOn(dateOfBirth, now);
  return age !== null && age >= MIN_AGE;
};

export const isMinorDate = (dateOfBirth, now = new Date()) => {
  const age = ageOn(dateOfBirth, now);
  return age !== null && age < MIN_AGE;
};

/**
 * The normalized "YYYY-MM-DD" of a date of birth that must be of an adult, or null when none was
 * given. Throws BAD_USER_INPUT for an invalid date or someone under 18.
 */
export const adultDateOfBirth = (value, now = new Date()) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const date = normalizeDateOfBirth(String(value), now);
  if (!date) throw new GraphQLError(INVALID_DATE_MESSAGE, { extensions: { code: 'BAD_USER_INPUT' } });
  if (!isAdultDate(date, now)) throw new GraphQLError(MINOR_MESSAGE, { extensions: { code: 'BAD_USER_INPUT' } });
  return date;
};

/** Throws BAD_USER_INPUT unless the 18+ checkbox was ticked. */
export const requireAdultDeclaration = (value) => {
  if (value !== true) {
    throw new GraphQLError(ADULT_DECLARATION_REQUIRED, { extensions: { code: 'ADULT_DECLARATION_REQUIRED' } });
  }
};
