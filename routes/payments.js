const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { verifyToken } = require('../middleware/auth');

// Initialize Stripe - will be set when env var is available
let stripe = null;

const initializeStripe = () => {
  if (process.env.STRIPE_SECRET_KEY) {
    if (!stripe) {
      stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      console.log('Stripe initialized successfully');
    }
    return stripe;
  } else {
    console.warn('WARNING: STRIPE_SECRET_KEY not found in environment variables');
    return null;
  }
};

// Initialize on module load
initializeStripe();

// MongoDB collections (will be initialized from index.js)
let eventsCollection;
let registrationsCollection;
let usersCollection;
let clubsCollection;
let membershipsCollection;

// Initialize collections
const initPaymentRoutes = (client) => {
  const db = client.db('clubsphere');
  eventsCollection = db.collection('events');
  registrationsCollection = db.collection('registrations');
  usersCollection = db.collection('users');
  clubsCollection = db.collection('clubs');
  membershipsCollection = db.collection('memberships');
  return router;
};

// Calculate service fee (10% of event fee, minimum ৳1.50)
const calculateServiceFee = (eventFee) => {
  const fee = eventFee * 0.1;
  return Math.max(fee, 1.50);
};

// Create payment intent
router.post('/create-intent', verifyToken, async (req, res) => {
  try {
    // Check if collections are initialized
    if (!eventsCollection || !registrationsCollection) {
      console.error('Collections not initialized');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Check if Stripe is configured
    if (!stripe) {
      // Try to initialize if not already done
      initializeStripe();
      if (!stripe || !process.env.STRIPE_SECRET_KEY) {
        console.error('STRIPE_SECRET_KEY not configured');
        return res.status(500).json({ error: 'Payment service not configured. Please set STRIPE_SECRET_KEY in environment variables.' });
      }
    }

    const { eventId } = req.body;
    const userId = req.user.userId;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    // Get event details
    let event;
    if (ObjectId.isValid(eventId)) {
      event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
    } else {
      event = await eventsCollection.findOne({ _id: eventId });
    }

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if event is active
    if (event.status === 'cancelled') {
      return res.status(400).json({ error: 'Event is cancelled' });
    }

    // Check if user already registered
    const existingRegistration = await registrationsCollection.findOne({
      userId,
      eventId: eventId.toString(),
      status: 'registered'
    });

    if (existingRegistration) {
      return res.status(400).json({ error: 'You are already registered for this event' });
    }

    // Check event capacity
    if (event.maxAttendees) {
      const currentAttendees = await registrationsCollection.countDocuments({
        eventId: eventId.toString(),
        status: 'registered'
      });

      if (currentAttendees >= event.maxAttendees) {
        return res.status(400).json({ error: 'Event is full' });
      }
    }

    // Calculate fees
    let eventFee = 0;
    if (event.fee !== undefined) {
      eventFee = event.fee;
    } else if (event.price !== undefined) {
      eventFee = event.price / 100; // Convert from cents
    } else if (event.type === 'Paid' && event.amount) {
      eventFee = event.amount;
    }

    if (eventFee <= 0) {
      return res.status(400).json({ error: 'Event is free, use direct registration' });
    }

    const serviceFee = calculateServiceFee(eventFee);
    const totalAmount = eventFee + serviceFee;

    // Convert to smallest currency unit (BDT uses poisha, but Stripe uses smallest unit)
    // For BDT, 1 BDT = 100 poisha, but Stripe expects amount in smallest unit
    // Since BDT doesn't have decimal places in practice, we'll use the amount directly
    // Note: Stripe BDT support may vary, using USD for now with conversion
    // For test mode, we'll use USD cents
    const amountInCents = Math.round(totalAmount * 100); // Convert to cents

    // Create payment intent with Stripe
    // Note: Stripe test mode with BDT may not work, so we'll use USD for testing
    // In production, you may need to handle BDT differently
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd', // Using USD for test mode, can be changed to 'bdt' in production
      metadata: {
        eventId: eventId.toString(),
        userId: userId,
        eventFee: eventFee.toString(),
        serviceFee: serviceFee.toString(),
        totalAmount: totalAmount.toString()
      },
      description: `Event Registration: ${event.name || 'Event'}`
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalAmount,
      eventFee,
      serviceFee
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent', message: error.message });
  }
});

// Confirm payment and create registration
router.post('/confirm', verifyToken, async (req, res) => {
  try {
    const { paymentIntentId, eventId } = req.body;
    const userId = req.user.userId;

    if (!paymentIntentId || !eventId) {
      return res.status(400).json({ error: 'Payment intent ID and event ID are required' });
    }

    // Verify payment intent with Stripe
    if (!stripe) {
      initializeStripe();
      if (!stripe) {
        return res.status(500).json({ error: 'Payment service not available' });
      }
    }
    
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Verify metadata matches
    if (paymentIntent.metadata.eventId !== eventId.toString() || 
        paymentIntent.metadata.userId !== userId) {
      return res.status(400).json({ error: 'Payment intent mismatch' });
    }

    // Check if registration already exists
    const existingRegistration = await registrationsCollection.findOne({
      userId,
      eventId: eventId.toString(),
      status: 'registered'
    });

    if (existingRegistration) {
      return res.status(400).json({ 
        error: 'Registration already exists',
        registrationId: existingRegistration._id.toString()
      });
    }

    // Get event details
    let event;
    if (ObjectId.isValid(eventId)) {
      event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
    } else {
      event = await eventsCollection.findOne({ _id: eventId });
    }

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Create registration
    const registration = {
      userId,
      eventId: eventId.toString(),
      status: 'registered',
      paymentStatus: 'paid',
      paymentIntentId,
      amount: parseFloat(paymentIntent.metadata.totalAmount),
      eventFee: parseFloat(paymentIntent.metadata.eventFee),
      serviceFee: parseFloat(paymentIntent.metadata.serviceFee),
      currency: 'bdt',
      registrationDate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await registrationsCollection.insertOne(registration);

    res.json({
      success: true,
      registrationId: result.insertedId.toString(),
      message: 'Registration successful'
    });
  } catch (error) {
    console.error('Confirm payment error:', error);
    res.status(500).json({ error: 'Failed to confirm payment', message: error.message });
  }
});

// Get payment intent status
router.get('/intent/:intentId', verifyToken, async (req, res) => {
  try {
    const { intentId } = req.params;

    if (!stripe) {
      initializeStripe();
      if (!stripe) {
        return res.status(500).json({ error: 'Payment service not available' });
      }
    }
    
    const paymentIntent = await stripe.paymentIntents.retrieve(intentId);

    res.json({
      status: paymentIntent.status,
      amount: paymentIntent.amount / 100, // Convert from cents
      currency: paymentIntent.currency,
      metadata: paymentIntent.metadata
    });
  } catch (error) {
    console.error('Get payment intent error:', error);
    res.status(500).json({ error: 'Failed to retrieve payment intent', message: error.message });
  }
});

// Register for free event (direct registration without payment)
router.post('/register-free', verifyToken, async (req, res) => {
  try {
    const { eventId } = req.body;
    const userId = req.user.userId;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    // Get event details
    let event;
    if (ObjectId.isValid(eventId)) {
      event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });
    } else {
      event = await eventsCollection.findOne({ _id: eventId });
    }

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if event is active
    if (event.status === 'cancelled') {
      return res.status(400).json({ error: 'Event is cancelled' });
    }

    // Check if event is free
    let eventFee = 0;
    if (event.fee !== undefined) {
      eventFee = event.fee;
    } else if (event.price !== undefined) {
      eventFee = event.price / 100;
    } else if (event.type === 'Paid' && event.amount) {
      eventFee = event.amount;
    }

    if (eventFee > 0) {
      return res.status(400).json({ error: 'Event is not free, use payment flow' });
    }

    // Check if user already registered
    const existingRegistration = await registrationsCollection.findOne({
      userId,
      eventId: eventId.toString(),
      status: 'registered'
    });

    if (existingRegistration) {
      return res.status(400).json({ error: 'You are already registered for this event' });
    }

    // Check event capacity
    if (event.maxAttendees) {
      const currentAttendees = await registrationsCollection.countDocuments({
        eventId: eventId.toString(),
        status: 'registered'
      });

      if (currentAttendees >= event.maxAttendees) {
        return res.status(400).json({ error: 'Event is full' });
      }
    }

    // Create registration
    const registration = {
      userId,
      eventId: eventId.toString(),
      status: 'registered',
      paymentStatus: 'free',
      amount: 0,
      eventFee: 0,
      serviceFee: 0,
      currency: 'bdt',
      registrationDate: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await registrationsCollection.insertOne(registration);

    res.json({
      success: true,
      registrationId: result.insertedId.toString(),
      message: 'Registration successful'
    });
  } catch (error) {
    console.error('Free registration error:', error);
    res.status(500).json({ error: 'Failed to register', message: error.message });
  }
});

// ==================== CLUB MEMBERSHIP PAYMENT ====================

// Create payment intent for club membership
router.post('/club/create-intent', verifyToken, async (req, res) => {
  try {
    // Check if collections are initialized
    if (!clubsCollection || !membershipsCollection) {
      console.error('Collections not initialized');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Check if Stripe is configured
    if (!stripe) {
      // Try to initialize if not already done
      initializeStripe();
      if (!stripe || !process.env.STRIPE_SECRET_KEY) {
        console.error('STRIPE_SECRET_KEY not configured');
        console.error('Current env vars:', Object.keys(process.env).filter(k => k.includes('STRIPE')));
        return res.status(500).json({ error: 'Payment service not configured. Please set STRIPE_SECRET_KEY in environment variables.' });
      }
    }

    const { clubId } = req.body;
    const userId = req.user.userId;

    if (!clubId) {
      return res.status(400).json({ error: 'Club ID is required' });
    }

    // Get club details
    let club;
    if (ObjectId.isValid(clubId)) {
      club = await clubsCollection.findOne({ _id: new ObjectId(clubId) });
    } else {
      club = await clubsCollection.findOne({ _id: clubId });
    }

    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    // Check if club is active
    if (club.status && club.status !== 'active') {
      return res.status(400).json({ error: 'Club is not available' });
    }

    // Check if user already has membership
    const existingMembership = await membershipsCollection.findOne({
      userId,
      clubId: clubId.toString(),
      status: { $in: ['active', 'pending'] }
    });

    if (existingMembership) {
      return res.status(400).json({ error: 'You are already a member of this club' });
    }

    // Get membership fee
    const membershipFee = club.fee || 0;

    if (membershipFee <= 0) {
      return res.status(400).json({ error: 'Club is free, use direct registration' });
    }

    const serviceFee = calculateServiceFee(membershipFee);
    const totalAmount = membershipFee + serviceFee;

    // Convert to cents for Stripe
    const amountInCents = Math.round(totalAmount * 100);

    // Create payment intent with Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd', // Using USD for test mode
      metadata: {
        clubId: clubId.toString(),
        userId: userId,
        membershipFee: membershipFee.toString(),
        serviceFee: serviceFee.toString(),
        totalAmount: totalAmount.toString(),
        type: 'club_membership'
      },
      description: `Club Membership: ${club.name || 'Club'}`
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalAmount,
      membershipFee,
      serviceFee
    });
  } catch (error) {
    console.error('Create club payment intent error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to create payment intent', 
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Confirm club membership payment and create membership
router.post('/club/confirm', verifyToken, async (req, res) => {
  try {
    // Check if collections are initialized
    if (!clubsCollection || !membershipsCollection) {
      console.error('Collections not initialized');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    // Check if Stripe is configured
    if (!stripe || !process.env.STRIPE_SECRET_KEY) {
      console.error('STRIPE_SECRET_KEY not configured');
      return res.status(500).json({ error: 'Payment service not configured' });
    }

    const { paymentIntentId, clubId } = req.body;
    const userId = req.user.userId;

    if (!paymentIntentId || !clubId) {
      return res.status(400).json({ error: 'Payment intent ID and club ID are required' });
    }

    // Verify payment intent with Stripe
    if (!stripe) {
      initializeStripe();
      if (!stripe) {
        return res.status(500).json({ error: 'Payment service not available' });
      }
    }
    
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Verify metadata matches
    if (paymentIntent.metadata.clubId !== clubId.toString() || 
        paymentIntent.metadata.userId !== userId ||
        paymentIntent.metadata.type !== 'club_membership') {
      return res.status(400).json({ error: 'Payment intent mismatch' });
    }

    // Check if membership already exists
    const existingMembership = await membershipsCollection.findOne({
      userId,
      clubId: clubId.toString(),
      status: { $in: ['active', 'pending'] }
    });

    if (existingMembership) {
      return res.status(400).json({ 
        error: 'Membership already exists',
        membershipId: existingMembership._id.toString()
      });
    }

    // Get club details
    let club;
    if (ObjectId.isValid(clubId)) {
      club = await clubsCollection.findOne({ _id: new ObjectId(clubId) });
    } else {
      club = await clubsCollection.findOne({ _id: clubId });
    }

    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    // Calculate expiry date (1 month from now)
    const joinDate = new Date();
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 1);

    // Create membership
    const membership = {
      userId,
      clubId: clubId.toString(),
      status: 'active',
      paymentStatus: 'paid',
      paymentIntentId,
      amount: parseFloat(paymentIntent.metadata.totalAmount),
      membershipFee: parseFloat(paymentIntent.metadata.membershipFee),
      serviceFee: parseFloat(paymentIntent.metadata.serviceFee),
      currency: 'bdt',
      joinDate: joinDate,
      expiryDate: expiryDate,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await membershipsCollection.insertOne(membership);

    // Update club member count
    await clubsCollection.updateOne(
      { _id: ObjectId.isValid(clubId) ? new ObjectId(clubId) : clubId },
      { $inc: { memberCount: 1 } }
    );

    res.json({
      success: true,
      membershipId: result.insertedId.toString(),
      message: 'Membership successful'
    });
  } catch (error) {
    console.error('Confirm club payment error:', error);
    res.status(500).json({ error: 'Failed to confirm payment', message: error.message });
  }
});

// Register for free club (direct registration without payment)
router.post('/club/register-free', verifyToken, async (req, res) => {
  try {
    const { clubId } = req.body;
    const userId = req.user.userId;

    if (!clubId) {
      return res.status(400).json({ error: 'Club ID is required' });
    }

    // Get club details
    let club;
    if (ObjectId.isValid(clubId)) {
      club = await clubsCollection.findOne({ _id: new ObjectId(clubId) });
    } else {
      club = await clubsCollection.findOne({ _id: clubId });
    }

    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    // Check if club is active
    if (club.status && club.status !== 'active') {
      return res.status(400).json({ error: 'Club is not available' });
    }

    // Check if club is free
    const membershipFee = club.fee || 0;

    if (membershipFee > 0) {
      return res.status(400).json({ error: 'Club is not free, use payment flow' });
    }

    // Check if user already has membership
    const existingMembership = await membershipsCollection.findOne({
      userId,
      clubId: clubId.toString(),
      status: { $in: ['active', 'pending'] }
    });

    if (existingMembership) {
      return res.status(400).json({ error: 'You are already a member of this club' });
    }

    // Calculate expiry date (1 month from now, or set to null for free clubs)
    const joinDate = new Date();
    const expiryDate = null; // Free clubs don't expire

    // Create membership
    const membership = {
      userId,
      clubId: clubId.toString(),
      status: 'active',
      paymentStatus: 'free',
      amount: 0,
      membershipFee: 0,
      serviceFee: 0,
      currency: 'bdt',
      joinDate: joinDate,
      expiryDate: expiryDate,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await membershipsCollection.insertOne(membership);

    // Update club member count
    await clubsCollection.updateOne(
      { _id: ObjectId.isValid(clubId) ? new ObjectId(clubId) : clubId },
      { $inc: { memberCount: 1 } }
    );

    res.json({
      success: true,
      membershipId: result.insertedId.toString(),
      message: 'Membership successful'
    });
  } catch (error) {
    console.error('Free club registration error:', error);
    res.status(500).json({ error: 'Failed to register', message: error.message });
  }
});

module.exports = { initPaymentRoutes };

