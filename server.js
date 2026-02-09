// ============================================================================
// SIMPLE FIXED FCM SERVER
// ============================================================================

const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// SIMPLE FIREBASE SETUP
// ============================================================================

console.log('🚀 Starting FCM Notification Server...');

// Method 1: Try environment variable first
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.log('📝 Loading Firebase credentials from environment variable...');
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase initialized from environment variable');
    console.log(`📁 Project: ${serviceAccount.project_id}`);
  } catch (envError) {
    console.error('❌ Error parsing environment variable:', envError.message);
    process.exit(1);
  }
} 
// Method 2: Try base64 encoded version
else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  console.log('📝 Loading Firebase credentials from Base64...');
  try {
    const jsonString = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString();
    const serviceAccount = JSON.parse(jsonString);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase initialized from Base64');
  } catch (base64Error) {
    console.error('❌ Error parsing Base64:', base64Error.message);
    process.exit(1);
  }
}
// Method 3: Local file (for development only)
else {
  console.log('📝 Loading Firebase credentials from local file...');
  try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase initialized from local file');
  } catch (fileError) {
    console.error('❌ Error loading local file:', fileError.message);
    console.error('💡 Set FIREBASE_SERVICE_ACCOUNT environment variable in Render');
    process.exit(1);
  }
}

const db = admin.firestore();
console.log('✅ Firestore connected');

// ============================================================================
// NOTIFICATION FUNCTIONS
// ============================================================================

async function sendNotification(token, title, body, data = {}) {
  try {
    const message = {
      notification: { title, body },
      data: { ...data, click_action: 'FLUTTER_NOTIFICATION_CLICK' },
      token: token,
      android: { priority: 'high' },
    };
    
    const response = await admin.messaging().send(message);
    console.log(`✅ Sent to ${token.substring(0, 20)}...`);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Send error:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'running', 
    service: 'FCM Notification Server',
    timestamp: new Date().toISOString(),
    endpoints: ['POST /send', 'POST /send-to-user', 'GET /health']
  });
});

// Simple send endpoint
app.post('/send', async (req, res) => {
  try {
    const { token, title, body } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }
    
    const result = await sendNotification(
      token,
      title || 'Notification',
      body || 'You have a new message'
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send to user by ID
app.post('/send-to-user', async (req, res) => {
  try {
    const { userId, title, body } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    // Get user's FCM token
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const token = userData.fcmToken;
    
    if (!token) {
      return res.status(404).json({ error: 'User has no FCM token' });
    }
    
    const result = await sendNotification(
      token,
      title || 'Hello!',
      body || 'You have a notification'
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Health check: https://your-app.onrender.com/health`);
  console.log(`📨 Send notifications: POST /send`);
});
