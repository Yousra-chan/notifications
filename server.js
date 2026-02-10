// ============================================================================
// COMPLETE FCM NOTIFICATION SERVER (FIXED + PING FOR KEEP-ALIVE)
// ============================================================================
// CHANGES:
// - Disabled Firestore auto-listener to prevent duplicate notifications
// - Clients now send notifications directly to /send-notification endpoint
// - Server remains stateless and only processes incoming notification requests
// - Added /ping endpoint for UptimeRobot to keep server awake for FREE
// ============================================================================

const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// ============================================================================
// FIREBASE ADMIN INITIALIZATION
// ============================================================================

let serviceAccount;
try {
  // Get from environment variable (Render)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('✅ Loaded Firebase credentials from environment');
  } 
  // Alternative: Base64 encoded
  else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const jsonString = Buffer.from(
      process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 
      'base64'
    ).toString();
    serviceAccount = JSON.parse(jsonString);
    console.log('✅ Loaded Firebase credentials from Base64');
  }
  // Local development
  else {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('✅ Loaded Firebase credentials from local file');
  }
} catch (error) {
  console.error('❌ ERROR loading Firebase credentials:', error.message);
  console.error('💡 Add FIREBASE_SERVICE_ACCOUNT to Render Environment');
  process.exit(1);
}

// Initialize Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  
  console.log('✅ Firebase Admin initialized');
  console.log(`📁 Project: ${serviceAccount.project_id}`);
} catch (initError) {
  console.error('❌ Firebase initialization error:', initError.message);
  process.exit(1);
}

const db = admin.firestore();
console.log('✅ Firestore connected');

// ============================================================================
// FCM NOTIFICATION FUNCTION
// ============================================================================

async function sendFCMNotification(token, title, body, data = {}) {
  try {
    const message = {
      notification: {
        title: title || 'Notification',
        body: body || 'You have a new message',
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
        }
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
    console.log('✅ FCM notification sent:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ FCM error:', error.message);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// HEALTH CHECK ENDPOINTS
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'FCM Notification Server',
    timestamp: new Date().toISOString(),
    version: '2.0 (Fixed - No Auto-Listener + Keep-Alive)',
    endpoints: [
      'POST /send',
      'POST /send-notification', 
      'POST /send-to-user',
      'GET /health',
      'GET /ping'
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    firestoreConnected: true,
    autoListenerEnabled: false
  });
});

// ✅ KEEP-ALIVE PING ENDPOINT (for UptimeRobot to keep server awake)
// UptimeRobot will ping this every 5 minutes to prevent Render from sleeping
app.get('/ping', (req, res) => {
  console.log('🔔 Ping received from UptimeRobot - Server staying awake!');
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    message: 'Server is awake and running',
    uptime: process.uptime()
  });
});

// ============================================================================
// NOTIFICATION ENDPOINTS
// ============================================================================

// ✅ ENDPOINT 1: Simple send with token
app.post('/send', async (req, res) => {
  try {
    console.log('📨 /send endpoint called');
    
    const { token, title, body, data } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        error: 'FCM token is required' 
      });
    }
    
    console.log(`📱 Sending to: ${token.substring(0, 30)}...`);
    console.log(`📝 Title: ${title}`);
    console.log(`📝 Body: ${body}`);
    
    const result = await sendFCMNotification(token, title, body, data);
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ /send error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ✅ ENDPOINT 2: Send by user ID (with sender details)
// 🔥 PRIMARY ENDPOINT - This is what the Flutter app calls
app.post('/send-notification', async (req, res) => {
  try {
    console.log('📨 /send-notification endpoint called');
    
    const { senderId, receiverId, message, senderName, chatId, notificationId } = req.body;
    
    if (!senderId || !receiverId || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'senderId, receiverId, and message are required' 
      });
    }
    
    console.log(`👤 Sender: ${senderName || senderId}`);
    console.log(`👤 Receiver: ${receiverId}`);
    console.log(`💬 Message: ${message.substring(0, 50)}...`);
    if (notificationId) {
      console.log(`🆔 Notification ID: ${notificationId}`);
    }
    
    // Get receiver's FCM token
    const receiverDoc = await db.collection('users').doc(receiverId).get();
    
    if (!receiverDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'Receiver not found' 
      });
    }
    
    const receiverData = receiverDoc.data();
    const token = receiverData.fcmToken;
    
    if (!token) {
      return res.status(404).json({ 
        success: false, 
        error: 'Receiver has no FCM token' 
      });
    }
    
    // Prepare notification
    const title = `New message from ${senderName || 'Someone'}`;
    const body = message.length > 100 ? 
      `${message.substring(0, 100)}...` : message;
    
    const data = {
      type: 'message',
      senderId: senderId,
      senderName: senderName || 'Someone',
      message: message,
      chatId: chatId || '',
      timestamp: new Date().toISOString(),
      notificationId: notificationId || '', // Include for deduplication
    };
    
    const result = await sendFCMNotification(token, title, body, data);
    
    if (result.success) {
      // ✅ OPTIONAL: Save notification to history (for receipts/read status)
      // This does NOT trigger auto-sending, just logging
      try {
        await db.collection('notifications').add({
          receiverId: receiverId,
          senderId: senderId,
          senderName: senderName || 'Someone',
          type: 'message',
          title: title,
          body: body,
          chatId: chatId || '',
          notificationId: notificationId || '',
          messageContent: message,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          read: false,
          fcmMessageId: result.messageId,
        });
        console.log('✅ Notification logged to Firestore for history');
      } catch (historyError) {
        console.warn('⚠️ Could not save notification history:', historyError.message);
        // Don't fail the request if history saving fails
      }
    }
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ /send-notification error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ✅ ENDPOINT 3: Send to user with token lookup
app.post('/send-to-user', async (req, res) => {
  try {
    const { userId, title, body, data } = req.body;
    
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
    
    const result = await sendFCMNotification(
      token,
      title || 'Notification',
      body || 'You have a notification',
      data || {}
    );
    
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// FIRESTORE LISTENER (DISABLED - To prevent duplicate notifications)
// ============================================================================

// 🔴 COMMENTED OUT: This auto-listener was causing duplicate notifications
// 
// Previously, when a message was sent:
// 1. Client sent notification via /send-notification endpoint ✅
// 2. Client also saved to notifications collection
// 3. This listener triggered and sent a SECOND notification ❌
//
// Now the client ONLY calls /send-notification endpoint
// Server does NOT auto-trigger on Firestore changes
// This is a cleaner, stateless architecture

/*
function startFirestoreListener() {
  console.log('👂 Starting Firestore listener...');
  
  db.collection('chats').onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const chatId = change.doc.id;
          const chatData = change.doc.data();
          
          if (chatData.lastMessage && chatData.lastMessageSender) {
            await handleNewMessage(chatId, chatData);
          }
        }
      });
    },
    (error) => {
      console.error('❌ Firestore listener error:', error);
      setTimeout(startFirestoreListener, 5000);
    }
  );
  
  console.log('✅ Firestore listener started');
}

async function handleNewMessage(chatId, chatData) {
  try {
    const senderId = chatData.lastMessageSender;
    const messageText = chatData.lastMessage;
    const participants = chatData.participants || [];
    
    const receiverId = participants.find((id) => id !== senderId);
    
    if (!receiverId) {
      console.log('⚠️ No receiver found for chat:', chatId);
      return;
    }
    
    const receiverDoc = await db.collection('users').doc(receiverId).get();
    
    if (!receiverDoc.exists) {
      console.log('⚠️ Receiver not found:', receiverId);
      return;
    }
    
    const receiverData = receiverDoc.data();
    const token = receiverData.fcmToken;
    
    if (!token) {
      console.log('⚠️ No FCM token for receiver:', receiverId);
      return;
    }
    
    const senderName = chatData.participantNames?.[senderId] || 'Someone';
    
    console.log(`📤 Auto-sending notification to ${receiverId}`);
    
    await sendFCMNotification(
      token,
      `New message from ${senderName}`,
      messageText.length > 100 ? 
        `${messageText.substring(0, 100)}...` : messageText,
      {
        type: 'message',
        chatId: chatId,
        senderId: senderId,
        senderName: senderName,
      }
    );
    
    console.log('✅ Auto-notification sent');
    
  } catch (error) {
    console.error('❌ Error in auto-notification:', error);
  }
}
*/

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 URLs:`);
  console.log(`   - Health: http://localhost:${PORT}/health`);
  console.log(`   - Ping: http://localhost:${PORT}/ping ← Use this for UptimeRobot`);
  console.log(`📨 Endpoints:`);
  console.log(`   - POST /send (token-based)`);
  console.log(`   - POST /send-notification (user ID-based) ← PRIMARY`);
  console.log(`   - POST /send-to-user (user ID lookup)`);
  console.log(`   - GET /health`);
  console.log(`   - GET /ping (for UptimeRobot keep-alive)`);
  console.log(`⚠️  Note: Firestore auto-listener is DISABLED`);
  console.log(`✅ Server is stateless - handles requests only`);
  console.log(`💤 To prevent Render from sleeping, use UptimeRobot to ping /ping endpoint`);
  
  // ❌ DO NOT call startFirestoreListener() - causes duplicate notifications
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received: shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received: shutting down');
  process.exit(0);
});
