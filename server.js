import express from 'express';
import bodyParser from 'body-parser';

import db from './config/db.js';
import userRoutes from './routes/v1/userRoutes.js';
import productRoutes from './routes/v1/productRoutes.js';
import cartRoutes from './routes/v1/cartRoutes.js';
import orderRoutes from './routes/v1/orderRoutes.js';
import adminRoutes from './routes/v1/adminRoutes.js';
import paymentRoutes from './routes/v1/paymentRoutes.js';
import { handleUploadErrors } from './middleware/errorHandler.js';

const app = express();
const port = process.env.PORT;

// Raw body parser for webhooks before express.json
app.use('/v1/payments/webhook', express.raw({type: 'application/json'}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// ========================================
// API ROUTES - GENERAL ENDPOINTS
// ========================================

// Health check
app.get('/health', (req, res) => {
    res.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
})

app.use('/v1/user', userRoutes); // users
app.use('/v1/product', productRoutes); // products
app.use('/v1/cart', cartRoutes); // carts
app.use('/v1/order', orderRoutes); // orders
app.use('/v1/payments', paymentRoutes); // payments

// admin routes
app.use('/v1/admin', adminRoutes);

// Multer Error handling
app.use(handleUploadErrors);

app.listen(port, () => {
    console.log(`server is running on http://localhost:${port}`);
    console.log(`Health Check: http://localhost:${port}/health`);
})
