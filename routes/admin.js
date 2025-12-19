const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { verifyToken, authorize } = require('../middleware/auth');

// MongoDB collections (will be initialized from index.js)
let usersCollection;
let clubsCollection;
let eventsCollection;
let transactionsCollection;

// Initialize collections
const initAdminRoutes = (client) => {
  const db = client.db('clubsphere');
  usersCollection = db.collection('users');
  clubsCollection = db.collection('clubs');
  eventsCollection = db.collection('events');
  transactionsCollection = db.collection('transactions');
  return router;
};

// Helper function to format date
const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
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

// ==================== USERS MANAGEMENT ====================

// Get all users with pagination, search, and filters
router.get('/users', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const role = req.query.role || '';
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role && role !== 'all') {
      query.role = role;
    }

    // Get users
    const users = await usersCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count
    const total = await usersCollection.countDocuments(query);

    // Format response
    const formattedUsers = users.map(user => ({
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      photoURL: user.photoURL || null,
      createdAt: formatDate(user.createdAt),
      joinedDate: formatDate(user.createdAt)
    }));

    res.json({
      users: formattedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user role
router.put('/users/:id', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ error: 'Role is required' });
    }

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User updated successfully' });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user
router.delete('/users/:id', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== CLUBS MANAGEMENT ====================

// Get clubs stats
router.get('/clubs/stats', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const pending = await clubsCollection.countDocuments({ status: 'pending' });
    const active = await clubsCollection.countDocuments({ status: 'active' });
    const newThisMonth = await clubsCollection.countDocuments({
      createdAt: { $gte: startOfMonth }
    });
    const newLastMonth = await clubsCollection.countDocuments({
      createdAt: { $gte: lastMonth, $lte: endOfLastMonth }
    });

    const newGrowth = newLastMonth > 0 
      ? Math.round(((newThisMonth - newLastMonth) / newLastMonth) * 100)
      : 0;

    res.json({
      pending,
      active,
      newThisMonth,
      activeGrowth: 12, // Placeholder - can be calculated from historical data
      newGrowth
    });
  } catch (error) {
    console.error('Get clubs stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all clubs with pagination, search, and filters
router.get('/clubs', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { managerEmail: { $regex: search, $options: 'i' } }
      ];
    }
    if (status && status !== 'all') {
      query.status = status;
    }

    // Get clubs
    const clubs = await clubsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count
    const total = await clubsCollection.countDocuments(query);

    // Format response
    const formattedClubs = clubs.map(club => ({
      id: club._id.toString(),
      name: club.name,
      managerEmail: club.managerEmail || '',
      image: club.image || null,
      memberCount: club.memberCount || 0,
      eventCount: club.eventCount || 0,
      fee: club.fee || 'Free',
      status: club.status || 'pending',
      createdAt: formatDate(club.createdAt),
      joinedDate: formatDate(club.createdAt)
    }));

    res.json({
      clubs: formattedClubs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get clubs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approve club
router.put('/clubs/:id/approve', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await clubsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'active', updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Club not found' });
    }

    res.json({ message: 'Club approved successfully' });
  } catch (error) {
    console.error('Approve club error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reject club
router.put('/clubs/:id/reject', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const result = await clubsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'rejected', updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Club not found' });
    }

    res.json({ message: 'Club rejected successfully' });
  } catch (error) {
    console.error('Reject club error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== EVENTS MANAGEMENT ====================

// Get events stats
router.get('/events/stats', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const now = new Date();
    const total = await eventsCollection.countDocuments({});
    const upcoming = await eventsCollection.countDocuments({
      date: { $gte: now }
    });

    // Calculate revenue from transactions
    const revenueResult = await transactionsCollection.aggregate([
      {
        $match: {
          status: 'paid',
          type: { $in: ['Event Ticket', 'event'] }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]).toArray();

    const revenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    res.json({
      total,
      upcoming,
      revenue: revenue / 100 // Convert cents to dollars if stored as cents
    });
  } catch (error) {
    console.error('Get events stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all events with pagination, search, and filters
router.get('/events', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const type = req.query.type || '';
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { clubName: { $regex: search, $options: 'i' } }
      ];
    }
    if (status && status !== 'any') {
      query.status = status;
    }
    if (type && type !== 'all') {
      query.type = type;
    }

    // Get events
    const events = await eventsCollection
      .find(query)
      .sort({ date: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count
    const total = await eventsCollection.countDocuments(query);

    // Format response
    const formattedEvents = events.map(event => {
      const eventDate = event.date ? new Date(event.date) : new Date();
      const timeStr = event.time || '12:00 PM';
      const dateStr = formatDate(eventDate);
      
      return {
        id: event._id.toString(),
        name: event.name,
        clubName: event.clubName || '',
        clubImage: event.clubImage || null,
        image: event.image || null,
        date: dateStr,
        time: timeStr,
        location: event.location || '',
        type: event.type || 'Free',
        status: event.status || 'active',
        eventId: `#EV-${event._id.toString().slice(-4)}`
      };
    });

    res.json({
      events: formattedEvents,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update event
router.put('/events/:id', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

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

// Delete event
router.delete('/events/:id', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

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

// ==================== FINANCES MANAGEMENT ====================

// Get finances stats
router.get('/finances/stats', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Total revenue (all paid transactions)
    const revenueResult = await transactionsCollection.aggregate([
      {
        $match: { status: 'paid' }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]).toArray();

    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    // Pending payments
    const pendingCount = await transactionsCollection.countDocuments({ status: 'pending' });

    // Transactions in last 30 days
    const transactionsCount = await transactionsCollection.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });

    res.json({
      totalRevenue: totalRevenue / 100, // Convert cents to dollars if stored as cents
      pendingPayments: pendingCount,
      transactions30d: transactionsCount
    });
  } catch (error) {
    console.error('Get finances stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all transactions with pagination, search, and filters
router.get('/finances', verifyToken, authorize('admin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const type = req.query.type || '';
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    if (search) {
      query.userEmail = { $regex: search, $options: 'i' };
    }
    if (status && status !== 'all') {
      query.status = status;
    }
    if (type && type !== 'all') {
      query.type = type;
    }

    // Get transactions
    const transactions = await transactionsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    // Get total count
    const total = await transactionsCollection.countDocuments(query);

    // Format response
    const formattedTransactions = transactions.map(transaction => {
      const amount = typeof transaction.amount === 'number' 
        ? (transaction.amount / 100).toFixed(2) 
        : parseFloat(transaction.amount || 0).toFixed(2);

      return {
        id: transaction._id.toString(),
        userEmail: transaction.userEmail || '',
        userName: transaction.userName || '',
        userPhotoURL: transaction.userPhotoURL || null,
        userInitials: getUserInitials(transaction.userName),
        amount: `$${amount}`,
        type: transaction.type || '',
        clubName: transaction.clubName || '',
        eventName: transaction.eventName || '',
        associatedItem: transaction.clubName || transaction.eventName || '',
        date: formatDate(transaction.createdAt),
        status: transaction.status || 'pending'
      };
    });

    res.json({
      transactions: formattedTransactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get finances error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { initAdminRoutes, router };

