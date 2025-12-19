const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const admin = require('firebase-admin');
const { verifyToken } = require('../middleware/auth');

// MongoDB connection (will be passed from index.js)
let usersCollection;

// Initialize collection
const initAuthRoutes = (client) => {
  const db = client.db('clubsphere');
  usersCollection = db.collection('users');
  return router;
};

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, role = 'member' } = req.body;

    // Validate input
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user object
    const user = {
      email,
      password: hashedPassword,
      name,
      role: role.toLowerCase(), // admin, clubManager, member
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert user into database
    const result = await usersCollection.insertOne(user);
    const userId = result.insertedId;

    // Generate JWT token
    const token = jwt.sign(
      { userId: userId.toString(), email, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    // Return user data (without password) and token
    res.status(201).json({
      token,
      user: {
        id: userId.toString(),
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email, role: user.role },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    // Return user data (without password) and token
    res.json({
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        photoURL: user.photoURL || null
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Google OAuth login/register
router.post('/google', async (req, res) => {
  try {
    const { idToken, email, name, photoURL } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Verify the Firebase ID token if Firebase Admin is configured
    let decodedToken = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
        // Use verified email from token
        if (decodedToken.email !== email) {
          return res.status(401).json({ error: 'Email mismatch' });
        }
      } catch (error) {
        console.error('Firebase token verification error:', error);
        return res.status(401).json({ error: 'Invalid ID token' });
      }
    } else {
      // If Firebase Admin is not configured, trust the frontend (less secure but works)
      // In production, you should always verify the token server-side
      console.log('Warning: Firebase Admin not configured. Accepting Google OAuth without server-side verification.');
    }

    // Check if user already exists
    let user = await usersCollection.findOne({ email });

    if (user) {
      // User exists, generate JWT token for login
      const token = jwt.sign(
        { userId: user._id.toString(), email: user.email, role: user.role },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );

      // Update user info if needed (e.g., photo URL changed)
      if (photoURL && user.photoURL !== photoURL) {
        await usersCollection.updateOne(
          { _id: user._id },
          { $set: { photoURL, updatedAt: new Date() } }
        );
      }

      return res.json({
        token,
        user: {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          role: user.role,
          photoURL: photoURL || user.photoURL
        }
      });
    } else {
      // New user, create account
      const newUser = {
        email,
        name: name || decodedToken.name || 'User',
        role: 'member',
        photoURL: photoURL || null,
        authProvider: 'google',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await usersCollection.insertOne(newUser);
      const userId = result.insertedId;

      // Generate JWT token
      const token = jwt.sign(
        { userId: userId.toString(), email, role: newUser.role },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '7d' }
      );

      return res.status(201).json({
        token,
        user: {
          id: userId.toString(),
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          photoURL: newUser.photoURL
        }
      });
    }
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (requires authentication)
router.get('/me', verifyToken, async (req, res) => {
  try {
    // req.user should be set by verifyToken middleware
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        photoURL: user.photoURL || null
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { initAuthRoutes, router };

