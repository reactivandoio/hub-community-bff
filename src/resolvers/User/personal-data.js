// REA-56: a User's personal data (e-mail, phone, CPF, date of birth, the 18+ declaration and the
// login token) goes only to the person themself or to an admin. Every other caller (anonymous, or
// a signed-in person looking at someone else: community organizers, speakers' accounts, comment
// authors, /users/<username>) gets null in those fields.
//
// "The person themself" is the signed-in user with the same id, or the answer of their own login
// (verifyLoginCode returns the user with the fresh `token`, before there is a session).
import { isAdmin } from '../../utils/auth';

export const PERSONAL_USER_FIELDS = [
  'email',
  'phone',
  'cpf',
  'date_of_birth',
  'adult_declaration',
  'adult_declaration_at',
  'token',
];

const sameUser = (a, b) => {
  if (!a || !b) return false;
  if (a.documentId && b.documentId) return a.documentId === b.documentId;
  return a.id != null && b.id != null && String(a.id) === String(b.id);
};

export const canSeePersonalData = (parent, ctx) =>
  isAdmin(ctx?.user) || Boolean(parent?.token) || sameUser(ctx?.user, parent);

export const personalFieldResolvers = Object.fromEntries(
  PERSONAL_USER_FIELDS.map((field) => [
    field,
    (parent, _, ctx) => (canSeePersonalData(parent, ctx) ? parent?.[field] ?? null : null),
  ]),
);
