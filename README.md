# 🛒 E-Commerce API

A comprehensive RESTful API for managing an e-commerce platform, built using Node.js, Express.js, and PostgreSQL. The API includes secure user authentication, product management with image uploads via Cloudinary, and order processing with payment integration. The database schema is managed using pgAdmin, and API documentation is served via Swagger UI.

## 🚀 Live Demo

- **API Base URL**: https://ecommerce-api-jq0h.onrender.com
- **Interactive Documentation**: https://ecommerce-api-jq0h.onrender.com/v1/docs
- **Status**: [![Render Status](https://img.shields.io/website?url=https://ecommerce-api-jq0h.onrender.com)](https://ecommerce-api-jq0h.onrender.com)

## Features

### 🛍️ Core E-Commerce Functionality
- **Product Management**: Create, read, update, and delete products, with image uploads handled by Cloudinary
- **User Authentication**: JWT-based authentication system
- **Shopping Cart**: Add, retrieve, remove, and update cart items
- **Order Processing**: Complete order lifecycle management
- **Payment Integration**: Secure payment processing with Paystack
- **Inventory Management**: Track stock levels and availability


### 🔐 Security Features
- JWT authentication and authorization
- Password hashing with bcrypt
- Input validation and sanitization
- API key authentication for admin routes

### 📊 Additional Features
- User profiles and account management
- Order history and tracking
- Search and filtering capabilities
- Admin dashboard endpoints
- Email notifications
- File upload for product images

## Technology Stack

- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL with pg (node-postgres) driver
- **Database Management**: pgAdmin
- **Authentication**: JSON Web Tokens (JWT)
- **Password Hashing**: bcrypt
- **File Upload**: Multer with Cloudinary integration
- **Documentation**: Swagger UI Express with YAML

## Getting Started

### Prerequisites

- Node.js (v14.0.0 or higher)
- PostgreSQL (v12.0 or higher)
- pgAdmin (for database management)
- npm or yarn package manager

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/emmaimade/e-commerce-api.git
   cd e-commerce-api
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   Create a `.env` file in the root directory:
   ```env
   PORT=3000
   PG_USER="postgres"
   PG_HOST="localhost"
   PG_DATABASE="ecommerce"
   PG_PASSWORD="your-password"
   PG_PORT=5432
   JWT_SECRET=your-secret-key-here
   EMAIL_USER=your-email@gmail.com
   EMAIL_PASS=your-app-password
   CLOUDINARY_CLOUD_NAME=your-cloudinary-name
   CLOUDINARY_API_KEY=your-cloudinary-key
   CLOUDINARY_API_SECRET=your-cloudinary-secret
   PAYSTACK_SECRET_KEY=your-paystack-secret-key
   ```

4. **Database Setup**
   - Open pgAdmin and create a new database named `ecommerce`
   - Apply the schema from the schema.sql file in the repository

  ```sql
  CREATE DATABASE ecommerce;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  -- Copy and execute the CREATE TABLE and CREATE INDEX statements from schema.sql
  ```

5. **Start the server**
   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start
   ```

The API will be available at `http://localhost:3000` (or the port specified in .env).

### Package Dependencies

### Core Dependencies
- **axios**: HTTP client for making API requests
- **bcrypt**: Password hashing library
- **body-parser**: Express middleware for parsing request bodies
- **cloudinary**: Cloud-based image and video management
- **country-list**: ISO country data for validation
- **crypto**: Cryptographic functionality
- **dotenv**: Environment variable management
- **express**: Web application framework
- **jsonwebtoken**: JWT implementation for authentication
- **libphonenumber-js**: Phone number parsing and validation
- **multer**: Middleware for handling multipart/form-data
- **nodemailer**: Email sending library
- **pg**: PostgreSQL client for Node.js
- **swagger-ui-express**: Swagger UI middleware for Express
- **yamljs**: YAML parser for Swagger documentation

## API Documentation

### Live Documentation
🌐 **Interactive API Documentation**: [https://ecommerce-api-jq0h.onrender.com/v1/docs](https://ecommerce-api-jq0h.onrender.com/v1/docs)

### Local Development
Once the server is running locally, you can access the interactive Swagger documentation at http://localhost:3000/v1/docs (or the port specified in your .env file).

The Swagger UI allows you to explore and test the API endpoints interactively, including authentication flows and example requests.

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | User login |
| POST | `/api/v1/auth/forgot-password` | Forgot password |
| POST | `/api/v1/auth/reset-password/:token` | Reset password |

## User Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/user/profile` | Get current user |
| PATCH | `/api/v1/user/updateprofile` | Update user profile |

### Product Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/products` | Get all products |
| GET | `/api/v1/products/:id` | Get product by ID |
| POST | `/api/v1/admin/products` | Create new product (Admin) |
| PATCH | `/api/v1/admin/products/:id` | Update product (Admin) |
| PATCH | `/api/v1/admin/products/:id/images` | Delete product image (Admin) |
| DELETE | `/api/v1/admin/products/:id` | Delete product (Admin) |

### Cart Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/cart` | Get user's cart |
| POST | `/api/v1/cart` | Add item to cart |
| PATCH | `/api/v1/cart/:id` | Update cart item quantity |
| DELETE | `/api/v1/cart/:id` | Remove item from cart |
| DELETE | `/api/v1/cart` | Clear cart |

### Order Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/order` | Get user's orders |
| GET | `/api/v1/order/:id` | Get order by ID |
| GET | `/api/v1/order/:orderId/history` | Get order history |
| GET | `/api/v1/order/payment/verify/:reference` | Verify payment |
| POST | `/api/v1/order` | Create new order |
| POST | `/api/v1/admin/orders/payment/verify` | Verify Payment (Admin) |
| PUT | `/api/v1/admin/orders/:id/status` | Update order status (Admin) |
| DELETE | `/api/v1/order/:id` | Cancel order |

### Payment Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/payments/status/:reference` | Get Payment Status |
| GET | `/api/v1/admin/payments/status/:reference` | Get Payment Status (Admin) |
| GET | `/api/v1/admin/payments/logs` | Get Payment Logs (Admin) |
| GET | `/api/v1/admin/payments/analytics` | Get Payment Analytics (Admin) |
| POST | `/api/v1/payments/webhook` | Payment webhook |

### Shipping Address Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/shipping` | Get all user addresses |
| GET | `/api/v1/shipping/:id` | Get user address by ID |
| POST | `/api/v1/shipping` | Add new shipping address |
| PATCH | `/api/v1/shipping/:id` | Update an address |
| DELETE | `/api/v1/shipping/:id` | Delete an address |

## Request/Response Examples

### Register User
```javascript
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

### Create Product
```javascript
POST /api/products
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "iPhone 13",
  "description": "Latest iPhone model",
  "price": 999,
  "stock": 50,
  "images": ["image1.jpg", "image2.jpg"]
}
```

### Add to Cart
```javascript
POST /api/cart
Authorization: Bearer <token>
Content-Type: application/json

{
  "productId": "product-id-here",
  "quantity": 2
}
```

## Error Handling

The API uses consistent error response format:

```javascript
{
  "success": false,
  "error": "Error message here",
  "statusCode": 400
}
```

<!--## Testing

```bash
# Run all tests (if test suite is implemented)
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

*Note: Add your preferred testing framework (Jest, Mocha, etc.) to package.json if not already included*-->

### Database Setup with pgAdmin
1. Open pgAdmin and connect to your PostgreSQL server
2. Create a new database named `ecommerce`
3. Execute the SQL commands from schema.sql in pgAdmin to create tables and indexes.

## Deployment

### Environment Variables for Production

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://username:password@hostname:5432/ecommerce
JWT_SECRET=your-super-secret-jwt-key
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/new-feature`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, suggestion or feedback, email emmaimade14@gmail.com or create an issue in the GitHub repository.

## Changelog

### v1.0.0
- Initial release with core e-commerce functionality
- User authentication and authorization
- Product and category management
- Shopping cart and order processing
- Payment integration

<!--
### v1.1.0
- Added product reviews and ratings
- Improved search functionality
- Enhanced error handling
- Performance optimizations

API Documentation

Access interactive API documentation via Swagger UI at http://localhost:5000/api-docs.
For testing, import the ecommerce-api.postman_collection file into Postman to explore endpoints.

Security Features

SQL Injection Prevention: Uses parameterized queries with the pg library to prevent SQL injection.
Rate Limiting: Prevents abuse by limiting requests per client (via express-rate-limit)
CORS: Configured to allow secure cross-origin requests.

-->
