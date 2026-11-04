import app from './app.js';
import db from './config/db.js';
import { startOrderExpiryJob } from './services/orderExpiryService.js';

// Tokens signed with an undefined secret would fail in confusing ways later
if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set');
    process.exit(1);
}

const port = process.env.PORT || 3000;
let expiryJob;

const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`API Documentation: http://localhost:${port}/v1/docs`);
    console.log(`Health Check: http://localhost:${port}/health`);

    // Cancel unpaid orders after the payment window and release their stock
    expiryJob = startOrderExpiryJob();
});

// Hosts stop the app on every deploy: finish in-flight requests first
const shutdown = () => {
    clearInterval(expiryJob);
    server.close(async () => {
        await db.end();
        process.exit(0);
    });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
