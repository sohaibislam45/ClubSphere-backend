# ClubSphere Backend API

A robust RESTful API backend for ClubSphere, a comprehensive club management platform that enables users to discover, join, and manage clubs and events. Built with Node.js, Express, and MongoDB.

## 🚀 Features

- **Authentication & Authorization**
  - JWT-based authentication
  - Firebase Admin integration for Google OAuth
  - Role-based access control (Admin, Club Manager, Member)
  - Secure password hashing with bcrypt

- **Club Management**
  - Create, update, and manage clubs
  - Club approval workflow (Admin approval required)
  - Category-based organization
  - Member count tracking
  - Featured clubs endpoint

- **Event Management**
  - Create and manage events
  - Event registration system
  - Upcoming events tracking
  - Event filtering and search

- **Membership System**
  - Join/leave clubs
  - Membership status tracking
  - Membership expiry management

- **Payment Integration**
  - Stripe payment processing
  - Event registration payments
  - Membership fee payments
  - Transaction history

- **Public APIs**
  - Browse clubs and events without authentication
  - Search and filter functionality
  - Platform statistics

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js 5.x
- **Database**: MongoDB (MongoDB Atlas)
- **Authentication**: 
  - JWT (JSON Web Tokens)
  - Firebase Admin SDK
- **Payment Processing**: Stripe
- **Deployment**: Vercel (Serverless)
- **Security**: bcryptjs, CORS

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v16 or higher)
- **npm** or **yarn**
- **MongoDB Atlas** account (or local MongoDB instance)
- **Firebase** project (for Google OAuth)
- **Stripe** account (for payment processing)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd clubsphere-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env` file in the root directory with the following variables:
   ```env
   # Server Configuration
   PORT=3000
   NODE_ENV=development

   # MongoDB Configuration
   DB_USER=your_mongodb_username
   DB_PASS=your_mongodb_password

   # JWT Configuration
   JWT_SECRET=your_jwt_secret_key

   # Firebase Admin Configuration
   FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}

   # Stripe Configuration
   STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key

   # Frontend URL (optional)
   FRONTEND_URL=https://your-frontend-domain.com
   ```

4. **Start the development server**
   ```bash
   npm start
   ```

   The server will start on `http://localhost:3000` (or the port specified in your `.env` file).

## 📁 Project Structure

```
clubsphere-backend/
├── index.js                 # Main application entry point
├── middleware/
│   └── auth.js             # JWT authentication & authorization middleware
├── routes/
│   ├── auth.js             # Authentication routes (register, login, Google OAuth)
│   ├── admin.js            # Admin routes (user management, club approval)
│   ├── manager.js          # Club manager routes (club & event management)
│   ├── member.js           # Member routes (memberships, registrations)
│   └── payments.js         # Payment processing routes (Stripe integration)
├── package.json            # Dependencies and scripts
├── vercel.json            # Vercel deployment configuration
└── README.md              # This file
```

## 🔌 API Endpoints

### Authentication (`/api/auth`)

- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - User login
- `POST /api/auth/google` - Google OAuth authentication
- `GET /api/auth/me` - Get current user profile (Protected)
- `PUT /api/auth/profile` - Update user profile (Protected)

### Admin Routes (`/api/admin`)

All admin routes require authentication and admin role.

- `GET /api/admin/users` - Get all users
- `GET /api/admin/clubs` - Get all clubs (pending/active)
- `PUT /api/admin/clubs/:id/approve` - Approve a club
- `PUT /api/admin/clubs/:id/reject` - Reject a club
- `GET /api/admin/events` - Get all events
- `GET /api/admin/transactions` - Get all transactions
- `GET /api/admin/stats` - Get platform statistics

### Manager Routes (`/api/manager`)

All manager routes require authentication and clubManager role.

- `POST /api/manager/clubs` - Create a new club
- `GET /api/manager/clubs` - Get manager's clubs
- `PUT /api/manager/clubs/:id` - Update club details
- `POST /api/manager/events` - Create a new event
- `GET /api/manager/events` - Get manager's events
- `PUT /api/manager/events/:id` - Update event details
- `GET /api/manager/memberships` - Get club memberships
- `GET /api/manager/registrations` - Get event registrations

### Member Routes (`/api/member`)

All member routes require authentication.

- `GET /api/member/clubs` - Get user's joined clubs
- `POST /api/member/clubs/:id/join` - Join a club
- `DELETE /api/member/clubs/:id/leave` - Leave a club
- `GET /api/member/events` - Get user's registered events
- `POST /api/member/events/:id/register` - Register for an event
- `DELETE /api/member/events/:id/unregister` - Unregister from an event
- `GET /api/member/transactions` - Get user's transaction history

### Payment Routes (`/api/payments`)

- `POST /api/payments/create-intent` - Create Stripe payment intent (Protected)
- `POST /api/payments/confirm` - Confirm payment (Protected)
- `GET /api/payments/status/:id` - Get payment status (Protected)

### Public Routes

These routes do not require authentication.

- `GET /api/clubs` - Get all active clubs (with search and filter)
- `GET /api/clubs/featured` - Get featured clubs
- `GET /api/clubs/:id` - Get club by ID
- `GET /api/clubs/:id/events` - Get events for a club
- `GET /api/clubs/:id/membership` - Check membership status (optional auth)
- `GET /api/events` - Get all upcoming events (with search and filter)
- `GET /api/events/upcoming` - Get upcoming events
- `GET /api/events/:id` - Get event by ID
- `GET /api/events/:id/registration` - Check registration status (optional auth)
- `GET /api/memberships/my-clubs` - Get user's club IDs (optional auth)
- `GET /api/public/stats` - Get platform statistics
- `GET /api/categories` - Get all categories

## 🔐 Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

### User Roles

- **admin**: Full system access
- **clubManager**: Can create and manage clubs and events
- **member**: Can join clubs and register for events

## 🗄️ Database Schema

The application uses MongoDB with the following main collections:

- **users**: User accounts and profiles
- **clubs**: Club information and details
- **events**: Event information
- **memberships**: User-club relationships
- **registrations**: User-event registrations
- **transactions**: Payment transaction records
- **categories**: Club categories

## 🚀 Deployment

### Vercel Deployment

The backend is configured for serverless deployment on Vercel.

1. **Install Vercel CLI** (if not already installed)
   ```bash
   npm i -g vercel
   ```

2. **Deploy to Vercel**
   ```bash
   vercel
   ```

3. **Set environment variables in Vercel dashboard**
   - Go to your project settings
   - Add all environment variables from your `.env` file

4. **Configure CORS**
   - Update `allowedOrigins` in `index.js` with your production frontend URL

### Environment Variables for Production

Ensure all environment variables are set in your deployment platform:

- `DB_USER`
- `DB_PASS`
- `JWT_SECRET`
- `FIREBASE_SERVICE_ACCOUNT_KEY`
- `STRIPE_SECRET_KEY`
- `FRONTEND_URL` (optional)

## 🔒 Security Considerations

- Passwords are hashed using bcrypt
- JWT tokens are used for stateless authentication
- CORS is configured to restrict origins
- Input validation on all endpoints
- Role-based access control for sensitive operations
- MongoDB connection uses SSL/TLS

## 🧪 Testing

Currently, no test suite is configured. To add tests:

1. Install a testing framework (e.g., Jest, Mocha)
2. Create test files in a `tests/` directory
3. Add test scripts to `package.json`

## 📝 API Response Format

### Success Response
```json
{
  "data": { ... },
  "message": "Success message"
}
```

### Error Response
```json
{
  "error": "Error message",
  "message": "Detailed error description"
}
```

### Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For issues, questions, or contributions, please open an issue in the repository.

## 📞 Contact

For more information about ClubSphere, visit the project repository.

---

**Note**: Make sure to keep your `.env` file secure and never commit it to version control. Add `.env` to your `.gitignore` file.

