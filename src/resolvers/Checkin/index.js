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
