const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { verifyToken, authorize } = require('../middleware/auth');

// MongoDB collections (will be initialized from index.js)
let usersCollection;
let clubsCollection;
let eventsCollection;
let membershipsCollection;
let registrationsCollection;

// Initialize collections
const initManagerRoutes = (client) => {
  const db = client.db('clubsphere');
  usersCollection = db.collection('users');
  clubsCollection = db.collection('clubs');
  eventsCollection = db.collection('events');
  membershipsCollection = db.collection('memberships');
  registrationsCollection = db.collection('registrations');
  return router;
};

// Helper function to format date
const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

// Helper function to format date with day name
const formatDateWithDay = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
};

// Helper function to get user initials
const getUserInitials = (name) => {
  if (!name) return 'U';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name[0].toUpperCase();
};

// ==================== CLUBS MANAGEMENT ====================

// Get all clubs managed by the authenticated manager
router.get('/clubs', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const managerEmail = req.user.email;
    const search = req.query.search || '';
    const category = req.query.category || '';

    // Build query - only clubs managed by this manager
    const query = { managerEmail };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (category && category !== 'All Clubs') {
      // Normalize category name - map common variations
      const categoryMap = {
        'sports': 'sports',
        'fitness': 'fitness',
        'technology': 'technology',
        'tech': 'technology',
        'lifestyle': 'lifestyle',
        'arts': 'arts',
        'arts & culture': 'arts',
        'social': 'social'
      };
      
      const normalizedCategory = categoryMap[category.toLowerCase()] || category.toLowerCase();
      query.category = { $regex: `^${normalizedCategory}$`, $options: 'i' };
    }

    // Get clubs
    const clubs = await clubsCollection.find(query).sort({ createdAt: -1 }).toArray();

    // Get member counts and upcoming event counts for each club
    const clubsWithStats = await Promise.all(clubs.map(async (club) => {
      const memberCount = await membershipsCollection.countDocuments({ 
        clubId: club._id.toString(), 
        status: 'active' 
      });
      
      const now = new Date();
      const upcomingEventCount = await eventsCollection.countDocuments({
        clubId: club._id.toString(),
        date: { $gte: now },
        status: { $ne: 'cancelled' }
      });

      return {
        id: club._id.toString(),
        name: club.name,
        description: club.description || '',
        image: club.image || null,
        category: club.category || 'Uncategorized',
        memberCount,
        upcomingEventCount,
        schedule: club.schedule || '',
        location: club.location || '',
        fee: club.fee ? club.fee / 100 : 0, // Convert from cents to taka
        createdAt: club.createdAt
      };
    }));

    res.json({ clubs: clubsWithStats });
  } catch (error) {
    console.error('Get manager clubs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single club details (verify ownership)
router.get('/clubs/:id', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const { id } = req.params;
    const managerEmail = req.user.email;

    const club = await clubsCollection.findOne({ 
      _id: new ObjectId(id),
      managerEmail 
    });

    if (!club) {
      return res.status(404).json({ error: 'Club not found or access denied' });
    }

    const memberCount = await membershipsCollection.countDocuments({ 
      clubId: id, 
      status: 'active' 
    });

    const upcomingEventCount = await eventsCollection.countDocuments({
      clubId: id,
      date: { $gte: new Date() },
      status: { $ne: 'cancelled' }
    });

    res.json({
      id: club._id.toString(),
      name: club.name,
      description: club.description || '',
      image: club.image || null,
      category: club.category || 'Uncategorized',
      memberCount,
      upcomingEventCount,
      schedule: club.schedule || '',
      location: club.location || '',
      fee: club.fee ? club.fee / 100 : 0, // Convert from cents to taka
      createdAt: club.createdAt
    });
  } catch (error) {
    console.error('Get club error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new club
router.post('/clubs', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const managerEmail = req.user.email;
    const { name, description, image, category, schedule, location, fee } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Club name is required' });
    }

    // Create club object
    const club = {
      name,
      description: description || '',
      image: image || null,
      category: category || 'Uncategorized',
      schedule: schedule || '',
      location: location || '',
      fee: fee ? Math.round(fee * 100) : 0, // Store as cents
      managerEmail,
      status: 'pending', // New clubs need admin approval
      memberCount: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await clubsCollection.insertOne(club);

    res.status(201).json({
      id: result.insertedId.toString(),
      message: 'Club created successfully. It will be visible after admin approval.',
      club: {
        id: result.insertedId.toString(),
        name: club.name,
        description: club.description,
        image: club.image,
        category: club.category,
        schedule: club.schedule,
        memberCount: 0,
        upcomingEventCount: 0
      }
    });
  } catch (error) {
    console.error('Create club error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update club details (verify ownership)
router.put('/clubs/:id', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const { id } = req.params;
    const managerEmail = req.user.email;
    const updateData = req.body;

    // Verify ownership
    const club = await clubsCollection.findOne({ 
      _id: new ObjectId(id),
      managerEmail 
    });

    if (!club) {
      return res.status(404).json({ error: 'Club not found or access denied' });
    }

    // Convert fee to cents if provided (frontend sends in cents already, but handle both cases)
    if (updateData.fee !== undefined) {
      // If fee is less than 100, assume it's in taka and convert to cents
      // Otherwise assume it's already in cents
      if (updateData.fee < 100) {
        updateData.fee = Math.round(updateData.fee * 100);
      } else {
        updateData.fee = Math.round(updateData.fee);
      }
    }

    const result = await clubsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...updateData, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Club not found' });
    }

    res.json({ message: 'Club updated successfully' });
  } catch (error) {
    console.error('Update club error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Request club deletion (creates deletion request for admin approval)
router.delete('/clubs/:id', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const { id } = req.params;
    const managerEmail = req.user.email;

    // Verify ownership
    const club = await clubsCollection.findOne({ 
      _id: new ObjectId(id),
      managerEmail 
    });

    if (!club) {
      return res.status(404).json({ error: 'Club not found or access denied' });
    }

    // Check if deletion request already exists
    if (club.deletionRequest && club.deletionRequest.status === 'pending') {
      return res.status(400).json({ error: 'Deletion request already pending for this club' });
    }

    // Create deletion request
    const deletionRequest = {
      status: 'pending',
      requestedAt: new Date(),
      requestedBy: managerEmail
    };

    const result = await clubsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { deletionRequest, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Club not found' });
    }

    res.json({ 
      message: 'Deletion request submitted successfully. It will be reviewed by an admin.',
      deletionRequest
    });
  } catch (error) {
    console.error('Request club deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== CLUB MEMBERS MANAGEMENT ====================

// Get club members with pagination, search, and filters
router.get('/clubs/:clubId/members', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const { clubId } = req.params;
    const managerEmail = req.user.email;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const skip = (page - 1) * limit;

    // Verify club ownership
    const club = await clubsCollection.findOne({ 
      _id: new ObjectId(clubId),
      managerEmail 
    });

    if (!club) {
      return res.status(404).json({ error: 'Club not found or access denied' });
    }

    // Build query for memberships
    const membershipQuery = { clubId };
    if (status && status !== 'All Members') {
      membershipQuery.status = status.toLowerCase();
    }

    // Get memberships
    const memberships = await membershipsCollection
      .find(membershipQuery)
      .sort({ joinDate: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get user details for each membership
    const membersWithDetails = await Promise.all(memberships.map(async (membership) => {
      const user = await usersCollection.findOne({ _id: new ObjectId(membership.userId) });
      
      if (!user) return null;

      // Apply search filter if provided
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch = 
          user.name?.toLowerCase().includes(searchLower) ||
          user.email?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return null;
      }

      return {
        id: membership._id.toString(),
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        photoURL: user.photoURL || null,
        status: membership.status || 'active',
        joinDate: formatDate(membership.joinDate || membership.createdAt),
        role: membership.role || 'member',
        memberId: `#${user._id.toString().slice(-4)}`
      };
    }));

    // Filter out null results from search
    const filteredMembers = membersWithDetails.filter(m => m !== null);

    // Get total count (for pagination)
    const totalMemberships = await membershipsCollection.countDocuments(membershipQuery);
    
    // Get stats
    const totalMembers = await membershipsCollection.countDocuments({ clubId });
    const activeMembers = await membershipsCollection.countDocuments({ 
      clubId, 
      status: 'active' 
    });
    const pendingRenewals = await membershipsCollection.countDocuments({ 
      clubId, 
      status: 'expired' 
    });

    res.json({
      members: filteredMembers,
      stats: {
        totalMembers,
        activeMembers,
        pendingRenewals
      },
      pagination: {
        page,
        limit,
        total: totalMemberships,
        totalPages: Math.ceil(totalMemberships / limit)
      }
    });
  } catch (error) {
    console.error('Get club members error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== EVENTS MANAGEMENT ====================

// Get events for manager's clubs
router.get('/events', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const managerEmail = req.user.email;
    const filter = req.query.filter || 'all'; // all, upcoming, past, drafts
    const search = req.query.search || '';

    // Get all clubs managed by this manager
    const managerClubs = await clubsCollection.find({ managerEmail }).toArray();
    const clubIds = managerClubs.map(club => club._id.toString());
    const clubObjectIds = managerClubs.map(club => club._id);

    console.log(`[Manager Events] Manager email: ${managerEmail}`);
    console.log(`[Manager Events] Found ${managerClubs.length} clubs:`, clubIds);

    if (clubIds.length === 0) {
      console.log('[Manager Events] No clubs found for manager, returning empty result');
      return res.json({ events: [], stats: { total: 0, upcoming: 0, revenue: 0 } });
    }

    // Build query - handle both string and ObjectId formats for clubId
    const now = new Date();
    
    // Base clubId condition - handle both string and ObjectId formats
    const clubIdCondition = {
      $or: [
        { clubId: { $in: clubIds } }, // String format
        { clubId: { $in: clubObjectIds } } // ObjectId format
      ]
    };
    
    // Build query conditions array - always start with clubId condition
    const queryConditions = [clubIdCondition];
    
    // Add filter conditions
    if (filter === 'upcoming') {
      queryConditions.push({ date: { $gte: now } });
      queryConditions.push({ 
        $or: [
          { status: { $ne: 'cancelled' } },
          { status: { $exists: false } },
          { status: null }
        ]
      });
    } else if (filter === 'past') {
      // For past events, ensure date exists and is less than now
      queryConditions.push({ 
        $and: [
          { date: { $exists: true } },
          { date: { $ne: null } },
          { date: { $lt: now } }
        ]
      });
    } else if (filter === 'drafts') {
      queryConditions.push({ status: 'draft' });
    }
    // For 'all' filter, we only have clubIdCondition in the array
    
    // Add search condition if provided
    if (search) {
      queryConditions.push({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      });
    }
    
    // Build final query - always use $and for consistency
    // MongoDB handles single-item $and arrays correctly
    const query = { $and: queryConditions };

    console.log('[Manager Events] Query:', JSON.stringify(query, null, 2));

    // Get events
    const events = await eventsCollection.find(query).sort({ date: -1 }).toArray();
    
    console.log(`[Manager Events] Found ${events.length} events matching query`);
    
    // Debug: Check all events to see their clubId format
    if (events.length === 0) {
      const allEvents = await eventsCollection.find({}).limit(5).toArray();
      console.log('[Manager Events] Sample events in database:', allEvents.map(e => ({
        id: e._id.toString(),
        name: e.name,
        clubId: e.clubId,
        clubIdType: typeof e.clubId
      })));
    }

    // Get stats - handle both string and ObjectId formats
    // Use the same clubIdCondition structure for consistency
    const statsQuery = clubIdCondition;
    const totalEvents = await eventsCollection.countDocuments(statsQuery);
    
    const upcomingEventsQuery = {
      $and: [
        clubIdCondition,
        { date: { $gte: now } },
        {
          $or: [
            { status: { $ne: 'cancelled' } },
            { status: { $exists: false } },
            { status: null }
          ]
        }
      ]
    };
    const upcomingEvents = await eventsCollection.countDocuments(upcomingEventsQuery);

    // Calculate revenue from events (simplified - sum prices of all events)
    // For more accurate revenue, we would need to calculate from actual registrations
    // Use the same clubIdCondition for consistency
    const allEvents = await eventsCollection.find(clubIdCondition).toArray();
    let revenue = 0;
    for (const event of allEvents) {
      const regCount = await registrationsCollection.countDocuments({
        eventId: event._id.toString(),
        status: 'registered',
        paymentStatus: 'paid'
      });
      revenue += (event.price || 0) * regCount;
    }
    revenue = revenue / 100; // Convert cents to taka

    // Format events with registration counts
    const eventsWithDetails = await Promise.all(events.map(async (event) => {
      const registrations = await registrationsCollection.countDocuments({
        eventId: event._id.toString(),
        status: 'registered'
      });

      const eventDate = event.date ? new Date(event.date) : new Date();
      const isPast = eventDate < now;

      return {
        id: event._id.toString(),
        name: event.name,
        description: event.description || '',
        image: event.image || null,
        date: eventDate.toISOString(),
        dateFormatted: formatDateWithDay(eventDate),
        time: event.time || '12:00 PM',
        location: event.location || '',
        price: event.price || 0,
        maxAttendees: event.maxAttendees || 0,
        currentAttendees: registrations,
        status: isPast ? 'past' : (event.status || 'upcoming'),
        clubId: event.clubId,
        createdAt: event.createdAt
      };
    }));

    res.json({
      events: eventsWithDetails,
      stats: {
        total: totalEvents,
        upcoming: upcomingEvents,
        revenue: revenue // Already converted to taka on line 473
      }
    });
  } catch (error) {
    console.error('Get manager events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create new event
router.post('/events', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const managerEmail = req.user.email;
    const { name, description, date, time, location, price, maxAttendees, clubId, image } = req.body;

    if (!name || !date || !clubId) {
      return res.status(400).json({ error: 'Name, date, and clubId are required' });
    }

    // Verify club ownership
    const club = await clubsCollection.findOne({ 
      _id: new ObjectId(clubId),
      managerEmail 
    });

    if (!club) {
      return res.status(404).json({ error: 'Club not found or access denied' });
    }

    const event = {
      name,
      description: description || '',
      date: new Date(date),
      time: time || '12:00 PM',
      location: location || '',
      price: price ? Math.round(price * 100) : 0, // Store as cents
      maxAttendees: maxAttendees || 0,
      clubId,
      clubName: club.name,
      image: image || null,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await eventsCollection.insertOne(event);

    res.status(201).json({
      id: result.insertedId.toString(),
      message: 'Event created successfully'
    });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update event (verify ownership via club)
router.put('/events/:id', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const { id } = req.params;
    const managerEmail = req.user.email;
    const updateData = req.body;

    // Get event and verify club ownership
    const event = await eventsCollection.findOne({ _id: new ObjectId(id) });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const club = await clubsCollection.findOne({ 
      _id: new ObjectId(event.clubId),
      managerEmail 
    });

    if (!club) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Convert price to cents if provided
    if (updateData.price !== undefined) {
      updateData.price = Math.round(updateData.price * 100);
    }

    // Convert date to Date object if provided
    if (updateData.date) {
      updateData.date = new Date(updateData.date);
    }

    const result = await eventsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...updateData, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ message: 'Event updated successfully' });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete event (verify ownership)
router.delete('/events/:id', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const { id } = req.params;
    const managerEmail = req.user.email;

    // Get event and verify club ownership
    const event = await eventsCollection.findOne({ _id: new ObjectId(id) });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const club = await clubsCollection.findOne({ 
      _id: new ObjectId(event.clubId),
      managerEmail 
    });

    if (!club) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await eventsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== EVENT REGISTRATIONS ====================

// Get event registrations with pagination
router.get('/events/:eventId/registrations', verifyToken, authorize('clubManager'), async (req, res) => {
  try {
    const { eventId } = req.params;
    const managerEmail = req.user.email;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const skip = (page - 1) * limit;

    // Get event and verify club ownership
    const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const club = await clubsCollection.findOne({ 
      _id: new ObjectId(event.clubId),
      managerEmail 
    });

    if (!club) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Build query
    const query = { eventId };
    if (status && status !== 'all') {
      query.status = status.toLowerCase();
    }

    // Get registrations
    const registrations = await registrationsCollection
      .find(query)
      .sort({ registrationDate: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get user details for each registration
    const registrationsWithDetails = await Promise.all(registrations.map(async (registration) => {
      const user = await usersCollection.findOne({ _id: new ObjectId(registration.userId) });
      
      if (!user) return null;

      // Apply search filter if provided
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch = 
          user.name?.toLowerCase().includes(searchLower) ||
          user.email?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return null;
      }

      return {
        id: registration._id.toString(),
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone || '--',
        photoURL: user.photoURL || null,
        status: registration.status || 'registered',
        registrationDate: formatDate(registration.registrationDate || registration.createdAt),
        paymentStatus: registration.paymentStatus || 'pending',
        memberId: `#${user._id.toString().slice(-4)}`
      };
    }));

    // Filter out null results from search
    const filteredRegistrations = registrationsWithDetails.filter(r => r !== null);

    // Get stats
    const totalRegistered = await registrationsCollection.countDocuments({ 
      eventId,
      status: 'registered'
    });
    
    const cancelledCount = await registrationsCollection.countDocuments({ 
      eventId,
      status: 'cancelled'
    });

    // Count new registrations today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const newToday = await registrationsCollection.countDocuments({
      eventId,
      registrationDate: { $gte: todayStart },
      status: 'registered'
    });

    // Get total count for pagination
    const total = await registrationsCollection.countDocuments(query);

    res.json({
      registrations: filteredRegistrations,
      stats: {
        totalRegistered,
        newToday,
        cancelled: cancelledCount
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get event registrations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { initManagerRoutes, router };

