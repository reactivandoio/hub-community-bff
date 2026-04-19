import pubsub from '../../dataSources/pubsub';

const CHECKIN_TOPIC_PREFIX = 'CHECKIN_';

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

        // 3. Map signups to the EventSignup type
        let signups = allSignups.map(signup => ({
          id: String(signup.documentId || signup.id),
          name: signup.name || '',
          email: signup.email || '',
          phone_number: signup.phone_number || '',
          checked_in: signup.checked_in || false,
          checked_in_at: signup.checked_in_at || null,
          product_name: signup.payment?.batch?.product?.name || null,
        }));

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
    checkinSignup: async (_, { eventSlug, signupId }, { dataSources }) => {
      try {
        // 1. Update signup in Eventando Manager
        const updateResponse = await dataSources.eventandoIntegration.updateSignup(
          signupId,
          {
            checked_in: true,
            checked_in_at: new Date().toISOString(),
          },
        );

        const updatedSignup = updateResponse?.data;

        if (!updatedSignup) {
          return {
            success: false,
            message: 'Inscrição não encontrada.',
            signup: null,
          };
        }

        // 2. Build the signup object for the response and subscription
        const signupData = {
          id: String(updatedSignup.documentId || updatedSignup.id),
          name: updatedSignup.name || '',
          email: updatedSignup.email || '',
          phone_number: updatedSignup.phone_number || '',
          checked_in: true,
          checked_in_at: updatedSignup.checked_in_at || new Date().toISOString(),
          product_name: updatedSignup.payment?.batch?.product?.name || null,
        };

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
            await dataSources.eventandoIntegration.createSignupDirect({
              name: signupInput.name,
              email: signupInput.email || null,
              phone_number: signupInput.phone_number || null,
              event: event.id,
              payment: paymentId || null,
              checked_in: false,
            });

            importedCount++;

            // Track to avoid duplicates within the same batch
            if (email) {
              existingEmails.add(email);
            }
          } catch (err) {
            errors.push(`Erro ao importar "${signupInput.name}": ${err.message}`);
          }
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

    manualSignup: async (_, { eventSlug, batchId, input }, { dataSources }) => {
      try {
        // 1. Try to create account in hub-community
        let accountCreated = false;
        const username = input.email
          .split('@')[0]
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 20) || 'user';
        const suffix = Math.random().toString(36).slice(2, 6);
        const uniqueUsername = `${username}-${suffix}`;
        const tempPassword = `Temp${Math.random().toString(36).slice(2, 10)}!1`;

        try {
          await dataSources.managerPublic.signUp({
            username: uniqueUsername,
            email: input.email,
            password: tempPassword,
            name: input.name,
            phone: input.phone_number || undefined,
          });
          accountCreated = true;
        } catch (err) {
          const msg = (err.message || '').toLowerCase();
          // If account already exists, that's OK
          if (msg.includes('email') && (msg.includes('taken') || msg.includes('already') || msg.includes('exists'))) {
            accountCreated = false;
          } else {
            // Unexpected error — still proceed with event signup
            console.error('[ManualSignup] Account creation error (non-blocking):', err.message);
          }
        }

        // 2. Resolve the event in Eventando Manager
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
            account_created: accountCreated,
          };
        }

        // 3. Check if already signed up
        const existingSignup = await dataSources.eventandoIntegration.findSignupByEmail(
          event.id,
          input.email,
        );

        if (existingSignup?.data && existingSignup.data.length > 0) {
          return {
            success: true,
            message: accountCreated
              ? 'Conta criada! Participante já estava inscrito neste evento.'
              : 'Participante já está inscrito neste evento.',
            account_created: accountCreated,
          };
        }

        // 4. Create event signup via custom controller (handles payment/batch)
        const signupData = {
          name: input.name,
          email: input.email,
          batch_id: parseInt(batchId, 10),
          phone_number: input.phone_number || undefined,
        };

        const response = await dataSources.eventandoIntegration.signup(
          event.id,
          signupData,
        );

        if (response.status === 'error' || response.error) {
          return {
            success: false,
            message: response.message || response.error?.message || 'Erro ao inscrever participante.',
            account_created: accountCreated,
          };
        }

        return {
          success: true,
          message: accountCreated
            ? `${input.name} inscrito(a) com sucesso! Conta criada no HubCommunity.`
            : `${input.name} inscrito(a) com sucesso!`,
          account_created: accountCreated,
        };
      } catch (err) {
        return {
          success: false,
          message: `Erro: ${err.message}`,
          account_created: false,
        };
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

