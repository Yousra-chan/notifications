// ============================================================================
// FIXED /send ENDPOINT - Accepts YOUR format
// ============================================================================

// Fixed /send endpoint
app.post('/send', async (req, res) => {
  try {
    console.log('📨 Received notification request');
    console.log('📦 Body:', JSON.stringify(req.body, null, 2));
    
    const { token, title, body, data } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        error: 'FCM token is required' 
      });
    }
    
    console.log(`📱 Sending to token: ${token.substring(0, 30)}...`);
    console.log(`📝 Title: ${title}`);
    console.log(`📝 Body: ${body}`);
    console.log(`📊 Data:`, data);
    
    const message = {
      notification: {
        title: title || 'Notification',
        body: body || 'You have a new message',
      },
      data: data || {},
      token: token,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'high_importance_channel',
        }
      },
    };
    
    const response = await admin.messaging().send(message);
    
    console.log('✅ Notification sent successfully');
    
    res.json({
      success: true,
      messageId: response,
      message: 'Notification sent successfully'
    });
    
  } catch (error) {
    console.error('❌ Error sending notification:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ALSO ADD THIS COMPATIBILITY ENDPOINT:
app.post('/send-notification', async (req, res) => {
  try {
    const { senderId, receiverId, message } = req.body;
    
    if (!senderId || !receiverId || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'senderId, receiverId, and message are required' 
      });
    }
    
    // Get receiver's FCM token from Firestore
    const receiverDoc = await db.collection('users').doc(receiverId).get();
    
    if (!receiverDoc.exists) {
      return res.status(404).json({ error: 'Receiver not found' });
    }
    
    const receiverData = receiverDoc.data();
    const token = receiverData.fcmToken;
    
    if (!token) {
      return res.status(404).json({ error: 'Receiver has no FCM token' });
    }
    
    // Get sender name
    const senderDoc = await db.collection('users').doc(senderId).get();
    const senderName = senderDoc.exists ? 
      (senderDoc.data().name || 'Someone') : 'Someone';
    
    const fcmMessage = {
      notification: {
        title: `New message from ${senderName}`,
        body: message.length > 100 ? message.substring(0, 100) + '...' : message,
      },
      data: {
        type: 'message',
        senderId: senderId,
        senderName: senderName,
        message: message,
        timestamp: new Date().toISOString(),
      },
      token: token,
    };
    
    const response = await admin.messaging().send(fcmMessage);
    
    res.json({
      success: true,
      messageId: response,
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
