const Coupon = {
    Query: {
        validateCoupon: async (_, { eventSlug, code }, { dataSources }) => {
            try {
                // Look up the event in Eventando Manager
                const eventResponse = await dataSources.eventandoIntegration.findEventBySlug(eventSlug);
                const eventandoEvent = eventResponse?.data?.[0];

                if (!eventandoEvent) {
                    return { valid: false, message: 'Evento não encontrado.' };
                }

                // Find the coupon by code and event
                const couponResponse = await dataSources.eventandoIntegration.findCoupons({
                    code: { eq: code },
                    event: { id: { eq: eventandoEvent.id } },
                    enabled: { eq: true },
                });

                const coupon = couponResponse?.data?.[0];

                if (!coupon) {
                    return { valid: false, message: 'Cupom inválido ou desativado.' };
                }

                // Check expiration
                if (coupon.expires_at && new Date() > new Date(coupon.expires_at)) {
                    return { valid: false, message: 'Este cupom já expirou.' };
                }

                return {
                    valid: true,
                    discount_percentage: coupon.discount_percentage,
                    message: `Desconto de ${coupon.discount_percentage}% aplicado!`,
                };
            } catch (err) {
                return { valid: false, message: 'Erro ao validar cupom.' };
            }
        },
    },
    Mutation: {
        createCoupon: async (_, { data }, { dataSources }) => {
            try {
                const response = await dataSources.eventandoIntegration.createCoupon(data);
                return response.data;
            } catch (err) {
                throw new Error(`Error creating coupon: ${err.message}`);
            }
        },
        updateCoupon: async (_, { id, data }, { dataSources }) => {
            try {
                const response = await dataSources.eventandoIntegration.updateCoupon(id, data);
                return response.data;
            } catch (err) {
                throw new Error(`Error updating coupon: ${err.message}`);
            }
        },
        deleteCoupon: async (_, { id }, { dataSources }) => {
            try {
                const response = await dataSources.eventandoIntegration.deleteCoupon(id);
                return response.data;
            } catch (err) {
                throw new Error(`Error deleting coupon: ${err.message}`);
            }
        },
    },
};

export default Coupon;
