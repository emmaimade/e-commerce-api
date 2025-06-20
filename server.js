import express from 'express';
import bodyParser from 'body-parser';

import db from './config/db.js';
import userRoutes from './routes/v1/userRoutes.js';
import productRoutes from './routes/v1/productRoutes.js';
import cartRoutes from './routes/v1/cartRoutes.js';
import orderRoutes from './routes/v1/orderRoutes.js';
import adminRoutes from './routes/v1/adminRoutes.js';

const app = express();
const port = process.env.PORT;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// ========================================
// API ROUTES - GENERAL ENDPOINTS
// ========================================

// health check
app.get('/health', (req, res) => {
    res.send('ok');
})

app.use('/v1/user', userRoutes);
app.use('/v1/product', productRoutes);
app.use('/v1/cart', cartRoutes);
app.use('/v1/order', orderRoutes);

// admin
app.use('/v1/admin', adminRoutes);

app.listen(port, () => {
    console.log(`server is running on http://localhost:${port}`);
})
