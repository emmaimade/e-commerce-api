# E-Commerce API

A REST API for an online store, built with Node.js, Express and PostgreSQL. It covers accounts, products, carts, checkout, Paystack payments, refunds and order management.

- **Live API:** https://ecommerce-api-jq0h.onrender.com
- **Interactive docs:** https://ecommerce-api-jq0h.onrender.com/v1/docs

The live API runs on a free tier, so the first request after a quiet period can take about a minute.

## Highlights

- **Reliable checkout:** stock is reserved under row locks when an order is placed, so two customers can't buy the last unit. Unpaid orders expire after 24 hours and release their stock.
- **Safe payment handling:** Paystack webhooks are signature-checked and safe to receive twice. Every route that confirms a payment goes through one shared transaction.
- **Refunds that can't get lost:** a refund is saved in the same transaction as the cancellation, then sent to Paystack. Temporary failures retry automatically, payments that arrive after an order was cancelled are refunded automatically, and admins get a queue for anything that needs a person.
- **Security:** email verification, revocable JWTs, role checks against the database, rate limiting, request validation, hashed tokens and security headers.
- **Tested:** integration tests run the real API against a real PostgreSQL database, on every push through GitHub Actions.

## Tech stack

| Area | Tools |
|---|---|
| Runtime | Node.js 22+, Express 5 |
| Database | PostgreSQL with `pg`, hosted on Supabase |
| Payments | Paystack |
| Images and email | Cloudinary, Nodemailer with Gmail |
| Security | JWT, bcrypt, Helmet, CORS, express-rate-limit |
| Validation | zod |
| Testing | Node.js test runner, Supertest |
| Docs and CI | Swagger UI, GitHub Actions |

## Project structure

Requests flow in one direction, and each layer has one job:

```
routes → middleware → controllers → services → database, Paystack, email
```

```
├── routes/v1/       URLs, and the middleware each one needs
├── middleware/      Auth, validation, rate limits, uploads, error handling
├── controllers/v1/  Read the request, call a service, send the response
├── services/        Business logic and all database and external calls
├── emails/          HTML email templates
├── views/           Small pages for browser redirects
├── utils/           Shared helpers (transactions, errors, schemas)
├── config/          Database and Cloudinary connections
├── migrations/      Database changes, applied in order
├── scripts/         Migration runner
├── tests/           Integration tests
├── app.js           Express app setup
├── server.js        Starts the server and the background jobs
├── schema.sql       Full schema for a new database
└── swagger.yaml     API documentation
```

Tests enforce the boundaries: a controller that imports the database or Paystack client fails the suite, and so does a manual `BEGIN` anywhere outside `withTransaction`.

## Getting started

You need Node.js 22 or newer and PostgreSQL 13 or newer.

1. **Clone and install**

   ```bash
   git clone https://github.com/emmaimade/e-commerce-api.git
   cd e-commerce-api
   npm install
   ```

2. **Configure the environment**

   Copy `.env.example` to `.env` and fill it in. See [Environment variables](#environment-variables).

3. **Create the database**

   Create an empty database named `ecommerce` in PostgreSQL, then load the schema:

   ```bash
   npm run migrate -- schema.sql
   ```

4. **Start the server**

   ```bash
   npm run dev
   ```

   The API runs at http://localhost:3000, with docs at http://localhost:3000/v1/docs.

### Create an admin

Register an account, follow the link in the verification email, then promote it in the database:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Signs login tokens. The server won't start without it. |
| `BASE_URL` | Yes | Public URL of the API, used in email links and the Paystack callback |
| `PAYSTACK_SECRET_KEY` | Yes | Paystack API calls and webhook signatures |
| `EMAIL_USER`, `EMAIL_PASS` | Yes | Gmail address and app password |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Yes | Product image storage |
| `PORT` | No | Defaults to 3000 |
| `NODE_ENV` | No | `development`, `test` or `production` |
| `TEST_DATABASE_URL` | For tests | Local database, wiped on every test run |
| `DATABASE_CA_CERT` | Recommended in production | Your database provider's CA certificate. Without it the connection is encrypted, but the server's identity isn't verified. |
| `CORS_ORIGINS` | No | Comma-separated sites allowed to call the API from a browser |
| `TRUST_PROXY_HOPS` | No | Number of proxies in front of the app, so rate limits apply per client. Defaults to 1. |

## API overview

All routes start with `/v1`. Most require an `Authorization: Bearer <token>` header. The [interactive docs](https://ecommerce-api-jq0h.onrender.com/v1/docs) have full request and response details.

| Area | Routes |
|---|---|
| Auth | `POST /auth/register`, `/auth/resend-verification`, `/auth/login`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password/:token`, `GET /auth/verify-email/:token` |
| Profile | `GET /user/profile`, `PATCH /user/updateprofile` |
| Products | `GET /product`, `GET /product/:id` |
| Cart | `GET`, `POST`, `DELETE /cart`, plus `PATCH`, `DELETE /cart/:id` |
| Addresses | `GET`, `POST /shipping`, plus `GET`, `PATCH`, `DELETE /shipping/:id` |
| Orders | `POST`, `GET /order`, `GET /order/:id`, `GET /order/:id/history`, `DELETE /order/:id` |
| Payments | `GET /order/payment/verify/:reference`, `GET /payments/status/:reference`, `POST /payments/webhook` |
| Admin | `/admin/users`, `/admin/products`, `/admin/orders`, `/admin/payments`, `/admin/refunds` |

### Errors

Errors share one format:

```json
{
  "success": false,
  "message": "Error message here"
}
```

Validation failures return 400 and list each field:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "password", "message": "Password is required" }]
}
```

Unexpected errors return 500 with a generic message. Details go to the server logs only.

### Order lifecycle

```
pending ──paid──► processing ──► shipped ──► delivered
   │                  │
   └──► cancelled ◄───┘
```

Unpaid orders are cancelled automatically after 24 hours. Other status changes are rejected with a 409.

### Refunds

Refunds are always for the full amount, and each payment can only have one.

```
required ──► processing ──► pending ──► processed
    ▲            │  │
    └─ retry ────┘  └──► failed ──► (admin retry)
```

- Temporary failures, such as Paystack being unreachable, retry up to 5 attempts with growing delays.
- A clear rejection from Paystack fails straight away, because retrying won't change the answer.
- Paystack's refund webhooks have the final say, and stop any retry still waiting.
- Admins see stuck refunds at `GET /v1/admin/refunds?status=failed`, and retry them with `POST /v1/admin/refunds/:id/retry`.

## Testing

Tests run the real API against a local PostgreSQL database. Paystack, email and Cloudinary are mocked, and real email can't be sent during a test run.

1. Create an empty `ecommerce_test` database.
2. Set `TEST_DATABASE_URL` in `.env`. It must point to localhost, because the database is wiped on every run.
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

The runner records what it applies in a `schema_migrations` table, so each file runs once per database. Write migrations so they're safe to run twice, because a database set up before tracking existed replays them all on its first run.

## Deployment

1. Set the environment variables above, including `NODE_ENV=production`.
2. Run `npm run migrate` against the production database **before** deploying code that needs the change.
3. Start the app with `npm start`.
4. In the Paystack dashboard, set the webhook URL to `https://your-domain/v1/payments/webhook`.

The server shuts down gracefully on `SIGTERM`, finishing requests in progress first.

## License

ISC
