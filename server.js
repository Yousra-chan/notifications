// ============================================================================
// FCM NOTIFICATION SERVER - NO CLOUD FUNCTIONS NEEDED!
// Deploy this to Render.com (FREE tier)
// ============================================================================

const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// FIREBASE ADMIN INITIALIZATION
// ============================================================================

// Initialize Firebase Admin with service account
// You'll add your service account JSON as environment variable
let serviceAccount;
try {
  // First try to get from environment variable (for Render.com)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Fallback to local file for testing
    serviceAccount = require('./serviceAccountKey.json');
  }
} catch (error) {
  console.error('❌ Error loading service account:', error);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
console.log('✅ Firebase Admin initialized');

// ============================================================================
// FCM NOTIFICATION SENDER
// ============================================================================

async function sendFCMNotification(token, title, body, data = {}) {
  try {
    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      token: token,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'high_importance_channel',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log('✅ Notification sent successfully:', response);
    return { success: true, response };
  } catch (error) {
    console.error('❌ Error sending notification:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// FIRESTORE LISTENER - WATCHES FOR NEW MESSAGES
// ============================================================================

function startFirestoreListener() {
  console.log('👂 Starting Firestore listener for new messages...');

  // Listen to all chats collection
  db.collection('chats').onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const chatId = change.doc.id;
          const chatData = change.doc.data();

          // Check if there's a new message (by comparing lastMessageTime)
          if (chatData.lastMessage && chatData.lastMessageSender) {
            await handleNewMessage(chatId, chatData);
          }
        }
      });
    },
    (error) => {
      console.error('❌ Error in Firestore listener:', error);
      // Restart listener after 5 seconds
      setTimeout(startFirestoreListener, 5000);
    }
  );

  console.log('✅ Firestore listener started successfully');
}

// ============================================================================
// HANDLE NEW MESSAGE - SEND NOTIFICATION TO RECEIVER
// ============================================================================

async function handleNewMessage(chatId, chatData) {
  try {
    const senderId = chatData.lastMessageSender;
    const messageText = chatData.lastMessage;
    const participants = chatData.participants || [];

    // Find the receiver (the participant who is NOT the sender)
    const receiverId = participants.find((id) => id !== senderId);

    if (!receiverId) {
      console.log('⚠️ No receiver found for chat:', chatId);
      return;
    }

    // Get receiver's FCM token from Firestore
    const receiverDoc = await db.collection('users').doc(receiverId).get();

    if (!receiverDoc.exists) {
      console.log('⚠️ Receiver user not found:', receiverId);
      return;
    }

    const receiverData = receiverDoc.data();
    const fcmToken = receiverData.fcmToken;

    if (!fcmToken) {
      console.log('⚠️ No FCM token for receiver:', receiverId);
      return;
    }

    // Get sender name
    const senderName = chatData.participantNames?.[senderId] || 'Someone';

    // Send notification
    console.log(`📤 Sending notification to ${receiverId} from ${senderName}`);

    const result = await sendFCMNotification(
      fcmToken,
      `New message from ${senderName}`,
      messageText.length > 100 ? messageText.substring(0, 100) + '...' : messageText,
      {
        type: 'message',
        chatId: chatId,
        senderId: senderId,
        senderName: senderName,
      }
    );

    if (result.success) {
      console.log('✅ Notification sent successfully to:', receiverId);
    } else {
      console.log('❌ Failed to send notification:', result.error);
    }
  } catch (error) {
    console.error('❌ Error handling new message:', error);
  }
}

// ============================================================================
// HTTP ENDPOINTS (for testing and manual sending)
// ============================================================================

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: 'FCM Notification Server is running!',
    timestamp: new Date().toISOString(),
  });
});

// Test endpoint to send notification manually
app.post('/send-notification', async (req, res) => {
  try {
    const { token, title, body, data } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'FCM token is required' });
    }

    const result = await sendFCMNotification(
      token,
      title || 'Test Notification',
      body || 'This is a test notification',
      data || {}
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to test notification to specific user
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
    const fcmToken = userData.fcmToken;

    if (!fcmToken) {
      return res.status(404).json({ error: 'User has no FCM token' });
    }

    const result = await sendFCMNotification(
      fcmToken,
      title || 'Test Notification',
      body || 'This is a test message',
      { type: 'test' }
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('🚀 Server started on port:', PORT);
  console.log('📡 Starting Firestore listener...');

  // Start listening to Firestore changes
  startFirestoreListener();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT signal received: closing HTTP server');
  process.exit(0);
});