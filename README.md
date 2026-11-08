# E-Commerce API

A production-style REST API for an online store, built with Node.js, Express and PostgreSQL. It covers authentication, product catalogues, carts, checkout, payment verification, refunds and admin workflows.

- **Live API:** https://ecommerce-api-jq0h.onrender.com
- **Interactive docs:** https://ecommerce-api-jq0h.onrender.com/v1/docs

The live API runs on a free tier, so the first request after a quiet period can take about a minute.

## Highlights

- **Reliable checkout:** stock is reserved under row locks when an order is placed, so two customers cannot buy the last unit. Unpaid orders expire after 24 hours and release their stock.
- **Safe payment handling:** Paystack webhooks are signature-checked and safe to receive twice. Every route that confirms a payment goes through one shared transaction.
- **Refunds that cannot get lost:** a refund is saved in the same transaction as the cancellation, then sent to Paystack. Temporary failures retry automatically, payments that arrive after an order was cancelled are refunded automatically, and admins get a queue for anything that needs a person.
- **Security-first design:** email verification, revocable JWTs, role checks against the database, rate limiting, request validation, hashed tokens and strong security headers.
- **Tested end-to-end:** integration tests run against a real PostgreSQL database on every push through GitHub Actions.

## Tech stack

| Area             | Tools                                         |
| ---------------- | --------------------------------------------- |
| Runtime          | Node.js 22+, Express 5                        |
| Database         | PostgreSQL with `pg`, hosted on Supabase      |
| Payments         | Paystack                                      |
| Images and email | Cloudinary, Nodemailer with Gmail             |
| Security         | JWT, bcrypt, Helmet, CORS, express-rate-limit |
| Validation       | zod                                           |
| Testing          | Node.js test runner, Supertest                |
| Docs and CI      | Swagger UI, GitHub Actions                    |

## Project structure

Requests flow in one direction, and each layer has one job:

```
routes → middleware → controllers → services → database, Paystack, email
```

```
├── routes/v1/       URLs and the middleware each route needs
├── middleware/      Auth, validation, rate limits, uploads and error handling
├── controllers/v1/  Read the request, call a service and respond
├── services/        Business logic and all database/external calls
├── emails/          HTML email templates
├── views/           Small browser pages for redirects
├── utils/           Shared helpers such as transactions, errors and schemas
├── config/          Database and Cloudinary setup
├── migrations/      Database changes, applied in order
├── scripts/         Migration runner
├── tests/           Integration tests
├── app.js           Express app setup
├── server.js        Starts the server and background jobs
├── schema.sql       Full schema for a new database
├── swagger.yaml     OpenAPI documentation
├── package.json     Package metadata and scripts
├── LICENSE          ISC license
├── .env.example     Environment variable template (not committed here)
└── README.md        Project overview and setup guide
```

Tests enforce the boundaries: a controller that imports the database or Paystack client fails the suite, and a manual `BEGIN` outside `withTransaction` also fails.

## Quick start

You need Node.js 22 or newer and PostgreSQL 13 or newer.

1. **Clone and install**

   ```bash
   git clone https://github.com/emmaimade/e-commerce-api.git
   cd e-commerce-api
   npm install
   ```

2. **Configure the environment**

   Copy `.env.example` to `.env` and fill in the values from [Environment variables](#environment-variables).

   Example:

   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ecommerce
   TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ecommerce_test
   JWT_SECRET=replace-with-a-long-random-secret
   BASE_URL=http://localhost:3000
   PAYSTACK_SECRET_KEY=your-paystack-secret
   EMAIL_USER=you@gmail.com
   EMAIL_PASS=your-app-password
   CLOUDINARY_CLOUD_NAME=your-cloud
   CLOUDINARY_API_KEY=your-key
   CLOUDINARY_API_SECRET=your-secret
   CORS_ORIGINS=https://shop.test
   TRUST_PROXY_HOPS=1
   NODE_ENV=development
   ```

3. **Create the database**

   Create an empty database named `ecommerce` in PostgreSQL, then load the schema:

   ```bash
   npm run migrate -- schema.sql
   ```

4. **Start the server**

   ```bash
   npm run dev
   ```

   The API runs at http://localhost:3000, and the documentation is at http://localhost:3000/v1/docs.

### Create an admin user

Register an account, follow the link in the verification email, then promote the user in the database:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

## Core flows

These are the main business flows the API supports:

- **Authentication:** register, verify email, log in, log out, reset password, resend verification
- **Profiles:** read and update the current user's profile
- **Shopping:** browse products, add to cart, update quantities and clear cart
- **Checkout:** place orders, reserve stock, verify payment and confirm payment status
- **Refunds:** process cancellations, retry payments and queue refunds safely
- **Admin:** manage products, orders, payments, refunds and user access

## Environment variables

| Variable                                                               | Required                  | Purpose                                                                                                                     |
| ---------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                         | Yes                       | PostgreSQL connection string                                                                                                |
| `JWT_SECRET`                                                           | Yes                       | Signs login tokens. The server will not start without it.                                                                   |
| `BASE_URL`                                                             | Yes                       | Public URL of the API, used in email links and the Paystack callback                                                        |
| `PAYSTACK_SECRET_KEY`                                                  | Yes                       | Paystack API calls and webhook signatures                                                                                   |
| `EMAIL_USER`, `EMAIL_PASS`                                             | Yes                       | Gmail address and app password                                                                                              |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Yes                       | Product image storage                                                                                                       |
| `PORT`                                                                 | No                        | Defaults to 3000                                                                                                            |
| `NODE_ENV`                                                             | No                        | `development`, `test` or `production`                                                                                       |
| `TEST_DATABASE_URL`                                                    | For tests                 | Local database, wiped on every test run                                                                                     |
| `DATABASE_CA_CERT`                                                     | Recommended in production | Your database provider's CA certificate. Without it the connection is encrypted, but the server's identity is not verified. |
| `CORS_ORIGINS`                                                         | No                        | Comma-separated sites allowed to call the API from a browser                                                                |
| `TRUST_PROXY_HOPS`                                                     | No                        | Number of proxies in front of the app, so rate limits apply per client. Defaults to 1.                                      |

## API overview

All routes start with `/v1`. Most require an `Authorization: Bearer <token>` header. The interactive docs at https://ecommerce-api-jq0h.onrender.com/v1/docs provide the full request and response details.

| Area      | Routes                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth      | `POST /auth/register`, `/auth/resend-verification`, `/auth/login`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password/:token`, `GET /auth/verify-email/:token` |
| Profile   | `GET /user/profile`, `PATCH /user/updateprofile`                                                                                                                           |
| Products  | `GET /product`, `GET /product/:id`                                                                                                                                         |
| Cart      | `GET`, `POST`, `DELETE /cart`, plus `PATCH`, `DELETE /cart/:id`                                                                                                            |
| Addresses | `GET`, `POST /shipping`, plus `GET`, `PATCH`, `DELETE /shipping/:id`                                                                                                       |
| Orders    | `POST`, `GET /order`, `GET /order/:id`, `GET /order/:id/history`, `DELETE /order/:id`                                                                                      |
| Payments  | `GET /order/payment/verify/:reference`, `GET /payments/status/:reference`, `POST /payments/webhook`                                                                        |
| Admin     | `/admin/users`, `/admin/products`, `/admin/orders`, `/admin/payments`, `/admin/refunds`                                                                                    |

### Errors

Errors use one common format:

```json
{
  "success": false,
  "message": "Error message here"
}
```

Validation failures return `400` and list each invalid field:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "password", "message": "Password is required" }]
}
```

Unexpected errors return `500` with a generic message. Details are logged on the server only.

### Order lifecycle

```text
pending ──paid──► processing ──► shipped ──► delivered
   │                  │
   └──► cancelled ◄───┘
```

Unpaid orders are cancelled automatically after 24 hours. Other status changes are rejected with a `409`.

### Refunds

Refunds are always for the full amount, and each payment can only have one.

```text
required ──► processing ──► pending ──► processed
    ▲            │  │
    └─ retry ────┘  └──► failed ──► (admin retry)
```

- Temporary failures, such as Paystack being unreachable, retry up to 5 attempts with growing delays.
- A clear rejection from Paystack fails immediately because retrying will not change the answer.
- Paystack's refund webhooks have final say and stop any retry still waiting.
- Admins see stuck refunds at `GET /v1/admin/refunds?status=failed` and can retry them with `POST /v1/admin/refunds/:id/retry`.

## Testing

Tests run the real API against a local PostgreSQL database. Paystack, email and Cloudinary are mocked, and real email cannot be sent during a test run.

1. Create an empty `ecommerce_test` database.
2. Set `TEST_DATABASE_URL` in `.env`. It must point to `localhost`, because the database is wiped on every run.
3. Run the tests:

   ```bash
   npm test                # all tests
   npm run test:coverage   # with a coverage report
   ```

GitHub Actions runs the tests and a dependency audit on every push to `main` and on pull requests.

## Database changes

`schema.sql` describes a new database. To change an existing one, add a numbered file to `migrations/`, update `schema.sql` to match, then run:

```bash
npm run migrate
```

The migration runner records what it applies in a `schema_migrations` table, so each file runs once per database. Write migrations so they are safe to run twice, because a database that existed before tracking was added will replay them on first use.

## Deployment

1. Set the environment variables above, including `NODE_ENV=production`.
2. Run `npm run migrate` against the production database **before** deploying code that depends on the change.
3. Start the app with `npm start`.
4. In the Paystack dashboard, set the webhook URL to `https://your-domain/v1/payments/webhook`.
5. If the app sits behind a proxy or load balancer, set `TRUST_PROXY_HOPS` to the correct value so rate limits apply per client instead of per proxy.

The server shuts down gracefully on `SIGTERM`, finishing requests in progress before exiting.

## Troubleshooting

- **Database connection errors:** confirm the database is running and that `DATABASE_URL` points to the correct host, port and database.
- **Webhook verification fails:** confirm the exact webhook URL in Paystack and verify that `PAYSTACK_SECRET_KEY` matches the dashboard value.
- **Email links do not work locally:** confirm `BASE_URL` points to the correct local URL and that your app is being reached on that host.
- **Rate limiting feels wrong behind a proxy:** set `TRUST_PROXY_HOPS` to match how many proxy hops sit in front of the API.
- **Tests fail with a local DB error:** make sure `TEST_DATABASE_URL` points to a local PostgreSQL instance and not a hosted database.

## License

This project is licensed under the ISC license.
