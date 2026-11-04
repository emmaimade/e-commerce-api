import app from './app.js';
import db from './config/db.js';
import { startOrderExpiryJob } from './services/orderExpiryService.js';
import { startRefundRetryJob } from './services/refundService.js';

// Tokens signed with an undefined secret would fail in confusing ways later
if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set');
    process.exit(1);
}

const port = process.env.PORT || 3000;
let backgroundJobs = [];

const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`API Documentation: http://localhost:${port}/v1/docs`);
    console.log(`Health Check: http://localhost:${port}/health`);

    // Cancel unpaid orders after the payment window, and retry refunds Paystack couldn't take
    backgroundJobs = [startOrderExpiryJob(), startRefundRetryJob()];
});

// Hosts stop the app on every deploy: finish in-flight requests first
const shutdown = () => {
    backgroundJobs.forEach(clearInterval);
    server.close(async () => {
        await db.end();
        process.exit(0);
    });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
