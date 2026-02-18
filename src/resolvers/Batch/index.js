const Batch = {
    Mutation: {
        createBatch: async (_, { data }, { dataSources }) => {
            try {
                const response = await dataSources.eventandoIntegration.createBatch(data);
                return response.data;
            } catch (err) {
                throw new Error(`Error creating batch: ${err.message}`);
            }
        },
        updateBatch: async (_, { id, data }, { dataSources }) => {
            try {
                const response = await dataSources.eventandoIntegration.updateBatch(id, data);
                return response.data;
            } catch (err) {
                throw new Error(`Error updating batch: ${err.message}`);
            }
        },
        deleteBatch: async (_, { id }, { dataSources }) => {
            try {
                const response = await dataSources.eventandoIntegration.deleteBatch(id);
                return response.data;
            } catch (err) {
                throw new Error(`Error deleting batch: ${err.message}`);
            }
        },
    },
};

export default Batch;
