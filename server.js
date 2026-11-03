import app from './app.js';
import { startOrderExpiryJob } from './utils/orderExpiry.js';

const port = process.env.PORT || 3000;

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`API Documentation: http://localhost:${port}/v1/docs`);
    console.log(`Health Check: http://localhost:${port}/health`);

    // Cancel unpaid orders after the payment window and release their stock
    startOrderExpiryJob();
})
