import pubsub from '../../dataSources/pubsub';
import {
  sendSignupConfirmation,
  sendSignupConfirmationBatch,
} from '../../services/email/signup-confirmation';
import { resolveUsers, withUserNames } from '../../utils/signup-names';
import { signupIdOf } from '../../utils/signup-id';
import mapSignup from './mappers';

const CHECKIN_TOPIC_PREFIX = 'CHECKIN_';

// Payment identification of the signups created by importSignups.
const IMPORT_PAYMENT_PREFIX = 'IMPORT_';

const findEventandoEvent = async (dataSources, eventSlug) => {
  const eventResponse = await dataSources.eventandoIntegration.findEvents({
    filters: {
      or: [
        { slug: { eq: eventSlug } },
        { uuid: { eq: eventSlug } },
      ],
    },
  });
  return eventResponse?.data?.[0] || null;
};

// Imported and manual signups get a CONFIRMED payment of value 0, so their e-mail
// is the free one (with the ticket QR when the event is in person). Background
// only: the caller answers without waiting.
const queueConfirmations = ({ dataSources, eventSlug, eventandoEvent, signups, label }) => {
  sendSignupConfirmationBatch({
    dataSources,
    eventSlug,
    eventandoEvent,
    signups,
    isFree: true,
    label,
  }).catch((err) => console.error(`[Email] ${label} ${eventSlug}:`, err.message));
};

// One signup in the EventSignup shape, with the same name resolution as eventSignups.
const toEventSignup = async (dataSources, raw) => {
  const [signup] = withUserNames(
    [mapSignup(raw)],
    await resolveUsers(dataSources, [raw.email]),
  );
  return signup;
};

const Checkin = {
  Query: {
    eventSignups: async (_, { eventSlug, search }, { dataSources }) => {
      try {
        // 1. Find the event in Eventando Manager by slug
        const eventResponse = await dataSources.eventandoIntegration.findEvents({
          filters: {
            or: [
              { slug: { eq: eventSlug } },
              { uuid: { eq: eventSlug } },
            ],
          },
          populate: ['products', 'products.batches'],
        });

        const event = eventResponse?.data?.[0];
        if (!event) {
          throw new Error(`Evento "${eventSlug}" não encontrado.`);
        }

        // 2. Fetch all signups for this event
        const allSignups = await dataSources.eventandoIntegration.findSignupsByEvent(event.id);

        // 3. Map signups to the EventSignup type, using the HubCommunity profile name
        //    when the account has one (older signups stored the username as name).
        let signups = allSignups.map(mapSignup);
        signups = withUserNames(
          signups,
          await resolveUsers(dataSources, signups.map((s) => s.email)),
        );

        // 4. Filter by search term (case insensitive, matches name)
        if (search && search.trim()) {
          const term = search.trim().toLowerCase();
          signups = signups.filter(s =>
            s.name.toLowerCase().includes(term)
          );
        }

        return signups;
      } catch (err) {
        throw new Error(`Erro ao buscar inscritos: ${err.message}`);
      }
    },
  },

  Mutation: {
    checkinSignup: async (_, { eventSlug, signupId, checkedInAt }, { dataSources }) => {
      try {
        // 0. Idempotent: a signup that is already checked in keeps its original time
        //    (several devices may sync the same person; the first one wins).
        const existing = (await dataSources.eventandoIntegration.findSignupById(signupId))?.data;
        if (!existing) {
          return { success: false, message: 'Inscrição não encontrada.', signup: null };
        }
        if (existing.checked_in) {
          const [signupData] = withUserNames(
            [mapSignup(existing)],
            await resolveUsers(dataSources, [existing.email]),
          );
          return { success: true, message: 'Check-in já realizado.', signup: signupData };
        }

        // 1. Update signup in Eventando Manager
        const parsed = Date.parse(checkedInAt || '');
        const checkedInAtIso = Number.isNaN(parsed)
          ? new Date().toISOString()
          : new Date(parsed).toISOString();
        const updateResponse = await dataSources.eventandoIntegration.updateSignup(
          signupId,
          { checked_in: true, checked_in_at: checkedInAtIso },
        );

        const updatedSignup = updateResponse?.data;

        if (!updatedSignup) {
          return {
            success: false,
            message: 'Inscrição não encontrada.',
            signup: null,
          };
        }

        // 2. Build the signup object for the response and subscription (same name
        //    resolution as eventSignups, so the printed badge matches the list)
        const [signupData] = withUserNames(
          [{
            ...mapSignup(updatedSignup),
            checked_in: true,
            checked_in_at: updatedSignup.checked_in_at || new Date().toISOString(),
          }],
          await resolveUsers(dataSources, [updatedSignup.email]),
        );

        // 3. Publish to subscription topic
        const topic = `${CHECKIN_TOPIC_PREFIX}${eventSlug}`;
        pubsub.publish(topic, {
          credentialCheckedIn: signupData,
        });

        return {
          success: true,
          message: 'Check-in realizado com sucesso!',
          signup: signupData,
        };
      } catch (err) {
        return {
          success: false,
          message: `Erro ao realizar check-in: ${err.message}`,
          signup: null,
        };
      }
    },

    importSignups: async (_, { eventSlug, batchId, signups }, { dataSources }) => {
      const errors = [];
      let importedCount = 0;
      let skippedCount = 0;
      // Who gets the confirmation e-mail once the loop is done.
      const toConfirm = [];

      try {
        // 1. Find the event in Eventando Manager by slug
        const eventResponse = await dataSources.eventandoIntegration.findEvents({
          filters: {
            or: [
              { slug: { eq: eventSlug } },
              { uuid: { eq: eventSlug } },
            ],
          },
        });

        const event = eventResponse?.data?.[0];
        if (!event) {
          return {
            success: false,
            message: `Evento "${eventSlug}" não encontrado.`,
            imported_count: 0,
            skipped_count: 0,
            errors: [`Evento "${eventSlug}" não encontrado.`],
          };
        }

        // 3. Fetch existing signups to avoid duplicates
        const existingSignups = await dataSources.eventandoIntegration.findSignupsByEvent(event.id);
        const existingEmails = new Set(
          existingSignups
            .map(s => (s.email || '').toLowerCase().trim())
            .filter(Boolean)
        );

        // 4. Import each signup with payment
        for (const signupInput of signups) {
          const email = (signupInput.email || '').toLowerCase().trim();

          // Skip duplicates by email (if email is provided)
          if (email && existingEmails.has(email)) {
            skippedCount++;
            continue;
          }

          try {
            // 4a. Create a CONFIRMED payment with value=0 (imported from external system)
            const paymentResponse = await dataSources.eventandoIntegration.createPaymentDirect({
              value: 0,
              original_value: 0,
              event: event.id,
              batch: batchId,
              payment_identification: `IMPORT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              status: 'CONFIRMED',
              confirmed_at: new Date().toISOString(),
            });

            const paymentId = paymentResponse?.data?.id || paymentResponse?.data?.documentId;

            // 4b. Create the signup linked to the payment
            const created = await dataSources.eventandoIntegration.createSignupDirect({
              name: signupInput.name,
              email: signupInput.email || null,
              phone_number: signupInput.phone_number || null,
              event: event.id,
              payment: paymentId || null,
              checked_in: false,
            });

            importedCount++;

            if (email) {
              toConfirm.push({
                signupId: signupIdOf(created?.data),
                name: signupInput.name,
                email: signupInput.email,
                phone: signupInput.phone_number || null,
              });
            }

            // Track to avoid duplicates within the same batch
            if (email) {
              existingEmails.add(email);
            }
          } catch (err) {
            errors.push(`Erro ao importar "${signupInput.name}": ${err.message}`);
          }
        }

        // 5. Account + confirmation e-mail for everyone imported with an e-mail
        if (toConfirm.length > 0) {
          queueConfirmations({
            dataSources,
            eventSlug,
            eventandoEvent: event,
            signups: toConfirm,
            label: 'import',
          });
        }

        return {
          success: true,
          message: `Importação concluída: ${importedCount} importados, ${skippedCount} ignorados (duplicados).`,
          imported_count: importedCount,
          skipped_count: skippedCount,
          errors: errors.length > 0 ? errors : null,
        };
      } catch (err) {
        return {
          success: false,
          message: `Erro na importação: ${err.message}`,
          imported_count: importedCount,
          skipped_count: skippedCount,
          errors: [err.message],
        };
      }
    },

    // Nothing else could fix a typo: the other mutations only create signups or
    // check them in, so a wrong phone or a misspelt name had to be corrected in
    // Eventando by hand. Only the fields sent change — the check-in is not one
    // of them, so correcting a name cannot silently un-credential anyone.
    updateSignup: async (_, { signupId, input }, { dataSources }) => {
      try {
        const existing = (await dataSources.eventandoIntegration.findSignupById(signupId))?.data;
        if (!existing) {
          return { success: false, message: 'Inscrição não encontrada.', signup: null };
        }

        const patch = ['name', 'email', 'phone_number'].reduce((acc, field) => {
          const value = input[field];
          return value === undefined || value === null ? acc : { ...acc, [field]: value.trim() };
        }, {});

        if (Object.keys(patch).length === 0) {
          const [unchanged] = withUserNames(
            [mapSignup(existing)],
            await resolveUsers(dataSources, [existing.email]),
          );
          return { success: true, message: 'Nada para alterar.', signup: unchanged };
        }

        const response = await dataSources.eventandoIntegration.updateSignup(signupId, patch);
        const updated = response?.data;
        if (!updated) {
          return { success: false, message: 'Não foi possível atualizar a inscrição.', signup: null };
        }

        const [signup] = withUserNames(
          [mapSignup(updated)],
          await resolveUsers(dataSources, [updated.email]),
        );
        return { success: true, message: 'Inscrição atualizada.', signup };
      } catch (err) {
        return { success: false, message: `Erro ao atualizar inscrição: ${err.message}`, signup: null };
      }
    },

    manualSignup: async (_, { eventSlug, batchId, input }, { dataSources }) => {
      try {
        // 1. Create the account when the e-mail has none (no password: the
        //    confirmation e-mail carries the set-password link). Never blocks the signup.
        let account = { created: false, token: null };
        try {
          const result = await dataSources.managerIntegration.accountSetup({
            email: input.email,
            name: input.name,
            phone: input.phone_number || undefined,
          });
          account = { created: Boolean(result?.created), token: result?.token || null };
        } catch (err) {
          console.error('[ManualSignup] Account setup error (non-blocking):', err.message);
        }
        const accountCreated = account.created;

        // 2. Resolve the event in Eventando Manager
        const event = await findEventandoEvent(dataSources, eventSlug);
        if (!event) {
          return {
            success: false,
            message: `Evento "${eventSlug}" não encontrado.`,
            account_created: accountCreated,
          };
        }

        // The account set up above is reused, so its token is the one e-mailed.
        const confirm = (signup) =>
          sendSignupConfirmation({
            dataSources,
            eventSlug,
            eventandoEvent: event,
            signupId: signupIdOf(signup),
            name: input.name,
            email: input.email,
            phone: input.phone_number || null,
            isFree: true,
            account,
          }).catch((err) => console.error('[Email] Error sending confirmation:', err.message));

        // 3. Check if already signed up
        const existingSignup = await dataSources.eventandoIntegration.findSignupByEmail(
          event.id,
          input.email,
        );

        if (existingSignup?.data && existingSignup.data.length > 0) {
          // Already registered: e-mail again only if the account still needs its password.
          if (account.token) confirm(existingSignup.data[0]);
          return {
            success: true,
            message: accountCreated
              ? 'Conta criada! Participante já estava inscrito neste evento.'
              : 'Participante já está inscrito neste evento.',
            account_created: accountCreated,
            signup: await toEventSignup(dataSources, existingSignup.data[0]),
          };
        }

        // 4. Create event signup directly (same pattern as importSignups)
        let createdSignup = null;
        try {
          // 4a. Create a CONFIRMED payment with value=0
          const paymentResponse = await dataSources.eventandoIntegration.createPaymentDirect({
            value: 0,
            original_value: 0,
            event: event.id,
            batch: parseInt(batchId, 10),
            payment_identification: `MANUAL_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            status: 'CONFIRMED',
            confirmed_at: new Date().toISOString(),
          });

          const paymentId = paymentResponse?.data?.id || paymentResponse?.data?.documentId;

          // 4b. Create the signup linked to the payment
          const created = await dataSources.eventandoIntegration.createSignupDirect({
            name: input.name,
            email: input.email,
            phone_number: input.phone_number || null,
            event: event.id,
            payment: paymentId || null,
            checked_in: false,
          });
          createdSignup = created?.data || null;
        } catch (signupErr) {
          return {
            success: false,
            message: `Erro ao criar inscrição: ${signupErr.message}`,
            account_created: accountCreated,
          };
        }

        if (createdSignup) confirm(createdSignup);

        return {
          success: true,
          message: accountCreated
            ? `${input.name} inscrito(a) com sucesso! Conta criada no HubCommunity.`
            : `${input.name} inscrito(a) com sucesso!`,
          account_created: accountCreated,
          signup: createdSignup ? await toEventSignup(dataSources, createdSignup) : null,
        };
      } catch (err) {
        return {
          success: false,
          message: `Erro: ${err.message}`,
          account_created: false,
        };
      }
    },

    // Re-sends the confirmation (ticket QR + set-password link) to everyone imported
    // into the event. Nothing records "already sent": each run sets up the accounts
    // again, so a pending account gets a new token and the previous link stops working.
    sendImportedSignupConfirmations: async (_, { eventSlug }, { dataSources }) => {
      try {
        const event = await findEventandoEvent(dataSources, eventSlug);
        if (!event) {
          return { success: false, message: `Evento "${eventSlug}" não encontrado.`, queued_count: 0 };
        }

        const allSignups = await dataSources.eventandoIntegration.findSignupsByEvent(event.id);
        const toConfirm = allSignups
          .filter((s) => s.email
            && String(s.payment?.payment_identification || '').startsWith(IMPORT_PAYMENT_PREFIX))
          .map((s) => ({
            signupId: signupIdOf(s),
            name: s.name,
            email: s.email,
            phone: s.phone_number || null,
          }));

        if (toConfirm.length > 0) {
          queueConfirmations({
            dataSources,
            eventSlug,
            eventandoEvent: event,
            signups: toConfirm,
            label: 'reenvio',
          });
        }

        return {
          success: true,
          message: `${toConfirm.length} e-mails na fila de envio.`,
          queued_count: toConfirm.length,
        };
      } catch (err) {
        return { success: false, message: `Erro ao enviar e-mails: ${err.message}`, queued_count: 0 };
      }
    },
  },

  Subscription: {
    credentialCheckedIn: {
      subscribe: (_, { eventSlug }) => {
        const topic = `${CHECKIN_TOPIC_PREFIX}${eventSlug}`;
        return pubsub.asyncIterator([topic]);
      },
    },
  },
};

export default Checkin;

