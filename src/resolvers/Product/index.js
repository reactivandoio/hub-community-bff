import { requireAdmin } from '../../utils/auth';

const Product = {
    Mutation: {
        createProduct: async (_, { data }, ctx) => {
            requireAdmin(ctx);
            const { dataSources } = ctx;
            try {
                const response = await dataSources.eventandoIntegration.createProduct(data);
                return response.data;
            } catch (err) {
                throw new Error(`Error creating product: ${err.message}`);
            }
        },
        updateProduct: async (_, { id, data }, ctx) => {
            requireAdmin(ctx);
            const { dataSources } = ctx;
            try {
                const response = await dataSources.eventandoIntegration.updateProduct(id, data);
                return response.data;
            } catch (err) {
                throw new Error(`Error updating product: ${err.message}`);
            }
        },
        deleteProduct: async (_, { id }, ctx) => {
            requireAdmin(ctx);
            const { dataSources } = ctx;
            try {
                const response = await dataSources.eventandoIntegration.deleteProduct(id);
                return response.data;
            } catch (err) {
                throw new Error(`Error deleting product: ${err.message}`);
            }
        },
    },
};

export default Product;
