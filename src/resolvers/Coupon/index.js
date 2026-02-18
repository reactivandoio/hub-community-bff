const Coupon = {
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
