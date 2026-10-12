import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { makeExecutableSchema } from '@graphql-tools/schema';

// src/index.js feeds every .graphql file in src/types to makeExecutableSchema at boot, so a
// type that references something no file declares only blows up when the server starts —
// which the browser then reports as a CORS error.
const TYPES_DIR = './src/types';

const typeDefs = fs
  .readdirSync(TYPES_DIR)
  .filter((file) => file.endsWith('.graphql'))
  .map((file) => fs.readFileSync(path.join(TYPES_DIR, file), 'utf8'))
  .join('\n');

describe('graphql schema', () => {
  const schema = makeExecutableSchema({ typeDefs });

  it('composes every type file', () => {
    expect(schema.getQueryType()).toBeTruthy();
    expect(schema.getMutationType()).toBeTruthy();
  });

  it('exposes the per-category certificate lists and their request forms', () => {
    const query = schema.getQueryType().getFields();
    const mutation = schema.getMutationType().getFields();
    expect(query.certificateCandidates.args.map((a) => a.name)).toContain('category');
    expect(query.certificateRequestForms).toBeTruthy();
    expect(query.certificateRequestForm).toBeTruthy();
    expect(mutation.issueCertificates.args.map((a) => a.name)).toContain('category');
    expect(mutation.createCertificateRequestForm).toBeTruthy();
    expect(mutation.updateCertificateRequestForm).toBeTruthy();
    expect(mutation.deleteCertificateRequestForm).toBeTruthy();
    expect(mutation.submitCertificateRequest).toBeTruthy();
  });

  it('exposes the bulk re-send of the imported signups confirmations', () => {
    const field = schema.getMutationType().getFields().sendImportedSignupConfirmations;
    expect(field.args.map((a) => `${a.name}: ${a.type}`)).toEqual(['eventSlug: String!']);
    expect(String(field.type)).toBe('BulkEmailResponse');
    expect(Object.keys(schema.getType('BulkEmailResponse').getFields()))
      .toEqual(['success', 'message', 'queued_count']);
  });
  it('exposes the REA-6 payment and coupon contract the frontend uses', () => {
    const query = schema.getQueryType().getFields();
    const mutation = schema.getMutationType().getFields();
    const argsOf = (field) => field.args.map((a) => `${a.name}: ${a.type}`);
    expect(argsOf(query.signupPaymentStatus)).toEqual(['signupId: ID!']);
    expect(argsOf(query.eventPaymentSettings)).toEqual(['eventId: ID!']);
    expect(argsOf(query.eventPayments)).toEqual(['slugOrId: String!']);
    expect(argsOf(query.eventCoupons)).toEqual(['eventId: ID!']);
    expect(argsOf(query.previewCoupon)).toEqual(['eventSlug: String!', 'batchId: ID!', 'code: String!', 'isStudent: Boolean']);
    expect(argsOf(mutation.signupToEvent)).toEqual(expect.arrayContaining(['cpf: String', 'kind: String']));
    const status = schema.getType('SignupPaymentStatus').getFields();
    ['signup_id', 'status', 'provider', 'kind', 'expires_at', 'confirmed_at', 'pix_br_code', 'payment_link', 'value', 'refund_support']
      .forEach((f) => expect(status[f]).toBeTruthy());
    const coupon = schema.getType('Coupon').getFields();
    ['discount_type', 'discount_value_cents', 'starts_at', 'batches', 'uses'].forEach((f) => expect(coupon[f]).toBeTruthy());
    expect(Object.keys(schema.getType('EventSaleInput').getFields())).toContain('payment_provider');
    expect(Object.keys(schema.getType('CouponInput').getFields())).toEqual(expect.arrayContaining(['discount_type', 'discount_value_cents', 'starts_at', 'batches']));
    expect(Object.values(schema.getType('SignupPaymentStatus').getFields()).some((f) => /cpf/i.test(f.name))).toBe(false);
  });
});
