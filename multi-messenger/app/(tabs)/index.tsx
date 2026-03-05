import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet, View, Text, FlatList, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import io, { Socket } from 'socket.io-client';
import { SOCKET_URL } from '@/constants/config';
import BatteryWizard from '@/components/BatteryWizard';
import ConversationCard from '@/components/ConversationCard';
import QuickReplySheet from '@/components/QuickReplySheet';

// Only import notifications on native platforms (not web)
let Notifications: any = null;
if (Platform.OS !== 'web') {
  Notifications = require('expo-notifications');
}

// ─── Types ───────────────────────────────────────────────────
interface ConversationNotification {
  id: string;
  accountId: string;
  senderName: string;
  messagePreview: string;
  conversationId: string | null;
  senderIcon: string | null;
  timestamp: number;
}

// ─── Push permission ────────────────────────────────────
async function requestUserPermission() {
  if (Platform.OS === 'web' || !Notifications) return false;
  
  const { status } = await Notifications.requestPermissionsAsync();
  const enabled = status === 'granted';
  if (enabled) console.log('Notification permission granted');
  return enabled;
}

// ─── Main Screen ────────────────────────────────────────────
export default function HomeScreen() {
  /* --- state --- */
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [notifications, setNotifications] = useState<ConversationNotification[]>([]);
  const [status, setStatus] = useState<'Connected' | 'Disconnected'>('Disconnected');
  const [showWizard, setShowWizard] = useState(Platform.OS === 'android');
  const [fcmToken, setFcmToken] = useState<string | null>(null);

  // Reply sheet state
  const [activeReply, setActiveReply] = useState<ConversationNotification | null>(null);
  const [replyStatus, setReplyStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  /* ─── Push setup ─── */
  useEffect(() => {
    // Skip notifications on web platform
    if (Platform.OS === 'web' || !Notifications) {
      console.log('Running on web - notifications disabled');
      return;
    }

    const setup = async () => {
      const permissionGranted = await requestUserPermission();

      if (permissionGranted) {
        try {
          // Get Expo push token
          const tokenObj = await Notifications.getExpoPushTokenAsync({
            projectId: 'fb-messenger-relay-mobile'
          });
          const token = tokenObj.data;
          console.log('Expo Push Token:', token);
          setFcmToken(token);
        } catch (e: any) {
          // In Expo Go (development), applicationId is not available
          // Use a dev placeholder token so app can still test socket connection
          if (e.message?.includes('applicationId') || e.message?.includes('native')) {
            const devToken = `dev-expo-token-${Date.now()}`;
            console.log('Development mode - using placeholder token:', devToken);
            console.warn('Real push notifications require a production build (EAS build)');
            setFcmToken(devToken);
          } else {
            console.error('Expo token error:', e);
          }
        }

        // Handle notification taps (background/killed state)
        Notifications.addNotificationResponseReceivedListener((response: any) => {
          const d = response.notification.request.content.data as any;
          if (d) openReplyFromData(d);
        });

        // Check if app was opened from a notification (killed state)
        (async () => {
          try {
            const last = await Notifications.getLastNotificationResponseAsync();
            if (last?.notification?.request?.content?.data) {
              openReplyFromData(last.notification.request.content.data as any);
            }
          } catch (err) {
            /* ignore */
          }
        })();
      }
    };
    setup();

    // Handle foreground notifications
    const foregroundSub = Notifications.addNotificationReceivedListener((notification: any) => {
      const d = notification.request.content.data as any;
      if (d) {
        addNotification({
          accountId: d.accountId || 'unknown',
          senderName: d.senderName || 'Unknown',
          messagePreview: d.messagePreview || '',
          conversationId: d.conversationId || null,
          senderIcon: null,
          timestamp: Date.now(),
        });
      }
    });

    return () => {
      if (foregroundSub) foregroundSub.remove();
    };
  }, []);

  /* ─── Socket.io ─── */
  useEffect(() => {
    const AUTH_TOKEN = 'super-secret-password-123';
    const s = io(SOCKET_URL, { 
      auth: { token: AUTH_TOKEN },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    setSocket(s);
    socketRef.current = s;

    s.on('connect', () => {
      console.log('Socket connected to:', SOCKET_URL);
      setStatus('Connected');
      if (fcmToken) {
        s.emit('register-mobile', fcmToken);
        console.log('Registered mobile with token');
      }
    });

    s.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      console.error('Make sure server is running on', SOCKET_URL);
    });
    s.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setStatus('Disconnected');
    });

    // Incoming message from relay
    s.on('mobile-notification', (data: any) => {
      addNotification({
        accountId: data.accountId || 'unknown',
        senderName: data.senderName || 'Unknown',
        messagePreview: data.messagePreview || data.text || '',
        conversationId: data.conversationId || null,
        senderIcon: data.senderIcon || null,
        timestamp: data.timestamp || Date.now(),
      });
    });

    // Reply delivery confirmation from desktop
    s.on('reply-status', (data: any) => {
      if (data.status === 'delivered') {
        setReplyStatus('sent');
        // Auto-dismiss after 2s
        setTimeout(() => setReplyStatus('idle'), 2000);
      } else {
        setReplyStatus('failed');
      }
    });

    return () => { s.disconnect(); };
  }, []); // No dependencies - socket should stay connected

  /* ─── Register mobile device when token becomes available ─── */
  useEffect(() => {
    if (fcmToken && socketRef.current?.connected) {
      console.log('Registering mobile with push token...');
      socketRef.current.emit('register-mobile', fcmToken);
    }
  }, [fcmToken]);

  /* ─── Helpers ─── */
  const addNotification = useCallback((n: Omit<ConversationNotification, 'id'>) => {
    setNotifications(prev => [{
      ...n,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    }, ...prev]);
  }, []);

  const openReplyFromData = (data: Record<string, string>) => {
    setActiveReply({
      id: Date.now().toString(),
      accountId: data.accountId || 'unknown',
      senderName: data.senderName || 'Unknown',
      messagePreview: data.messagePreview || '',
      conversationId: data.conversationId || null,
      senderIcon: null,
      timestamp: Date.now(),
    });
    setReplyStatus('idle');
  };

  const handleCardPress = (item: ConversationNotification) => {
    setActiveReply(item);
    setReplyStatus('idle');
  };

  const handleSendReply = (text: string) => {
    if (!socketRef.current || !activeReply) return;
    socketRef.current.emit('send-reply', {
      accountId: activeReply.accountId,
      conversationId: activeReply.conversationId,
      message: text,
    });
    setReplyStatus('sending');
  };

  /* ─── Render ─── */
  if (showWizard) {
    return <BatteryWizard onComplete={() => setShowWizard(false)} />;
  }

  // Show reply sheet when a conversation is tapped
  if (activeReply) {
    return (
      <QuickReplySheet
        accountId={activeReply.accountId}
        senderName={activeReply.senderName}
        messagePreview={activeReply.messagePreview}
        conversationId={activeReply.conversationId}
        replyStatus={replyStatus}
        onSendReply={handleSendReply}
        onClose={() => { setActiveReply(null); setReplyStatus('idle'); }}
      />
    );
  }

  // Main inbox view
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>FB Remote Hub</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, status === 'Connected' ? styles.dotGreen : styles.dotRed]} />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </View>

      {/* Notification list */}
      {notifications.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>No messages yet</Text>
          <Text style={styles.emptySubtitle}>
            Incoming Facebook Marketplace messages{'\n'}will appear here in real-time
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <ConversationCard
              accountId={item.accountId}
              senderName={item.senderName}
              messagePreview={item.messagePreview}
              conversationId={item.conversationId}
              senderIcon={item.senderIcon}
              timestamp={item.timestamp}
              onPress={() => handleCardPress(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  header: {
    padding: 16,
    paddingTop: Platform.OS === 'android' ? 48 : 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderColor: '#e5e5ea',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotGreen: {
    backgroundColor: '#34c759',
  },
  dotRed: {
    backgroundColor: '#ff3b30',
  },
  statusText: {
    fontSize: 12,
    color: '#8e8e93',
    fontWeight: '500',
  },
  listContent: {
    padding: 12,
    paddingBottom: 80,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#8e8e93',
    textAlign: 'center',
    lineHeight: 20,
  },
});
