import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import swaggerUI from 'swagger-ui-express';
import { parse as parseYaml } from "yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

import authRoutes from './routes/v1/authRoutes.js';
import userRoutes from './routes/v1/userRoutes.js';
import productRoutes from './routes/v1/productRoutes.js';
import cartRoutes from './routes/v1/cartRoutes.js';
import orderRoutes from './routes/v1/orderRoutes.js';
import adminRoutes from './routes/v1/adminRoutes.js';
import paymentRoutes from './routes/v1/paymentRoutes.js';
import shippingRoutes from './routes/v1/shippingRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Proxies in front of the app, so req.ip (used for rate limiting) is the real client
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // The reset and payment pages style elements inline
      styleSrcAttr: ["'unsafe-inline'"],
      // Would force http://localhost to https during development
      upgradeInsecureRequests: null,
    },
  },
}));

// Sites allowed to call the API from a browser, comma separated. None by default.
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));

// Raw body parser for webhooks before express.json
app.use('/v1/payments/webhook', express.raw({type: 'application/json'}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ========================================
// SWAGGER DOCUMENTATION
// ========================================

const swaggerDocument = parseYaml(fs.readFileSync(path.join(__dirname, "swagger.yaml"), "utf8"));

app.use(
  '/v1/docs',
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


// Error handling for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    statusCode: 404,
  });
});

// Error handling - must stay after all routes
app.use(errorHandler);

export default app;
