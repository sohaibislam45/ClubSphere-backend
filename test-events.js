// Test script to debug upcoming events endpoint
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

async function testUpcomingEvents() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const db = client.db('clubsphere');
    const registrationsCollection = db.collection('registrations');
    const eventsCollection = db.collection('events');
    
    // Get a test user ID (you'll need to replace this with an actual user ID)
    const testUserId = process.env.TEST_USER_ID || 'your-user-id-here';
    
    console.log('\n=== Testing Upcoming Events ===');
    console.log('User ID:', testUserId);
    
    // Query for registered events
    const query = { 
      userId: testUserId,
      status: { $regex: /^registered$/i }
    };
    
    console.log('\nQuery:', JSON.stringify(query, null, 2));
    
    const registrations = await registrationsCollection.find(query).toArray();
    console.log('\nRegistrations found:', registrations.length);
    
    const now = new Date();
    console.log('Current date:', now.toISOString());
    
    for (const reg of registrations) {
      console.log('\n--- Registration ---');
      console.log('Registration ID:', reg._id.toString());
      console.log('Status:', reg.status);
      console.log('Event ID:', reg.eventId);
      
      const event = await eventsCollection.findOne({ _id: new ObjectId(reg.eventId) });
      if (event) {
        console.log('Event Name:', event.name);
        console.log('Event Date:', event.date);
        console.log('Event Status:', event.status);
        
        if (event.date) {
          const eventDate = event.date instanceof Date ? event.date : new Date(event.date);
          const eventYear = eventDate.getFullYear();
          const eventMonth = eventDate.getMonth();
          const eventDay = eventDate.getDate();
          const eventDateOnly = new Date(eventYear, eventMonth, eventDay, 0, 0, 0, 0);
          
          const nowYear = now.getFullYear();
          const nowMonth = now.getMonth();
          const nowDay = now.getDate();
          const nowDateOnly = new Date(nowYear, nowMonth, nowDay, 0, 0, 0, 0);
          
          const isPast = eventDateOnly.getTime() < nowDateOnly.getTime();
          const isTodayOrFuture = eventDateOnly.getTime() >= nowDateOnly.getTime();
          
          console.log('Event Date Only:', eventDateOnly.toISOString());
          console.log('Now Date Only:', nowDateOnly.toISOString());
          console.log('Is Past:', isPast);
          console.log('Is Today/Future:', isTodayOrFuture);
          console.log('Should show in upcoming:', !isPast && reg.status.toLowerCase() === 'registered');
        }
      } else {
        console.log('Event not found!');
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

testUpcomingEvents();



