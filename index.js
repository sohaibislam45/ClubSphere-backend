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
      const adminRouter = await initAdminRoutes(client);
      app.use('/api/admin', adminRouter);

      // Initialize manager routes with MongoDB client
      const managerRouter = initManagerRoutes(client);
      app.use('/api/manager', managerRouter);

      // Initialize member routes with MongoDB client
      const memberRouter = initMemberRoutes(client);
      app.use('/api/member', memberRouter);

      // Public endpoint to fetch active/featured clubs (no authentication required)
      app.get('/api/clubs/featured', async (req, res) => {
        try {
          const db = client.db('clubsphere');
          const clubsCollection = db.collection('clubs');
          const limit = parseInt(req.query.limit) || 10;

          // Fetch active clubs, sorted by creation date (newest first)
          const clubs = await clubsCollection
            .find({ status: 'active' })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();

          // Format response to match frontend expectations
          const formattedClubs = clubs.map(club => {
            // Format member count
            const memberCount = club.memberCount || 0;
            const memberCountFormatted = memberCount >= 1000 
              ? `${(memberCount / 1000).toFixed(1)}k` 
              : memberCount.toString();

            // Get next event date (placeholder - can be enhanced with actual event data)
            const nextEvent = 'Coming soon';

            // Format category - capitalize first letter and handle common mappings
            const categoryMap = {
              'sports': 'Fitness',
              'tech': 'Tech',
              'technology': 'Tech',
              'arts': 'Arts',
              'photography': 'Photography',
              'gaming': 'Gaming',
              'music': 'Music',
              'social': 'Social',
              'lifestyle': 'Lifestyle'
            };
            const category = club.category || 'General';
            const formattedCategory = categoryMap[category.toLowerCase()] || 
              category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();

            return {
              id: club._id.toString(),
              name: club.name,
              category: formattedCategory,
              members: memberCountFormatted,
              nextEvent: nextEvent,
              image: club.image || null,
              description: club.description || '',
              location: club.location || ''
            };
          });

          res.json({ clubs: formattedClubs });
        } catch (error) {
          console.error('Get featured clubs error:', error);
          res.status(500).json({ error: 'Internal server error' });
        }
      });

      // Public endpoint to fetch upcoming events (no authentication required)
      app.get('/api/events/upcoming', async (req, res) => {
        try {
          const db = client.db('clubsphere');
          const eventsCollection = db.collection('events');
          const limit = parseInt(req.query.limit) || 6;
          const now = new Date();

          // Fetch upcoming events (date >= now), sorted by date (earliest first)
          const events = await eventsCollection
            .find({ 
              date: { $gte: now },
              status: 'active'
            })
            .sort({ date: 1 })
            .limit(limit)
            .toArray();

          // Format response to match frontend expectations
          const formattedEvents = events.map(event => {
            const eventDate = event.date ? new Date(event.date) : new Date();
            const timeStr = event.time || '12:00 PM';
            
            // Format date for display
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = months[eventDate.getMonth()];
            const day = eventDate.getDate();
            
            // Format day of week and time
            const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayOfWeek = daysOfWeek[eventDate.getDay()];
            const formattedDate = `${dayOfWeek}, ${timeStr}`;

            return {
              id: event._id.toString(),
              name: event.name || '',
              clubName: event.clubName || '',
              image: event.image || null,
              date: eventDate,
              month: month,
              day: day,
              formattedDate: formattedDate,
              location: event.location || '',
              time: timeStr
            };
          });

          res.json({ events: formattedEvents });
        } catch (error) {
          console.error('Get upcoming events error:', error);
          res.status(500).json({ error: 'Internal server error' });
        }
      });

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

