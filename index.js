require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require('firebase-admin');
const { initAuthRoutes } = require('./routes/auth');
const { initAdminRoutes } = require('./routes/admin');
const { initManagerRoutes } = require('./routes/manager');
const { initMemberRoutes } = require('./routes/member');
const { initPaymentRoutes } = require('./routes/payments');
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
const allowedOrigins = [
  'https://clubsphere-c7f59.web.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Always allow Firebase frontend URL
    if (origin === 'https://clubsphere-c7f59.web.app') {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else if (process.env.FRONTEND_URL && origin.includes(process.env.FRONTEND_URL)) {
      // Allow if FRONTEND_URL env var matches
      callback(null, true);
    } else {
      // For production on Vercel, allow all origins to prevent CORS issues
      // You can restrict this later if needed
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
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

// Connect to MongoDB (for serverless, connection is reused)
let isConnected = false;
let dbConnection = null;

async function connectToDatabase() {
  if (isConnected && dbConnection) {
    return dbConnection;
  }
  
  try {
    await client.connect();
    isConnected = true;
    dbConnection = client;
    console.log('MongoDB connected successfully');
    return dbConnection;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

app.get('/', (req, res) => {
  res.send('server is running')
});

// Initialize routes - this will be called on first request
async function initializeRoutes() {
  if (app.routesInitialized) {
    return;
  }
  
  try {
    const db = await connectToDatabase();
    
    // Initialize auth routes with MongoDB client
    const authRouter = initAuthRoutes(db);
    app.use('/api/auth', authRouter);

    // Initialize admin routes with MongoDB client
    const adminRouter = await initAdminRoutes(db);
    app.use('/api/admin', adminRouter);

    // Initialize manager routes with MongoDB client
    const managerRouter = initManagerRoutes(db);
    app.use('/api/manager', managerRouter);

    // Initialize member routes with MongoDB client
    const memberRouter = initMemberRoutes(db);
    app.use('/api/member', memberRouter);

    // Initialize payment routes with MongoDB client
    const paymentRouter = initPaymentRoutes(db);
    app.use('/api/payments', paymentRouter);

    // Public endpoint to fetch active/featured clubs (no authentication required)
    // IMPORTANT: This must come BEFORE /api/clubs/:id to avoid route conflicts
    app.get('/api/clubs/featured', async (req, res) => {
      try {
        const db = client.db('clubsphere');
        const clubsCollection = db.collection('clubs');
        const limit = parseInt(req.query.limit) || 10;

        // Fetch active clubs, or clubs without status (for backward compatibility)
        const query = {
          $or: [
            { status: 'active' },
            { status: { $exists: false } },
            { status: null }
          ]
        };

        const clubs = await clubsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();

        // Format response to match frontend expectations
        const formattedClubs = clubs.map(club => {
          const memberCount = club.memberCount || 0;
          const memberCountFormatted = memberCount >= 1000 
            ? `${(memberCount / 1000).toFixed(1)}k` 
            : memberCount.toString();

          const nextEvent = 'Coming soon';

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
          
          // Get fee (prioritize fee over price for newer events)
          let eventFee = 0;
          if (event.fee !== undefined) {
            eventFee = event.fee;
          } else if (event.price !== undefined) {
            // Price is stored in cents (legacy format), convert to taka
            eventFee = event.price / 100;
          } else if (event.type === 'Paid' && event.amount) {
            eventFee = event.amount;
          }

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

    // Endpoint to check if user is a member of a club (optional auth)
    app.get('/api/clubs/:id/membership', async (req, res) => {
      try {
        const db = client.db('clubsphere');
        const membershipsCollection = db.collection('memberships');
        const { id } = req.params;
        
        // Get userId from token if available (optional auth)
        const token = req.headers.authorization?.split(' ')[1];
        let userId = null;
        
        if (token) {
          try {
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            userId = decoded.userId;
          } catch (error) {
            // Token invalid or expired, but that's okay - just return not a member
            userId = null;
          }
        }

        if (!userId) {
          return res.json({ isMember: false, membership: null });
        }

        // Check if membership exists - try both string and ObjectId formats
        let membership = await membershipsCollection.findOne({
          userId: userId,
          $or: [
            { clubId: id.toString() },
            { clubId: id }
          ],
          status: { $in: ['active', 'pending'] }
        });

        // If not found and id is a valid ObjectId, try with ObjectId string
        if (!membership && ObjectId.isValid(id)) {
          membership = await membershipsCollection.findOne({
            userId: userId,
            clubId: new ObjectId(id).toString(),
            status: { $in: ['active', 'pending'] }
          });
        }

        if (membership) {
          return res.json({ 
            isMember: true, 
            membership: {
              id: membership._id.toString(),
              status: membership.status,
              joinDate: membership.joinDate,
              expiryDate: membership.expiryDate
            }
          });
        }

        res.json({ isMember: false, membership: null });
      } catch (error) {
        console.error('Check membership error:', error);
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
          
          // Get fee from event (prioritize fee over price for newer events)
          let eventFee = 0;
          if (event.fee !== undefined) {
            eventFee = event.fee;
          } else if (event.price !== undefined) {
            // Price is stored in cents (legacy format), convert to taka
            eventFee = event.price / 100;
          } else if (event.type === 'Paid' && event.amount) {
            eventFee = event.amount;
          }
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
    // IMPORTANT: This specific route must come BEFORE /api/events/:id to avoid route conflicts
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
        const clubsCollection = db.collection('clubs');
        const formattedEvents = await Promise.all(events.map(async (event) => {
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

          // Get clubId - first try from event, if not available, look up by clubName
          let clubId = null;
          if (event.clubId) {
            clubId = typeof event.clubId === 'string' ? event.clubId : event.clubId.toString();
          } else if (event.clubName) {
            // Try to find club by name to get the ID
            const club = await clubsCollection.findOne({ name: event.clubName });
            if (club) {
              clubId = club._id.toString();
            }
          }

          return {
            id: event._id.toString(),
            name: event.name || '',
            clubName: event.clubName || '',
            clubId: clubId,
            image: event.image || null,
            date: eventDate,
            month: month,
            day: day,
            formattedDate: formattedDate,
            location: event.location || '',
            time: timeStr
          };
        }));

        res.json({ events: formattedEvents });
      } catch (error) {
        console.error('Get upcoming events error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Public endpoint to fetch a single event by ID (no authentication required)
    // This comes AFTER /api/events/upcoming so the specific route matches first
    app.get('/api/events/:id', async (req, res) => {
      try {
        const db = client.db('clubsphere');
        const eventsCollection = db.collection('events');
        const { id } = req.params;
        
        let event;
        
        // Try to find by ObjectId first
        if (ObjectId.isValid(id)) {
          event = await eventsCollection.findOne({ _id: new ObjectId(id) });
        }
        
        // If not found, try finding by string id
        if (!event) {
          event = await eventsCollection.findOne({ _id: id });
        }

        if (!event) {
          return res.status(404).json({ error: 'Event not found' });
        }

        // Only exclude cancelled events, allow active events or events without status
        if (event.status === 'cancelled') {
          return res.status(404).json({ error: 'Event not found' });
        }

        const eventDate = event.date ? new Date(event.date) : new Date();
        const timeStr = event.time || '12:00 PM';
        
        // Get fee from event (prioritize fee over price for newer events)
        let eventFee = 0;
        if (event.fee !== undefined) {
          // Fee is stored in taka (newer format)
          eventFee = event.fee;
        } else if (event.price !== undefined) {
          // Price is stored in cents (legacy format), convert to taka
          eventFee = event.price / 100;
        } else if (event.type === 'Paid' && event.amount) {
          eventFee = event.amount;
        }
        const isPaid = eventFee > 0;

        // Get club info if clubId exists
        let clubImage = null;
        if (event.clubId) {
          const clubsCollection = db.collection('clubs');
          let club;
          if (ObjectId.isValid(event.clubId)) {
            club = await clubsCollection.findOne({ _id: new ObjectId(event.clubId) });
          } else {
            club = await clubsCollection.findOne({ _id: event.clubId });
          }
          if (club) {
            clubImage = club.image || null;
          }
        }

        // Get current attendees count from registrations collection
        const registrationsCollection = db.collection('registrations');
        const currentAttendees = await registrationsCollection.countDocuments({
          eventId: event._id.toString(),
          status: 'registered'
        });

        // Format response to match frontend expectations
        const formattedEvent = {
          id: event._id.toString(),
          title: event.name || '',
          name: event.name || '',
          eventDate: eventDate.toISOString(),
          date: eventDate,
          time: timeStr,
          location: event.location || '',
          description: event.description || '',
          image: event.image || clubImage || null,
          clubName: event.clubName || '',
          clubImage: clubImage || null,
          eventFee: eventFee,
          isPaid: isPaid,
          currentAttendees: currentAttendees,
          maxAttendees: event.maxAttendees || null,
          clubId: event.clubId || null
        };

        res.json(formattedEvent);
      } catch (error) {
        console.error('Get event by ID error:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
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

    app.routesInitialized = true;
  } catch (error) {
    console.error('Error initializing routes:', error);
    throw error;
  }
}

// Middleware to ensure routes are initialized before handling requests
app.use(async (req, res, next) => {
  try {
    await initializeRoutes();
    next();
  } catch (error) {
    console.error('Route initialization error:', error);
    res.status(500).json({ error: 'Server initialization error' });
  }
});

// For local development
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  async function run() {
    try {
      await connectToDatabase();
      await initializeRoutes();
      
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
}

// Export for Vercel serverless functions
module.exports = app;

