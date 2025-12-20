require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const admin = require('firebase-admin');
const { initAuthRoutes } = require('./routes/auth');
const { initAdminRoutes } = require('./routes/admin');
const { initManagerRoutes } = require('./routes/manager');
const { initMemberRoutes } = require('./routes/member');
const { verifyToken } = require('./middleware/auth');
const app = express();
const port = process.env.PORT || 3000;

// Initialize Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
    console.log('Google OAuth will not work until Firebase Admin is properly configured');
  }
} else {
  console.log('FIREBASE_SERVICE_ACCOUNT_KEY not found. Google OAuth will not work.');
}

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// URL encode the password to handle special characters
const encodedPassword = encodeURIComponent(process.env.DB_PASS);
const uri = `mongodb+srv://${process.env.DB_USER}:${encodedPassword}@cluster0.wl7wowv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

app.get('/', (req, res) => {
  res.send('server is running')
});

async function run() {
    try {
      // Connect the client to the server
      await client.connect();
      
      // Initialize auth routes with MongoDB client
      const authRouter = initAuthRoutes(client);
      app.use('/api/auth', authRouter);

      // Initialize admin routes with MongoDB client
      const adminRouter = initAdminRoutes(client);
      app.use('/api/admin', adminRouter);

      // Initialize manager routes with MongoDB client
      const managerRouter = initManagerRoutes(client);
      app.use('/api/manager', managerRouter);

      // Initialize member routes with MongoDB client
      const memberRouter = initMemberRoutes(client);
      app.use('/api/member', memberRouter);

      // Send a ping to confirm a successful connection
      await client.db("admin").command({ ping: 1 });
      console.log("Successfully connected to MongoDB!");
      
      // Start server only after database connection is established
      app.listen(port, () => {
        console.log(`Server listening on port ${port}`)
      });
    } catch (error) {
      console.error('MongoDB connection error:', error.message);
      process.exit(1);
    }
  }
  run().catch((error) => {
    console.error('Unhandled error in run():', error);
    process.exit(1);
  });

