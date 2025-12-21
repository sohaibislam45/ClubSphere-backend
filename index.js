require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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
      // await client.connect();
      
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
      // IMPORTANT: This must come BEFORE /api/clubs/:id to avoid route conflicts
      app.get('/api/clubs/featured', async (req, res) => {
        try {
          const db = client.db('clubsphere');
          const clubsCollection = db.collection('clubs');
          const limit = parseInt(req.query.limit) || 10;

          // Fetch active clubs, or clubs without status (for backward compatibility)
          // Same logic as /api/clubs endpoint
          const query = {
            $or: [
              { status: 'active' },
              { status: { $exists: false } }, // Include clubs without status field
              { status: null } // Include clubs with null status
            ]
          };

          const clubs = await clubsCollection
            .find(query)
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
              'fitness': 'Fitness',
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

      // Public endpoint to fetch events by club ID (no authentication required)
      // IMPORTANT: This must come BEFORE /api/clubs/:id to avoid route conflicts
      app.get('/api/clubs/:id/events', async (req, res) => {
        try {
          const db = client.db('clubsphere');
          const eventsCollection = db.collection('events');
          const { id } = req.params;
          const now = new Date();
          const limit = parseInt(req.query.limit) || 10;

          // First, get the club to find events by club name or clubId
          const clubsCollection = db.collection('clubs');
          let club;
          
          if (ObjectId.isValid(id)) {
            club = await clubsCollection.findOne({ _id: new ObjectId(id) });
          }
          
          if (!club) {
            return res.status(404).json({ error: 'Club not found' });
          }

          // Find events for this club (by clubName or clubId)
          const query = {
            $or: [
              { clubName: club.name },
              { clubId: id }
            ],
            date: { $gte: now },
            status: 'active'
          };

          const events = await eventsCollection
            .find(query)
            .sort({ date: 1 })
            .limit(limit)
            .toArray();

          // Format response
          const formattedEvents = events.map(event => {
            const eventDate = event.date ? new Date(event.date) : new Date();
            const timeStr = event.time || '12:00 PM';
            
            // Format date for display
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const month = months[eventDate.getMonth()];
            const day = eventDate.getDate();
            
            // Format day of week
            const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dayOfWeek = daysOfWeek[eventDate.getDay()];
            
            // Get fee
            const eventFee = event.fee || (event.type === 'Paid' ? (event.amount || 0) : 0);

            return {
              id: event._id.toString(),
              name: event.name || '',
              title: event.name || '',
              clubName: event.clubName || club.name,
              image: event.image || null,
              date: eventDate,
              eventDate: eventDate.toISOString(),
              month: month,
              day: day,
              dayOfWeek: dayOfWeek,
              time: timeStr,
              formattedDate: `${dayOfWeek}, ${timeStr}`,
              location: event.location || '',
              eventFee: eventFee,
              isPaid: eventFee > 0
            };
          });

          res.json({ events: formattedEvents });
        } catch (error) {
          console.error('Get club events error:', error);
          res.status(500).json({ error: 'Internal server error' });
        }
      });

      // Public endpoint to fetch a single club by ID (no authentication required)
      app.get('/api/clubs/:id', async (req, res) => {
        try {
          const db = client.db('clubsphere');
          const clubsCollection = db.collection('clubs');
          const { id } = req.params;
          let club;
          
          // Try to find by ObjectId first
          if (ObjectId.isValid(id)) {
            club = await clubsCollection.findOne({ _id: new ObjectId(id) });
          }
          
          // If not found, try finding by string id
          if (!club) {
            club = await clubsCollection.findOne({ _id: id });
          }

          if (!club) {
            return res.status(404).json({ error: 'Club not found' });
          }

          // Only return active clubs (or clubs without status for backward compatibility)
          if (club.status && club.status !== 'active' && club.status !== null) {
            return res.status(404).json({ error: 'Club not found' });
          }

          // Format category
          const categoryMap = {
            'sports': 'Fitness',
            'fitness': 'Fitness',
            'tech': 'Tech',
            'technology': 'Tech',
            'arts': 'Arts',
            'photography': 'Photography',
            'gaming': 'Gaming',
            'music': 'Music',
            'social': 'Social',
            'lifestyle': 'Lifestyle'
          };
          const clubCategory = club.category || 'General';
          const formattedCategory = categoryMap[clubCategory.toLowerCase()] || 
            clubCategory.charAt(0).toUpperCase() + clubCategory.slice(1).toLowerCase();

          // Get manager info
          const usersCollection = db.collection('users');
          const manager = club.managerEmail 
            ? await usersCollection.findOne({ email: club.managerEmail })
            : null;

          // Format response
          const formattedClub = {
            id: club._id.toString(),
            clubName: club.name,
            name: club.name,
            category: formattedCategory,
            location: club.location || '',
            membershipFee: club.fee || 0,
            memberCount: club.memberCount || 0,
            bannerImage: club.image || null,
            image: club.image || null,
            description: club.description || '',
            managerName: manager?.name || 'Unknown',
            managerRole: 'Club Manager',
            managerPhoto: manager?.photoURL || null,
            meetingPoint: club.location || '',
            tags: club.tags || []
          };

          res.json(formattedClub);
        } catch (error) {
          console.error('Get club by ID error:', error);
          res.status(500).json({ error: 'Internal server error', message: error.message });
        }
      });

      // Public endpoint to fetch all clubs with search and filter (no authentication required)
      app.get('/api/clubs', async (req, res) => {
        try {
          const db = client.db('clubsphere');
          const clubsCollection = db.collection('clubs');
          const search = req.query.search || '';
          const category = req.query.category || '';

          // First, let's check what clubs exist and their statuses (for debugging)
          const allClubs = await clubsCollection.find({}).toArray();


          // Build query - show active clubs, or clubs without status (for backward compatibility)
          // For public viewing, we want to show approved/active clubs
          // Note: Clubs created by managers have status 'pending' and need admin approval
          const baseStatusQuery = {
            $or: [
              { status: 'active' },
              { status: { $exists: false } }, // Include clubs without status field
              { status: null } // Include clubs with null status
            ]
          };

          // Start with base query
          let query = { ...baseStatusQuery };

          // Add category filter if provided and not 'all'
          if (category && category !== 'all') {
            // Map frontend category names to database category names
            const categoryMap = {
              'fitness': ['sports', 'fitness'],
              'tech': ['tech', 'technology'],
              'arts': ['arts'],
              'lifestyle': ['lifestyle'],
              'sports': ['sports'],
              'social': ['social']
            };
            
            const categoryLower = category.toLowerCase();
            const dbCategories = categoryMap[categoryLower] || [categoryLower];
            // Combine status and category filters using $and
            query = {
              $and: [
                baseStatusQuery,
                {
                  $or: dbCategories.map(cat => ({
                    category: { $regex: `^${cat}$`, $options: 'i' }
                  }))
                }
              ]
            };
          }

          // Fetch clubs, sorted by creation date (newest first)
          let clubs = await clubsCollection
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

          console.log(`Found ${clubs.length} clubs matching query (status: active or no status)`);

          // Apply search filter if provided
          if (search) {
            const searchLower = search.toLowerCase();
            clubs = clubs.filter(club => 
              club.name?.toLowerCase().includes(searchLower) ||
              club.location?.toLowerCase().includes(searchLower) ||
              club.description?.toLowerCase().includes(searchLower)
            );
          }

          // Format response to match frontend expectations
          const formattedClubs = clubs.map(club => {
            // Format category - capitalize first letter and handle common mappings
            const categoryMap = {
              'sports': 'Fitness',
              'fitness': 'Fitness',
              'tech': 'Tech',
              'technology': 'Tech',
              'arts': 'Arts',
              'photography': 'Photography',
              'gaming': 'Gaming',
              'music': 'Music',
              'social': 'Social',
              'lifestyle': 'Lifestyle'
            };
            const clubCategory = club.category || 'General';
            const formattedCategory = categoryMap[clubCategory.toLowerCase()] || 
              clubCategory.charAt(0).toUpperCase() + clubCategory.slice(1).toLowerCase();

            return {
              id: club._id.toString(),
              clubName: club.name,
              name: club.name, // Keep both for compatibility
              category: formattedCategory,
              location: club.location || '',
              membershipFee: club.fee || 0,
              memberCount: club.memberCount || 0,
              bannerImage: club.image || null,
              image: club.image || null, // Keep both for compatibility
              description: club.description || ''
            };
          });

          console.log(`Returning ${formattedClubs.length} formatted clubs`);
          res.json(formattedClubs);
        } catch (error) {
          console.error('Get clubs error:', error);
          console.error('Error stack:', error.stack);
          res.status(500).json({ error: 'Internal server error', message: error.message });
        }
      });

      // Public endpoint to fetch all events (no authentication required)
      app.get('/api/events', async (req, res) => {
        try {
          const db = client.db('clubsphere');
          const eventsCollection = db.collection('events');
          const clubsCollection = db.collection('clubs');
          const now = new Date();
          const search = req.query.search || '';
          const filter = req.query.filter || 'all';

          // Build query
          let query = {
            date: { $gte: now },
            status: 'active'
          };

          // Fetch events
          let events = await eventsCollection
            .find(query)
            .sort({ date: 1 })
            .toArray();

          // Get club images for events
          const clubIds = [...new Set(events.map(e => e.clubId).filter(Boolean))];
          const clubObjectIds = clubIds
            .filter(id => ObjectId.isValid(id))
            .map(id => new ObjectId(id));
          
          let clubs = [];
          if (clubObjectIds.length > 0) {
            clubs = await clubsCollection
              .find({ _id: { $in: clubObjectIds } })
              .toArray();
          }
          
          const clubMap = {};
          clubs.forEach(club => {
            clubMap[club._id.toString()] = club.image || null;
          });

          // Format response to match EventCard expectations
          const formattedEvents = events.map(event => {
            const eventDate = event.date ? new Date(event.date) : new Date();
            const timeStr = event.time || '12:00 PM';
            
            // Get fee from event (could be in fee field or type field)
            const eventFee = event.fee || (event.type === 'Paid' ? (event.amount || 0) : 0);
            const isPaid = eventFee > 0;

            return {
              id: event._id.toString(),
              title: event.name || '',
              eventDate: eventDate.toISOString(),
              eventFee: eventFee,
              isPaid: isPaid,
              clubName: event.clubName || '',
              clubImage: event.clubId ? (clubMap[event.clubId] || null) : null,
              image: event.image || null,
              location: event.location || ''
            };
          });

          // Apply search filter
          let filteredEvents = formattedEvents;
          if (search) {
            const searchLower = search.toLowerCase();
            filteredEvents = formattedEvents.filter(event =>
              event.title?.toLowerCase().includes(searchLower) ||
              event.location?.toLowerCase().includes(searchLower) ||
              event.clubName?.toLowerCase().includes(searchLower)
            );
          }

          // Apply free filter
          if (filter === 'free') {
            filteredEvents = filteredEvents.filter(event => event.eventFee === 0);
          }

          res.json(filteredEvents);
        } catch (error) {
          console.error('Get events error:', error);
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

      // Public endpoint to fetch all categories
      app.get('/api/categories', async (req, res) => {
        try {
          const db = client.db('clubsphere');
          const categoriesCollection = db.collection('categories');
          
          const categories = await categoriesCollection
            .find({})
            .sort({ displayName: 1 })
            .toArray();

          // Format response
          const formattedCategories = categories.map(category => ({
            id: category._id.toString(),
            name: category.name,
            displayName: category.displayName || category.name,
            createdAt: category.createdAt
          }));

          res.json({ categories: formattedCategories });
        } catch (error) {
          console.error('Get categories error:', error);
          res.status(500).json({ error: 'Internal server error' });
        }
      });


      // Send a ping to confirm a successful connection
      // await client.db("admin").command({ ping: 1 });
      // console.log("Successfully connected to MongoDB!");
      
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

