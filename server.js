import express from 'express';
import bodyParser from 'body-parser';
import swaggerUI from 'swagger-ui-express';
import YAML from "yamljs"
import path from "path";
import { fileURLToPath } from 'url';

import db from './config/db.js';
import authRoutes from './routes/v1/authRoutes.js';
import userRoutes from './routes/v1/userRoutes.js';
import productRoutes from './routes/v1/productRoutes.js';
import cartRoutes from './routes/v1/cartRoutes.js';
import orderRoutes from './routes/v1/orderRoutes.js';
import adminRoutes from './routes/v1/adminRoutes.js';
import paymentRoutes from './routes/v1/paymentRoutes.js';
import shippingRoutes from './routes/v1/shippingRoutes.js';
import { handleUploadErrors } from './middleware/errorHandler.js';

const app = express();
const port = process.env.PORT || 3000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Raw body parser for webhooks before express.json
app.use('/v1/payments/webhook', express.raw({type: 'application/json'}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// ========================================
// SWAGGER DOCUMENTATION
// ========================================

const swaggerDocument = YAML.load(path.join(__dirname, "swagger.yaml"));

app.use(
  "/docs",
  swaggerUI.serve,
  swaggerUI.setup(swaggerDocument, {
    customCss: `
        .swagger-ui .topbar { 
            background-color: #2c3e50;
            border-bottom: 3px solid #3498db;
        }
        .swagger-ui .info .title { 
            color: #2c3e50;
            font-size: 2.5em;
        }
        .swagger-ui .info .description {
            color: #7f8c8d;
        }
    `,

    // custom page title
    customSiteTitle: "E-Commerce API Documentation",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: "none",
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      defaultModelsExpandDepth: 2,
      defaultModelExpandDepth: 2,
    },
  })
);

app.get("/swagger.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerDocument)
})

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

app.use('/v1/auth', authRoutes);   // auth
app.use('/v1/user', userRoutes); // users
app.use('/v1/product', productRoutes); // products
app.use('/v1/cart', cartRoutes); // carts
app.use('/v1/order', orderRoutes); // orders
app.use('/v1/payments', paymentRoutes); // payments
app.use('/v1/shipping', shippingRoutes); // shipping addresses

// admin routes
app.use('/v1/admin', adminRoutes);

// Multer Error handling
app.use(handleUploadErrors);

// Error handling for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    statusCode: 404,
  });
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`API Documentation: http://localhost:${port}/docs`);
    console.log(`Health Check: http://localhost:${port}/health`);
})
