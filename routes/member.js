const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { verifyToken, authorize } = require('../middleware/auth');

// MongoDB collections (will be initialized from index.js)
let usersCollection;
let clubsCollection;
let eventsCollection;
let membershipsCollection;
let registrationsCollection;
let transactionsCollection;

// Initialize collections
const initMemberRoutes = (client) => {
  const db = client.db('clubsphere');
  usersCollection = db.collection('users');
  clubsCollection = db.collection('clubs');
  eventsCollection = db.collection('events');
  membershipsCollection = db.collection('memberships');
  registrationsCollection = db.collection('registrations');
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

// Helper function to format date with day name
const formatDateWithDay = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
};

// Helper function to format date for display (e.g., "Oct 24, 2023")
const formatDateDisplay = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

// Helper function to calculate membership status
const calculateMembershipStatus = (membership) => {
  if (!membership) return 'expired';
  
  const now = new Date();
  const expiryDate = membership.expiryDate ? new Date(membership.expiryDate) : null;
  const joinDate = membership.joinDate ? new Date(membership.joinDate) : null;
  
  if (membership.status === 'pending') return 'pending';
  if (membership.status === 'expired') return 'expired';
  
  if (expiryDate) {
    const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiry < 0) return 'expired';
    if (daysUntilExpiry <= 1) return 'renew_soon';
  }
  
  return membership.status || 'active';
};

// ==================== DISCOVER ====================

// Get clubs and events for discovery
router.get('/discover', verifyToken, authorize('member'), async (req, res) => {
  try {
    if (!clubsCollection || !eventsCollection || !membershipsCollection || !registrationsCollection) {
      console.error('Collections not initialized');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const userId = req.user.userId;
    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    const search = req.query.search || '';
    const category = req.query.category || '';
    const filter = req.query.filter || ''; // trending, near_me, today

    // Build query for clubs
    const clubQuery = {};
    if (search) {
      clubQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }
    if (category && category !== 'all') {
      clubQuery.category = { $regex: category, $options: 'i' };
    }

    // Get clubs (limit to top picks)
    const clubs = await clubsCollection
      .find(clubQuery)
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    // Get user's memberships to calculate match percentage
    // Try string format first, then ObjectId if needed
    let userMemberships = [];
    try {
      userMemberships = await membershipsCollection.find({ userId: userId }).toArray();
      // If no results, try with ObjectId
      if (userMemberships.length === 0) {
        try {
          userMemberships = await membershipsCollection.find({ userId: new ObjectId(userId) }).toArray();
        } catch (oidError) {
          // Ignore ObjectId conversion errors
        }
      }
    } catch (error) {
      console.error('Error fetching user memberships:', error);
      userMemberships = [];
    }
    const userClubIds = userMemberships.map(m => {
      const clubId = m.clubId;
      return clubId ? (typeof clubId === 'string' ? clubId : clubId.toString()) : null;
    }).filter(id => id !== null);

    // Format clubs with member counts and match percentage
    const clubsWithDetails = await Promise.all(clubs.map(async (club) => {
      const memberCount = await membershipsCollection.countDocuments({ 
        clubId: club._id.toString(), 
        status: 'active' 
      });

      // Calculate match percentage (simplified - based on category match)
      let matchPercentage = Math.floor(Math.random() * 30) + 70; // 70-100% for demo
      if (userClubIds.includes(club._id.toString())) {
        matchPercentage = 100;
      }

      return {
        id: club._id.toString(),
        name: club.name,
        description: club.description || '',
        image: club.image || null,
        category: club.category || 'Uncategorized',
        memberCount,
        location: club.location || 'Online',
        distance: filter === 'near_me' ? `${Math.floor(Math.random() * 10) + 1} miles away` : null,
        matchPercentage,
        isJoined: userClubIds.includes(club._id.toString())
      };
    }));

    // Build query for events
    const now = new Date();
    const eventQuery = {};
    
    if (filter === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      eventQuery.date = { $gte: todayStart, $lte: todayEnd };
    } else {
      // Get events happening this week
      const weekFromNow = new Date();
      weekFromNow.setDate(weekFromNow.getDate() + 7);
      eventQuery.date = { $gte: now, $lte: weekFromNow };
    }
    
    eventQuery.status = { $ne: 'cancelled' };

    if (search) {
      eventQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const events = await eventsCollection
      .find(eventQuery)
      .sort({ date: 1 })
      .limit(10)
      .toArray();

    // Format events with registration counts
    const eventsWithDetails = await Promise.all(events.map(async (event) => {
      let club = null;
      if (event.clubId) {
        try {
          const clubId = typeof event.clubId === 'string' ? new ObjectId(event.clubId) : event.clubId;
          club = await clubsCollection.findOne({ _id: clubId });
        } catch (error) {
          console.error('Error finding club for event:', error);
        }
      }
      
      const registrationCount = await registrationsCollection.countDocuments({
        eventId: event._id.toString(),
        status: 'registered'
      });

      const eventDate = event.date ? new Date(event.date) : new Date();
      const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][eventDate.getMonth()];
      const day = eventDate.getDate();

      return {
        id: event._id.toString(),
        name: event.name,
        description: event.description || '',
        image: event.image || null,
        date: eventDate.toISOString(),
        dateFormatted: formatDateWithDay(eventDate),
        month,
        day,
        time: event.time || '12:00 PM',
        location: event.location || '',
        clubName: club?.name || 'Unknown Club',
        clubId: event.clubId ? (typeof event.clubId === 'string' ? event.clubId : event.clubId.toString()) : null,
        registrationCount
      };
    }));

    // Get categories for explore section
    let categories = [];
    let categoryCounts = [];
    try {
      categories = await clubsCollection.distinct('category');
      categoryCounts = await Promise.all(categories.filter(cat => cat).map(async (cat) => {
        const count = await clubsCollection.countDocuments({ category: cat });
        return { name: cat, count };
      }));
    } catch (error) {
      console.error('Error getting categories:', error);
      categoryCounts = [];
    }

    res.json({
      topPicks: clubsWithDetails,
      events: eventsWithDetails,
      categories: categoryCounts
    });
  } catch (error) {
    console.error('Discover error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// ==================== MY CLUBS ====================

// Get user's club memberships
router.get('/clubs', verifyToken, authorize('member'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const search = req.query.search || '';
    const status = req.query.status || '';

    // Build query
    const query = { userId };
    if (status && status !== 'All') {
      if (status === 'Active') {
        query.status = 'active';
      } else if (status === 'Expired') {
        query.status = 'expired';
      } else if (status === 'Pending') {
        query.status = 'pending';
      }
    }

    // Get memberships
    const memberships = await membershipsCollection
      .find(query)
      .sort({ joinDate: -1 })
      .toArray();

    // Get club details for each membership
    const clubsWithDetails = await Promise.all(memberships.map(async (membership) => {
      const club = await clubsCollection.findOne({ _id: new ObjectId(membership.clubId) });
      if (!club) return null;

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch = 
          club.name?.toLowerCase().includes(searchLower) ||
          club.description?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return null;
      }

      const membershipStatus = calculateMembershipStatus(membership);
      const expiryDate = membership.expiryDate ? new Date(membership.expiryDate) : null;
      const now = new Date();

      let statusLabel = 'Active';
      let statusColor = 'primary';
      let validUntil = expiryDate ? formatDateDisplay(expiryDate) : 'N/A';

      if (membershipStatus === 'expired') {
        statusLabel = 'Expired';
        statusColor = 'gray';
      } else if (membershipStatus === 'renew_soon') {
        statusLabel = 'Renew Soon';
        statusColor = 'yellow';
        const daysUntil = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
        validUntil = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : formatDateDisplay(expiryDate);
      } else if (membershipStatus === 'pending') {
        statusLabel = 'Pending';
        statusColor = 'yellow';
        validUntil = 'Pending';
      }

      return {
        id: membership._id.toString(),
        clubId: club._id.toString(),
        name: club.name,
        description: club.description || '',
        image: club.image || null,
        location: club.location || 'Online',
        status: membershipStatus,
        statusLabel,
        statusColor,
        validUntil,
        joinDate: membership.joinDate ? formatDateDisplay(membership.joinDate) : formatDateDisplay(membership.createdAt),
        expiryDate: expiryDate ? expiryDate.toISOString() : null
      };
    }));

    // Filter out null results
    const filteredClubs = clubsWithDetails.filter(c => c !== null);

    res.json({ clubs: filteredClubs });
  } catch (error) {
    console.error('Get my clubs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== MY EVENTS ====================

// Get user's event registrations
router.get('/events', verifyToken, authorize('member'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const tab = req.query.tab || 'upcoming'; // upcoming, waitlist, past, cancelled
    const search = req.query.search || '';

    const now = new Date();

    // Build query based on tab
    const query = { userId };
    
    if (tab === 'upcoming') {
      query.status = 'registered';
    } else if (tab === 'waitlist') {
      query.status = 'waitlisted';
    } else if (tab === 'past') {
      query.status = 'registered';
    } else if (tab === 'cancelled') {
      query.status = 'cancelled';
    }

    // Get registrations
    const registrations = await registrationsCollection
      .find(query)
      .sort({ registrationDate: -1 })
      .toArray();

    // Get event details for each registration
    const eventsWithDetails = await Promise.all(registrations.map(async (registration) => {
      const event = await eventsCollection.findOne({ _id: new ObjectId(registration.eventId) });
      if (!event) return null;

      // Apply search filter
      if (search) {
        const searchLower = search.toLowerCase();
        const matchesSearch = 
          event.name?.toLowerCase().includes(searchLower) ||
          event.description?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return null;
      }

      const club = await clubsCollection.findOne({ _id: new ObjectId(event.clubId) });
      const eventDate = event.date ? new Date(event.date) : new Date();
      
      // Normalize dates to compare only date part (ignore time)
      const eventDateOnly = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
      const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const isPast = eventDateOnly < nowDateOnly;
      const isTodayOrFuture = eventDateOnly >= nowDateOnly;

      // Filter by date based on tab
      if (tab === 'upcoming' && isPast) return null;
      if (tab === 'past' && isTodayOrFuture) return null;

      let statusLabel = 'Confirmed';
      let statusColor = 'primary';
      if (registration.status === 'waitlisted') {
        statusLabel = 'Waitlisted';
        statusColor = 'yellow';
      } else if (registration.status === 'cancelled') {
        statusLabel = 'Cancelled';
        statusColor = 'red';
      } else if (registration.paymentStatus === 'pending') {
        statusLabel = 'Pending';
        statusColor = 'blue';
      }

      return {
        id: registration._id.toString(),
        eventId: event._id.toString(),
        name: event.name,
        description: event.description || '',
        image: event.image || null,
        date: eventDate.toISOString(),
        dateFormatted: formatDateDisplay(eventDate),
        time: event.time || '12:00 PM',
        location: event.location || '',
        clubName: club?.name || 'Unknown Club',
        clubId: event.clubId,
        status: registration.status,
        statusLabel,
        statusColor,
        paymentStatus: registration.paymentStatus || 'pending',
        registrationDate: registration.registrationDate ? formatDateDisplay(registration.registrationDate) : formatDateDisplay(registration.createdAt)
      };
    }));

    // Filter out null results
    const filteredEvents = eventsWithDetails.filter(e => e !== null);

    // Get counts for tabs - need to check event dates
    const allRegistrations = await registrationsCollection.find({ userId }).toArray();
    let upcomingCount = 0;
    let pastCount = 0;
    const waitlistCount = await registrationsCollection.countDocuments({
      userId,
      status: 'waitlisted'
    });
    const cancelledCount = await registrationsCollection.countDocuments({
      userId,
      status: 'cancelled'
    });

    // Count upcoming and past by checking event dates
    for (const reg of allRegistrations) {
      if (reg.status === 'registered') {
        const event = await eventsCollection.findOne({ _id: new ObjectId(reg.eventId) });
        if (event) {
          const eventDate = event.date ? new Date(event.date) : new Date();
          // Normalize dates to compare only date part (ignore time)
          const eventDateOnly = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
          const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          if (eventDateOnly >= nowDateOnly) {
            upcomingCount++;
          } else {
            pastCount++;
          }
        }
      }
    }

    res.json({
      events: filteredEvents,
      counts: {
        upcoming: upcomingCount,
        waitlist: waitlistCount,
        past: pastCount,
        cancelled: cancelledCount
      }
    });
  } catch (error) {
    console.error('Get my events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel event registration
router.delete('/events/:registrationId/cancel', verifyToken, authorize('member'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const registrationId = req.params.registrationId;

    if (!registrationsCollection) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Find the registration
    let registration;
    try {
      registration = await registrationsCollection.findOne({ 
        _id: new ObjectId(registrationId),
        userId: userId 
      });
    } catch (error) {
      return res.status(400).json({ error: 'Invalid registration ID' });
    }

    if (!registration) {
      return res.status(404).json({ error: 'Registration not found' });
    }

    // Check if already cancelled
    if (registration.status === 'cancelled') {
      return res.status(400).json({ error: 'Registration is already cancelled' });
    }

    // Check if event is in the past
    if (registration.eventId) {
      const event = await eventsCollection.findOne({ _id: new ObjectId(registration.eventId) });
      if (event && event.date) {
        const eventDate = new Date(event.date);
        if (eventDate < new Date()) {
          return res.status(400).json({ error: 'Cannot cancel registration for past events' });
        }
      }
    }

    // Update registration status to cancelled
    await registrationsCollection.updateOne(
      { _id: new ObjectId(registrationId) },
      { 
        $set: { 
          status: 'cancelled',
          cancelledAt: new Date(),
          updatedAt: new Date()
        } 
      }
    );

    res.json({ message: 'Registration cancelled successfully' });
  } catch (error) {
    console.error('Cancel registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== PAYMENT HISTORY ====================

// Get user's payment history
router.get('/payments', verifyToken, authorize('member'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const type = req.query.type || ''; // all, membership, event, donation
    const status = req.query.status || ''; // all, success, pending, failed
    const dateRange = req.query.dateRange || 'all'; // all, this_year, this_month

    // Build query
    const query = { userId };
    
    if (type && type !== 'All Types' && type !== 'all') {
      query.type = type.toLowerCase();
    }
    
    if (status && status !== 'All Status' && status !== 'all') {
      query.status = status.toLowerCase();
    }

    // Date range filter
    if (dateRange === 'this_year') {
      const yearStart = new Date();
      yearStart.setMonth(0, 1);
      yearStart.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: yearStart };
    } else if (dateRange === 'this_month') {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: monthStart };
    }

    // Get transactions
    const transactions = await transactionsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    // Format transactions
    const formattedTransactions = await Promise.all(transactions.map(async (transaction) => {
      let description = transaction.description || '';
      let icon = 'receipt_long';

      // Get related club or event name if available
      if (transaction.clubId) {
        const club = await clubsCollection.findOne({ _id: new ObjectId(transaction.clubId) });
        if (club) {
          description = `${description} - ${club.name}`;
        }
        icon = 'groups';
      } else if (transaction.eventId) {
        const event = await eventsCollection.findOne({ _id: new ObjectId(transaction.eventId) });
        if (event) {
          description = `${description} - ${event.name}`;
        }
        icon = 'event';
      }

      let statusLabel = 'Paid';
      let statusColor = 'primary';
      if (transaction.status === 'pending') {
        statusLabel = 'Pending';
        statusColor = 'yellow';
      } else if (transaction.status === 'failed') {
        statusLabel = 'Failed';
        statusColor = 'red';
      }

      return {
        id: transaction._id.toString(),
        date: formatDateDisplay(transaction.createdAt || transaction.date),
        description,
        type: transaction.type || 'membership',
        typeLabel: transaction.type === 'event' ? 'Event' : transaction.type === 'donation' ? 'Donation' : 'Membership',
        status: transaction.status || 'success',
        statusLabel,
        statusColor,
        amount: transaction.amount ? (transaction.amount / 100).toFixed(2) : '0.00', // Convert cents to taka
        icon,
        invoiceId: transaction.invoiceId || null
      };
    }));

    // Calculate stats
    const yearStart = new Date();
    yearStart.setMonth(0, 1);
    yearStart.setHours(0, 0, 0, 0);
    
    const yearTransactions = await transactionsCollection.find({
      userId,
      status: 'success',
      createdAt: { $gte: yearStart }
    }).toArray();
    
    const totalSpent = yearTransactions.reduce((sum, t) => sum + (t.amount || 0), 0) / 100;
    
    const lastPayment = await transactionsCollection
      .findOne({ userId, status: 'success' }, { sort: { createdAt: -1 } });
    
    const activeMemberships = await membershipsCollection.countDocuments({
      userId,
      status: 'active'
    });

    res.json({
      transactions: formattedTransactions,
      stats: {
        totalSpent: totalSpent.toFixed(2),
        lastPayment: lastPayment ? {
          amount: (lastPayment.amount / 100).toFixed(2),
          description: lastPayment.description || ''
        } : null,
        activeSubscriptions: activeMemberships
      }
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== SETTINGS ====================

// Get user settings
router.get('/settings', verifyToken, authorize('member'), async (req, res) => {
  try {
    if (!usersCollection) {
      console.error('Users collection not initialized');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const userId = req.user.userId;
    if (!userId) {
      return res.status(401).json({ error: 'User ID not found in token' });
    }

    let user;
    try {
      user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    } catch (oidError) {
      console.error('Error converting userId to ObjectId:', oidError);
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      profile: {
        name: user.name || '',
        email: user.email || '',
        photoURL: user.photoURL || null,
        bio: user.bio || '',
        location: user.location || '',
        username: user.username || (user.email ? user.email.split('@')[0] : '')
      },
      notifications: {
        emailDigests: user.notifications?.emailDigests !== false,
        eventReminders: user.notifications?.eventReminders !== false,
        newClubAlerts: user.notifications?.newClubAlerts !== false
      },
      security: {
        twoFactorEnabled: user.twoFactorEnabled || false
      },
      memberSince: user.createdAt ? formatDateDisplay(user.createdAt) : ''
    });
  } catch (error) {
    console.error('Get settings error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Update profile
router.put('/settings/profile', verifyToken, authorize('member'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { name, email, photoURL, bio, location, username } = req.body;

    const updateData = {
      updatedAt: new Date()
    };

    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (photoURL !== undefined) updateData.photoURL = photoURL;
    if (bio !== undefined) updateData.bio = bio;
    if (location !== undefined) updateData.location = location;
    if (username) updateData.username = username;

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update password
router.put('/settings/password', verifyToken, authorize('member'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    if (user.password) {
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update notifications
router.put('/settings/notifications', verifyToken, authorize('member'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { emailDigests, eventReminders, newClubAlerts } = req.body;

    const updateData = {
      'notifications.emailDigests': emailDigests !== undefined ? emailDigests : false,
      'notifications.eventReminders': eventReminders !== undefined ? eventReminders : false,
      'notifications.newClubAlerts': newClubAlerts !== undefined ? newClubAlerts : false,
      updatedAt: new Date()
    };

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'Notification preferences updated successfully' });
  } catch (error) {
    console.error('Update notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update two-factor authentication
router.put('/settings/security/2fa', verifyToken, authorize('member'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { enabled } = req.body;

    const result = await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { twoFactorEnabled: enabled === true, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'Two-factor authentication updated successfully' });
  } catch (error) {
    console.error('Update 2FA error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { initMemberRoutes, router };

