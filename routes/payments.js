const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { verifyToken } = require('../middleware/auth');

// MongoDB collections (will be initialized from index.js)
let eventsCollection;
let registrationsCollection;
let usersCollection;

// Initialize collections
const initPaymentRoutes = (client) => {
  const db = client.db('clubsphere');
  eventsCollection = db.collection('events');
  registrationsCollection = db.collection('registrations');
  usersCollection = db.collection('users');
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

module.exports = { initPaymentRoutes };

