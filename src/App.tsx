/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Clock, 
  Play, 
  Pause, 
  RotateCcw, 
  Settings, 
  Plus, 
  Trash2, 
  ChevronUp, 
  ChevronDown,
  Monitor,
  LayoutDashboard,
  LogIn,
  LogOut,
  AlertCircle,
  History,
  Download,
  Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  getDocs,
  writeBatch,
  getDocFromServer,
  addDoc,
  limit
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { ServiceItem, ServiceState, ServiceStatus, ServiceType, ServiceLog, CommonItem } from './types';
import { TimePicker } from './components/TimePicker';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: any[];
  }
}

const handleFirestoreError = (error: any, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

const INITIAL_ITEMS = [
  "PROCESSING",
  "INTROIT",
  "PRESENTATION OF COLORS",
  "CALL TO WORSHIP",
  "PRAISE AND ADORATION",
  "BIBLE STUDIES",
  "BIBLE READING",
  "ANTHEM BY CHURCH CHOIR",
  "TITHE AND OFFERING",
  "THANKGIVING",
  "KOFR & AMA ANNOUNCEMENT"
];

const COMMON_ITEMS = [
  ...INITIAL_ITEMS,
  "OPENING PRAYER",
  "WELCOME ADDRESS",
  "SERMON",
  "COMMUNION",
  "BENEDICTION",
  "CLOSING PRAYER"
];

const DEFAULT_SERVICE_TYPES = [
  'Divine Service',
  'Communion Service',
  'Harvest',
  'Harvest Launching',
  'Prayer Service'
];

const STALE_ITEM_TIMER_MS = 1000 * 60 * 60 * 6;
const STALE_SERVICE_TIMER_MS = 1000 * 60 * 60 * 12;
const STALE_APP_STATE_MS = 1000 * 60 * 60 * 6;
const STATIC_ADMIN_PASSWORD = 'admin123';
const STATIC_ADMIN_UNLOCK_KEY = 'service-management-admin-unlocked';

export default function App() {
  const isStaticPagesHost = typeof window !== 'undefined' && window.location.hostname.endsWith('github.io');
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [commonItems, setCommonItems] = useState<CommonItem[]>([]);
  const [logs, setLogs] = useState<ServiceLog[]>([]);
  const [state, setState] = useState<ServiceState>({
    activeItemId: null,
    activeServiceTypeId: null,
    startTime: null,
    serviceStartTime: null,
    updatedAt: Date.now(),
    status: 'idle',
    remainingSeconds: 0,
    timerThreshold: 120
  });
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [view, setView] = useState<'display' | 'control' | 'setup' | 'history'>('display');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemSpeaker, setNewItemSpeaker] = useState('');
  const [newItemDuration, setNewItemDuration] = useState(5);
  const [newServiceTypeName, setNewServiceTypeName] = useState('');
  const [selectedServiceTypeOption, setSelectedServiceTypeOption] = useState('');
  const [newServiceTypeStart, setNewServiceTypeStart] = useState('09:00 AM');
  const [newServiceTypeEnd, setNewServiceTypeEnd] = useState('11:00 AM');
  const [newServiceTypeDuration, setNewServiceTypeDuration] = useState(120);
  const [newCommonItemTitle, setNewCommonItemTitle] = useState('');
  const [serviceTypeMessage, setServiceTypeMessage] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activePicker, setActivePicker] = useState<{
    type: 'time' | 'duration';
    title: string;
    onConfirm: (val: string) => void;
  } | null>(null);
  const lastAutoResetRef = useRef(0);
  const autoStopHandledRef = useRef(false);
  const latestAppliedUpdatedAtRef = useRef(state.updatedAt || Date.now());
  const forceIdleLockUntilRef = useRef(0);

  const serviceTypeOptions = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...DEFAULT_SERVICE_TYPES, ...serviceTypes.map((type) => type.name)];

    return merged.filter((name) => {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [serviceTypes]);

  // Sync current time
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Check server session on startup so admin state is not controlled by client storage.
  useEffect(() => {
    const checkSession = async () => {
      if (isStaticPagesHost) {
        setIsAdminUnlocked(localStorage.getItem(STATIC_ADMIN_UNLOCK_KEY) === 'true');
        return;
      }

      try {
        const response = await fetch('/api/admin/session', { credentials: 'include' });
        if (!response.ok) {
          setIsAdminUnlocked(false);
          return;
        }

        const data = await response.json();
        setIsAdminUnlocked(Boolean(data.authenticated));
      } catch {
        setIsAdminUnlocked(false);
      }
    };

    void checkSession();
  }, [isStaticPagesHost]);

  // Test Connection
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'service_config', 'connection_test'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
      }
    };
    testConnection();
  }, []);

  // Firestore sync: Items
  useEffect(() => {
    const q = query(collection(db, 'service_items'), orderBy('order', 'asc'));
    return onSnapshot(q, (snapshot) => {
      const newItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServiceItem));
      setItems(newItems);
      
      // Seed if empty
      if (newItems.length === 0 && isAdminUnlocked) {
        seedInitialItems();
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'service_items');
    });
  }, [isAdminUnlocked]);

  // Firestore sync: Service Types
  useEffect(() => {
    return onSnapshot(collection(db, 'service_types'), (snapshot) => {
      const types = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServiceType));
      setServiceTypes(types);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'service_types');
    });
  }, []);

  // Firestore sync: State
  useEffect(() => {
    return onSnapshot(doc(db, 'service_config', 'current'), (snapshot) => {
      if (snapshot.exists()) {
        const incoming = snapshot.data() as ServiceState;
        const incomingUpdatedAt = incoming.updatedAt || 0;
        if (incomingUpdatedAt > 0 && incomingUpdatedAt < latestAppliedUpdatedAtRef.current) {
          return;
        }

        if (Date.now() < forceIdleLockUntilRef.current && incoming.status === 'running') {
          return;
        }

        const now = Date.now();
        const isItemTimerStale = incoming.status === 'running' && !!incoming.startTime && (now - incoming.startTime) > STALE_ITEM_TIMER_MS;
        const isServiceTimerStale = !!incoming.serviceStartTime && (now - incoming.serviceStartTime) > STALE_SERVICE_TIMER_MS;
        const lastActivity = incoming.updatedAt || incoming.startTime || incoming.serviceStartTime || 0;
        const isSessionStale = !!lastActivity && (now - lastActivity) > STALE_APP_STATE_MS;
        const hasNonIdleTimerState = incoming.status !== 'idle' || !!incoming.serviceStartTime || incoming.remainingSeconds < 0;

        if (!isAdminUnlocked) {
          if ((isItemTimerStale || isServiceTimerStale || (isSessionStale && hasNonIdleTimerState)) || (incoming.status !== 'running' && incoming.remainingSeconds < 0)) {
            setState({
              ...incoming,
              activeItemId: null,
              startTime: null,
              serviceStartTime: null,
              status: 'idle',
              remainingSeconds: 0,
              updatedAt: incomingUpdatedAt || now,
            });
            return;
          }

          latestAppliedUpdatedAtRef.current = incomingUpdatedAt || now;
          setState(incoming);
          return;
        }

        if ((isItemTimerStale || isServiceTimerStale || (isSessionStale && hasNonIdleTimerState)) && (now - lastAutoResetRef.current) > 5000) {
          const staleFix: Partial<ServiceState> = {};

          if (isItemTimerStale || (isSessionStale && incoming.status !== 'idle')) {
            staleFix.status = 'idle';
            staleFix.startTime = null;
            staleFix.remainingSeconds = 0;
            staleFix.activeItemId = null;
          }

          if (isServiceTimerStale || (isSessionStale && !!incoming.serviceStartTime)) {
            staleFix.serviceStartTime = null;
          }

          staleFix.updatedAt = now;
          latestAppliedUpdatedAtRef.current = now;

          lastAutoResetRef.current = now;
          setState({ ...incoming, ...staleFix });
          void setDoc(doc(db, 'service_config', 'current'), staleFix, { merge: true });
          return;
        }

        if (incoming.status !== 'running' && incoming.remainingSeconds < 0) {
          const normalized = {
            ...incoming,
            status: 'idle' as const,
            startTime: null,
            remainingSeconds: 0,
            activeItemId: null,
            updatedAt: now,
          };
          latestAppliedUpdatedAtRef.current = now;
          lastAutoResetRef.current = now;
          setState(normalized);
          void setDoc(doc(db, 'service_config', 'current'), normalized, { merge: true });
          return;
        }

        latestAppliedUpdatedAtRef.current = incomingUpdatedAt || now;
        setState(incoming);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'service_config/current');
    });
  }, [isAdminUnlocked]);

  // Firestore sync: Common Items
  useEffect(() => {
    const q = query(collection(db, 'common_items'), orderBy('title', 'asc'));
    return onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CommonItem));
      setCommonItems(items);
      
      // Seed if empty
      if (items.length === 0 && isAdminUnlocked) {
        seedCommonItems();
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'common_items');
    });
  }, [isAdminUnlocked]);

  // Firestore sync: Logs
  useEffect(() => {
    if (!isAdminUnlocked) return;
    const q = query(collection(db, 'service_logs'), orderBy('startTime', 'desc'), limit(100));
    return onSnapshot(q, (snapshot) => {
      const newLogs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServiceLog));
      setLogs(newLogs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'service_logs');
    });
  }, [isAdminUnlocked]);

  const seedInitialItems = async () => {
    const batch = writeBatch(db);
    INITIAL_ITEMS.forEach((title, index) => {
      const newDoc = doc(collection(db, 'service_items'));
      batch.set(newDoc, {
        title,
        speaker: '',
        duration: 10,
        order: index + 1
      });
    });
    await batch.commit();
  };

  const seedCommonItems = async () => {
    const batch = writeBatch(db);
    COMMON_ITEMS.forEach((title) => {
      const newDoc = doc(collection(db, 'common_items'));
      batch.set(newDoc, { title });
    });
    await batch.commit();
  };

  const addCommonItem = async () => {
    if (!newCommonItemTitle) return;
    const newDoc = doc(collection(db, 'common_items'));
    await setDoc(newDoc, { title: newCommonItemTitle });
    setNewCommonItemTitle('');
  };

  const deleteCommonItem = async (id: string) => {
    await deleteDoc(doc(db, 'common_items', id));
  };

  const handleLogin = async () => {
    setLoginError(null);
    setIsLoginLoading(true);

    if (!adminPasswordInput.trim()) {
      setLoginError('Enter the admin password.');
      setIsLoginLoading(false);
      return;
    }

    if (isStaticPagesHost) {
      if (adminPasswordInput.trim() === STATIC_ADMIN_PASSWORD) {
        localStorage.setItem(STATIC_ADMIN_UNLOCK_KEY, 'true');
        setIsAdminUnlocked(true);
        setAdminPasswordInput('');
      } else {
        setLoginError('Invalid admin password.');
        setIsAdminUnlocked(false);
      }
      setIsLoginLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ password: adminPasswordInput.trim() }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setLoginError(data?.message || 'Invalid admin password.');
        setIsAdminUnlocked(false);
        return;
      }

      setIsAdminUnlocked(true);
      setAdminPasswordInput('');
    } catch {
      setLoginError('Cannot reach auth server. Start backend with npm run dev:server.');
      setIsAdminUnlocked(false);
    } finally {
      setIsLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    if (isStaticPagesHost) {
      localStorage.removeItem(STATIC_ADMIN_UNLOCK_KEY);
      setIsAdminUnlocked(false);
      setView('display');
      setLoginError(null);
      return;
    }

    try {
      await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Ignore network errors and still lock UI locally.
    }

    setIsAdminUnlocked(false);
    setView('display');
    setLoginError(null);
  };

  const updateServiceState = async (updates: Partial<ServiceState>) => {
    const nextUpdatedAt = Date.now();
    latestAppliedUpdatedAtRef.current = nextUpdatedAt;
    setState((prev) => ({ ...prev, ...updates, updatedAt: nextUpdatedAt }));
    await setDoc(doc(db, 'service_config', 'current'), { ...updates, updatedAt: nextUpdatedAt }, { merge: true });
  };

  const forceIdleState = async () => {
    const nextUpdatedAt = Date.now();
    forceIdleLockUntilRef.current = nextUpdatedAt + (1000 * 60 * 30);
    const nextState: ServiceState = {
      activeItemId: null,
      activeServiceTypeId: state.activeServiceTypeId ?? null,
      startTime: null,
      serviceStartTime: null,
      status: 'idle',
      remainingSeconds: 0,
      timerThreshold: state.timerThreshold || 120,
      updatedAt: nextUpdatedAt,
    };

    latestAppliedUpdatedAtRef.current = nextUpdatedAt;
    setState(nextState);
    await setDoc(doc(db, 'service_config', 'current'), nextState, { merge: false });
  };

  const recordLog = async (endTime: number) => {
    if (!state.activeItemId || !state.startTime) return;
    const item = items.find(i => i.id === state.activeItemId);
    const type = serviceTypes.find(t => t.id === state.activeServiceTypeId);
    if (!item) return;

    try {
      await addDoc(collection(db, 'service_logs'), {
        date: new Date().toISOString(),
        serviceType: type?.name || 'Unknown',
        activityName: item.title,
        speaker: item.speaker || null,
        startTime: state.startTime,
        endTime: endTime,
        durationSeconds: Math.floor((endTime - state.startTime) / 1000),
        totalServiceStartTime: state.serviceStartTime ?? null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'service_logs');
    }
  };

  const safeRecordLog = async () => {
    try {
      await recordLog(Date.now());
    } catch (error) {
      console.error('Log write failed during timer transition, continuing state update.', error);
    }
  };

  const toggleTimer = async () => {
    if (state.status === 'running') {
      // Pause: calculate remaining time
      const now = Date.now();
      const elapsed = Math.floor((now - (state.startTime || now)) / 1000);
      const remaining = Math.max(0, state.remainingSeconds - elapsed);
      
      // Record log when pausing/stopping
      await safeRecordLog();
      
      await updateServiceState({ status: 'paused', remainingSeconds: remaining, startTime: null });
    } else {
      // Start/Resume
      forceIdleLockUntilRef.current = 0;
      await updateServiceState({ status: 'running', startTime: Date.now() });
    }
  };

  const resetTimer = async () => {
    if (state.status === 'running' && state.startTime) {
      await safeRecordLog();
    }
    await forceIdleState();
  };

  const selectItem = async (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    // If there was an active item running, record it
    if (state.status === 'running' && state.startTime) {
      await safeRecordLog();
    }

    await updateServiceState({
      activeItemId: itemId,
      status: 'idle',
      startTime: null,
      remainingSeconds: item.duration * 60
    });
  };

  const selectServiceType = async (typeId: string) => {
    if (!isAdminUnlocked) return;
    await updateServiceState({ activeServiceTypeId: typeId });
  };

  const startService = async () => {
    if (!isAdminUnlocked) return;
    forceIdleLockUntilRef.current = 0;
    await updateServiceState({ serviceStartTime: Date.now() });
  };

  const resetService = async () => {
    if (!isAdminUnlocked) return;
    
    // Record final activity if running
    if (state.status === 'running' && state.startTime) {
      await safeRecordLog();
    }

    await forceIdleState();
  };

  const stopAllTimers = async () => {
    if (!isAdminUnlocked) return;

    if (state.status === 'running' && state.startTime) {
      await safeRecordLog();
    }

    await forceIdleState();
  };

  const addServiceType = async () => {
    if (!isAdminUnlocked) return;

    const normalizedName = newServiceTypeName.trim();
    if (!normalizedName) {
      setServiceTypeMessage('Enter or select a service type name.');
      return;
    }

    const alreadyExists = serviceTypes.some(
      (type) => type.name.trim().toLowerCase() === normalizedName.toLowerCase()
    );

    if (alreadyExists) {
      setServiceTypeMessage('Service type already exists. Please choose another name.');
      return;
    }

    try {
      const newDoc = doc(collection(db, 'service_types'));
      await setDoc(newDoc, {
        name: normalizedName,
        startTime: newServiceTypeStart,
        endTime: newServiceTypeEnd,
        duration: newServiceTypeDuration
      });
      setNewServiceTypeName(normalizedName);
      setSelectedServiceTypeOption(normalizedName);
      setServiceTypeMessage('Service type added.');
    } catch (error) {
      setServiceTypeMessage('Unable to add service type. Please try again.');
      console.error('Add service type failed', error);
    }
  };

  const deleteServiceType = async (id: string) => {
    await deleteDoc(doc(db, 'service_types', id));
  };

  const addItem = async () => {
    if (!newItemTitle) return;
    const newDoc = doc(collection(db, 'service_items'));
    await setDoc(newDoc, {
      title: newItemTitle,
      speaker: newItemSpeaker,
      duration: newItemDuration,
      order: items.length + 1
    });
    setNewItemTitle('');
    setNewItemSpeaker('');
  };

  const moveItem = async (index: number, direction: 'up' | 'down') => {
    if (!isAdminUnlocked) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const item1 = items[index];
    const item2 = items[targetIndex];

    const batch = writeBatch(db);
    batch.update(doc(db, 'service_items', item1.id), { order: item2.order });
    batch.update(doc(db, 'service_items', item2.id), { order: item1.order });
    await batch.commit();
  };

  const updateItemDuration = async (id: string, newDuration: number) => {
    if (!isAdminUnlocked) return;
    await updateDoc(doc(db, 'service_items', id), { duration: newDuration });
    
    // If this is the active item and we're idle, update remaining time
    if (state.activeItemId === id && state.status === 'idle') {
      await updateServiceState({ remainingSeconds: newDuration * 60 });
    }
  };

  const quickStartByNumber = async (num: number) => {
    const item = items[num - 1];
    if (item) {
      // If there was an active item running, record it
      if (state.status === 'running' && state.startTime) {
        await safeRecordLog();
      }

      forceIdleLockUntilRef.current = 0;
      await updateServiceState({
        activeItemId: item.id,
        status: 'running',
        startTime: Date.now(),
        remainingSeconds: item.duration * 60
      });
    }
  };

  const deleteItem = async (id: string) => {
    if (!isAdminUnlocked) return;
    
    // If deleting active item, record it first
    if (state.activeItemId === id && state.status === 'running' && state.startTime) {
      await safeRecordLog();
      await updateServiceState({ activeItemId: null, status: 'idle', startTime: null, remainingSeconds: 0 });
    }

    await deleteDoc(doc(db, 'service_items', id));
  };

  const exportLogsCSV = () => {
    if (logs.length === 0) return;

    const headers = ['Date', 'Service Type', 'Activity', 'Speaker', 'Start Time', 'End Time', 'Duration (s)', 'Total Service Duration (s)'];
    const csvContent = [
      headers.join(','),
      ...logs.map(log => {
        const date = new Date(log.date).toLocaleDateString();
        const start = new Date(log.startTime).toLocaleTimeString();
        const end = new Date(log.endTime).toLocaleTimeString();
        const totalDuration = log.totalServiceStartTime ? Math.floor((log.endTime - log.totalServiceStartTime) / 1000) : 0;
        
        return [
          `"${date}"`,
          `"${log.serviceType}"`,
          `"${log.activityName}"`,
          `"${log.speaker || ''}"`,
          `"${start}"`,
          `"${end}"`,
          log.durationSeconds,
          totalDuration
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `service_report_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const currentRemaining = useMemo(() => {
    if (state.status === 'running' && state.startTime) {
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
      return Math.max(0, state.remainingSeconds - elapsed);
    }
    return Math.max(0, state.remainingSeconds);
  }, [state, currentTime]);

  useEffect(() => {
    if (!isAdminUnlocked) {
      return;
    }

    if (state.status !== 'running') {
      autoStopHandledRef.current = false;
      return;
    }

    if (currentRemaining <= 0 && !autoStopHandledRef.current) {
      autoStopHandledRef.current = true;
      void (async () => {
        await safeRecordLog();
        await updateServiceState({ status: 'idle', startTime: null, remainingSeconds: 0, activeItemId: null });
      })();
    }
  }, [isAdminUnlocked, state.status, currentRemaining]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(Math.abs(seconds) / 60);
    const secs = Math.abs(seconds) % 60;
    const sign = seconds < 0 ? '-' : '';
    return `${sign}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const activeItem = items.find(i => i.id === state.activeItemId);
  const activeServiceType = serviceTypes.find(t => t.id === state.activeServiceTypeId);
  const isCritical = currentRemaining <= 60 && currentRemaining > 0;
  const isTimeUp = currentRemaining <= 0 && state.status !== 'idle';
  const shouldShowCountdown = state.status !== 'idle' || currentRemaining > 0;

  const servicePlannedSeconds = activeServiceType ? activeServiceType.duration * 60 : null;

  const serviceTimeElapsed = useMemo(() => {
    if (state.serviceStartTime) {
      const elapsed = Math.floor((Date.now() - state.serviceStartTime) / 1000);
      if (servicePlannedSeconds !== null) {
        return Math.min(elapsed, servicePlannedSeconds);
      }
      return elapsed;
    }
    return 0;
  }, [state.serviceStartTime, currentTime, servicePlannedSeconds]);

  const serviceRemaining = useMemo(() => {
    if (activeServiceType && state.serviceStartTime) {
      return Math.max(0, (activeServiceType.duration * 60) - serviceTimeElapsed);
    }
    return 0;
  }, [activeServiceType, serviceTimeElapsed]);

  useEffect(() => {
    if (!isAdminUnlocked) {
      return;
    }

    if (!state.serviceStartTime) {
      return;
    }

    if (serviceRemaining <= 0) {
      void updateServiceState({ serviceStartTime: null });
    }
  }, [isAdminUnlocked, state.serviceStartTime, serviceRemaining]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-emerald-500/30">
      {/* Top Navigation */}
      {!isFullscreen && (
        <nav className="fixed top-0 left-0 right-0 h-16 border-b border-white/5 bg-zinc-950/80 backdrop-blur-md z-50 flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Clock className="w-5 h-5 text-black" />
            </div>
            <span className="font-bold tracking-tight text-lg">SERVICE TIMER</span>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={() => setView('display')}
              className={`p-2 rounded-lg transition-colors ${view === 'display' ? 'bg-white/10 text-emerald-400' : 'text-zinc-400 hover:text-white'}`}
              title="Display View"
            >
              <Monitor className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setView('control')}
              className={`p-2 rounded-lg transition-colors ${view === 'control' ? 'bg-white/10 text-emerald-400' : 'text-zinc-400 hover:text-white'}`}
              title="Control Panel"
            >
              <LayoutDashboard className="w-5 h-5" />
            </button>
            {isAdminUnlocked && (
              <>
                <button 
                  onClick={() => setView('history')}
                  className={`p-2 rounded-lg transition-colors ${view === 'history' ? 'bg-white/10 text-emerald-400' : 'text-zinc-400 hover:text-white'}`}
                  title="Service History"
                >
                  <History className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setView('setup')}
                  className={`p-2 rounded-lg transition-colors ${view === 'setup' ? 'bg-white/10 text-emerald-400' : 'text-zinc-400 hover:text-white'}`}
                  title="Setup & Order"
                >
                  <Settings className="w-5 h-5" />
                </button>
              </>
            )}
            
            <div className="h-6 w-px bg-white/10 mx-2" />
            
            {isAdminUnlocked ? (
              <div className="flex items-center gap-3">
                <span className="text-xs uppercase tracking-widest text-emerald-400">Admin</span>
                <button onClick={handleLogout} className="text-sm text-zinc-400 hover:text-white">Lock</button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={adminPasswordInput}
                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void handleLogin();
                      }
                    }}
                    placeholder="Admin password"
                    className="bg-zinc-900 border border-white/10 rounded-full px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <button 
                    onClick={handleLogin}
                    disabled={isLoginLoading}
                    className="flex items-center gap-2 bg-white text-black px-4 py-1.5 rounded-full text-sm font-semibold hover:bg-zinc-200 transition-colors"
                  >
                    <LogIn className="w-4 h-4" />
                    {isLoginLoading ? 'Checking...' : 'Unlock'}
                  </button>
                </div>
                {loginError && (
                  <span className="max-w-[24rem] text-[11px] leading-4 text-red-400 text-right">
                    {loginError}
                  </span>
                )}
              </div>
            )}
          </div>
        </nav>
      )}

      <main className={`${!isFullscreen ? 'pt-24' : 'pt-0'} pb-12 px-6 max-w-7xl mx-auto min-h-screen flex flex-col justify-center`}>
        <AnimatePresence mode="wait">
          {view === 'display' ? (
            <motion.div 
              key="display"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center min-h-[70vh] text-center"
            >
              {/* Current Wall Clock & Service Duration */}
              <div className="flex flex-col items-center mb-12">
                <div className="text-zinc-500 font-mono text-xs md:text-sm tracking-[0.4em] uppercase mb-3">
                  Current Time
                </div>
                <div className="font-mono tabular-nums text-white bg-white/5 border border-emerald-500/40 rounded-2xl px-6 md:px-10 py-3 md:py-5 text-7xl sm:text-8xl md:text-[9rem] lg:text-[10rem] tracking-[0.08em] font-black leading-none shadow-[0_0_40px_rgba(16,185,129,0.15)]">
                  {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
                {state.serviceStartTime && activeServiceType && serviceRemaining > 0 && (
                  <div className="mt-4 flex items-center gap-3 text-emerald-500/60 font-mono text-sm tracking-widest uppercase">
                    <span className="opacity-50">SERVICE DURATION:</span>
                    <span className="font-bold">{formatTime(serviceTimeElapsed)}</span>
                  </div>
                )}
              </div>

              {/* Service Type Info */}
              {activeServiceType && state.serviceStartTime && serviceRemaining > 0 && (
                <div className="mb-8 flex flex-col items-center">
                  <span className="text-zinc-500 font-mono text-xs tracking-widest uppercase mb-2">SERVICE TYPE</span>
                  <div className="bg-white/5 border border-white/10 px-6 py-2 rounded-full flex items-center gap-4">
                    <span className="text-emerald-400 font-bold uppercase">{activeServiceType.name}</span>
                    <div className="w-px h-4 bg-white/10" />
                    <span className={`font-mono font-bold ${serviceRemaining < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                      {serviceRemaining < 0 ? 'TIME OVER: ' : 'SERVICE LEFT: '}
                      {formatTime(serviceRemaining)}
                    </span>
                  </div>
                </div>
              )}

              {/* Active Activity */}
              <div className="mb-4">
                <span className="text-emerald-500 font-mono text-lg tracking-[0.4em] uppercase opacity-70">
                  CURRENTLY PROCEEDING
                </span>
                <h1 className={`text-6xl md:text-8xl font-black tracking-tighter mt-6 uppercase ${isTimeUp ? 'text-red-500' : ''}`}>
                  {isTimeUp ? "TIME IS UP" : (activeItem?.title || "NO ACTIVE ITEM")}
                </h1>
                {activeItem?.speaker && !isTimeUp && (
                  <div className="mt-4 text-emerald-500/60 font-mono text-xl tracking-[0.2em] uppercase">
                    BY: {activeItem.speaker}
                  </div>
                )}
              </div>

              {/* Big Countdown */}
              <div className="mt-16 min-h-[20vw] flex items-center justify-center">
                {shouldShowCountdown && (currentRemaining <= (state.timerThreshold || 120) || isTimeUp || state.status === 'idle') ? (
                  <div className={`font-mono tabular-nums transition-colors duration-500 ${isTimeUp || isCritical ? 'text-red-500' : 'text-white'}`}>
                    <span className="text-[18vw] leading-none font-bold">
                      {formatTime(currentRemaining)}
                    </span>
                  </div>
                ) : shouldShowCountdown ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center gap-6"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="text-emerald-500/40 font-mono text-2xl tracking-[0.5em] uppercase font-light">
                        Service in Progress
                      </span>
                    </div>
                    <div className="text-zinc-700 font-mono text-sm tracking-widest uppercase">
                      Timer hidden until {Math.floor((state.timerThreshold || 120) / 60)}m mark
                    </div>
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-zinc-600">
                    <span className="font-mono text-lg tracking-[0.3em] uppercase">Timer Ready</span>
                    <span className="text-sm uppercase tracking-widest">Select an item to start timing</span>
                  </div>
                )}
              </div>

              {isCritical && !isTimeUp && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mt-12 flex items-center gap-4 text-red-500 bg-red-500/10 px-8 py-4 rounded-full border border-red-500/20"
                >
                  <AlertCircle className="w-8 h-8" />
                  <span className="font-bold text-xl uppercase tracking-[0.3em]">Final Minute Warning</span>
                </motion.div>
              )}

              {/* Fullscreen Toggle for Projection */}
              <button 
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="fixed bottom-16 right-8 p-3 bg-white/5 hover:bg-white/10 rounded-full text-zinc-500 hover:text-white transition-all group"
                title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen for Projection"}
              >
                {isFullscreen ? <LayoutDashboard className="w-6 h-6" /> : <Monitor className="w-6 h-6" />}
                <span className="absolute right-full mr-4 top-1/2 -translate-y-1/2 bg-zinc-900 px-3 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  {isFullscreen ? "Show Controls" : "Fullscreen Projection Mode"}
                </span>
              </button>
            </motion.div>
          ) : view === 'control' ? (
            <motion.div 
              key="control"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              {/* Left Column: Timer Controls */}
              <div className="lg:col-span-1 space-y-6">
                {/* Service Selection & Global Timer */}
                <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6">
                  <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest mb-6">Service Session</h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-zinc-500 uppercase mb-1.5 block">Active Service</label>
                      <select 
                        disabled={!isAdminUnlocked}
                        value={state.activeServiceTypeId || ''}
                        onChange={(e) => selectServiceType(e.target.value)}
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500"
                      >
                        <option value="">Select Service Type...</option>
                        {serviceTypes.map(t => (
                          <option key={t.id} value={t.id}>{t.name} ({t.duration}m)</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-zinc-950 rounded-xl border border-white/5">
                      <div>
                        <div className="text-xs text-zinc-500 uppercase">Service Time</div>
                        <div className={`text-2xl font-mono font-bold ${serviceRemaining < 0 ? 'text-red-500' : 'text-white'}`}>
                          {formatTime(serviceRemaining)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {!state.serviceStartTime ? (
                          <button 
                            disabled={!state.activeServiceTypeId || !isAdminUnlocked}
                            onClick={startService}
                            className="bg-emerald-500 text-black p-2 rounded-lg hover:bg-emerald-400 disabled:opacity-50"
                            title="Start Service Session"
                          >
                            <Play className="w-5 h-5" />
                          </button>
                        ) : (
                          <button 
                            disabled={!isAdminUnlocked}
                            onClick={resetService}
                            className="bg-zinc-800 text-white p-2 rounded-lg hover:bg-zinc-700"
                            title="Reset Service Session"
                          >
                            <RotateCcw className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <button
                      disabled={!isAdminUnlocked}
                      onClick={stopAllTimers}
                      className="w-full bg-red-500/15 border border-red-500/30 text-red-400 py-3 rounded-xl font-bold hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      STOP ALL TIMERS
                    </button>
                  </div>
                </div>

                <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6">
                  <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest mb-6">Item Timer</h2>
                  
                  <div className="text-center mb-8">
                    <div className="text-5xl font-mono font-bold mb-2">
                      {formatTime(currentRemaining)}
                    </div>
                    <div className="text-emerald-500 text-sm font-bold uppercase tracking-widest">
                      {activeItem?.title || "Select an item"}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      disabled={!activeItem || !isAdminUnlocked}
                      onClick={toggleTimer}
                      className={`flex items-center justify-center gap-2 py-4 rounded-xl font-bold transition-all ${
                        state.status === 'running' 
                        ? 'bg-zinc-800 text-white hover:bg-zinc-700' 
                        : 'bg-emerald-500 text-black hover:bg-emerald-400'
                      } disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/10`}
                    >
                      {state.status === 'running' ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                      {state.status === 'running' ? 'PAUSE' : 'START'}
                    </button>
                    <button 
                      disabled={!activeItem || !isAdminUnlocked}
                      onClick={resetTimer}
                      className="flex items-center justify-center gap-2 py-4 rounded-xl font-bold bg-zinc-800 text-white hover:bg-zinc-700 disabled:opacity-50"
                    >
                      <RotateCcw className="w-5 h-5" />
                      RESET
                    </button>
                  </div>
                </div>

                {/* Quick Start Combo Box */}
                <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6">
                  <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest mb-4">Quick Start by Number</h2>
                  <select 
                    disabled={!isAdminUnlocked}
                    onChange={(e) => quickStartByNumber(parseInt(e.target.value))}
                    className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 appearance-none cursor-pointer"
                    defaultValue=""
                  >
                    <option value="" disabled>Select Item Number...</option>
                    {items.map((_, i) => (
                      <option key={i} value={i + 1}>Item #{i + 1}: {items[i].title}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Right Column: Order of Service Preview */}
              <div className="lg:col-span-2">
                <div className="bg-zinc-900 border border-white/5 rounded-2xl overflow-hidden">
                  <div className="p-6 border-b border-white/5 flex items-center justify-between">
                    <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest">Live Order</h2>
                    <div className="flex gap-2">
                      <span className="text-xs bg-emerald-500/10 text-emerald-500 px-2 py-1 rounded font-bold">LIVE</span>
                      <span className="text-xs bg-white/5 px-2 py-1 rounded text-zinc-400">{items.length} ITEMS</span>
                    </div>
                  </div>
                  
                  <div className="divide-y divide-white/5 max-h-[60vh] overflow-y-auto">
                    {items.map((item, index) => (
                      <div 
                        key={item.id}
                        className={`group flex items-center gap-4 p-5 hover:bg-white/5 transition-colors ${state.activeItemId === item.id ? 'bg-emerald-500/10 border-l-4 border-emerald-500' : 'border-l-4 border-transparent'}`}
                      >
                        <div className="w-8 text-zinc-600 font-mono text-sm">{index + 1}</div>
                        <div className="flex-1">
                          <h3 className={`font-bold uppercase tracking-tight text-lg ${state.activeItemId === item.id ? 'text-emerald-400' : 'text-white'}`}>
                            {item.title}
                          </h3>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-zinc-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {item.duration}m
                            </span>
                            {item.speaker && (
                              <span className="text-xs text-emerald-500/60 font-mono uppercase tracking-wider">
                                • {item.speaker}
                              </span>
                            )}
                            {state.activeItemId === item.id && (
                              <span className="text-[10px] bg-emerald-500 text-black px-1.5 py-0.5 rounded font-black animate-pulse">ACTIVE</span>
                            )}
                          </div>
                        </div>
                        
                        <button 
                          onClick={() => selectItem(item.id)}
                          className={`p-3 rounded-xl transition-all ${state.activeItemId === item.id ? 'bg-emerald-500 text-black' : 'bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10'}`}
                          title="Select for Timer"
                        >
                          <Play className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : view === 'history' ? (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-4xl font-black tracking-tight">SERVICE HISTORY</h1>
                  <p className="text-zinc-500 mt-2">Activity logs and timestamps for all services.</p>
                </div>
                <button 
                  onClick={exportLogsCSV}
                  className="flex items-center gap-2 bg-emerald-500 text-black px-6 py-3 rounded-xl font-bold hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
                >
                  <Download className="w-5 h-5" />
                  EXPORT CSV
                </button>
              </div>

              <div className="bg-zinc-900 border border-white/5 rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/5 border-b border-white/5">
                      <th className="px-6 py-4 text-xs font-mono text-zinc-500 uppercase tracking-widest">Date</th>
                      <th className="px-6 py-4 text-xs font-mono text-zinc-500 uppercase tracking-widest">Service</th>
                      <th className="px-6 py-4 text-xs font-mono text-zinc-500 uppercase tracking-widest">Activity</th>
                      <th className="px-6 py-4 text-xs font-mono text-zinc-500 uppercase tracking-widest">Speaker</th>
                      <th className="px-6 py-4 text-xs font-mono text-zinc-500 uppercase tracking-widest">Start</th>
                      <th className="px-6 py-4 text-xs font-mono text-zinc-500 uppercase tracking-widest">End</th>
                      <th className="px-6 py-4 text-xs font-mono text-zinc-500 uppercase tracking-widest">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4 font-mono text-sm text-zinc-400">
                          {new Date(log.date).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 font-bold text-emerald-400 uppercase text-sm">
                          {log.serviceType}
                        </td>
                        <td className="px-6 py-4 font-bold uppercase">
                          {log.activityName}
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-400">
                          {log.speaker || '-'}
                        </td>
                        <td className="px-6 py-4 font-mono text-sm">
                          {new Date(log.startTime).toLocaleTimeString()}
                        </td>
                        <td className="px-6 py-4 font-mono text-sm">
                          {new Date(log.endTime).toLocaleTimeString()}
                        </td>
                        <td className="px-6 py-4 font-mono text-sm text-zinc-400">
                          {Math.floor(log.durationSeconds / 60)}m {log.durationSeconds % 60}s
                        </td>
                      </tr>
                    ))}
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-zinc-500 italic">
                          No history logs found yet. Start a service to begin recording.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="setup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              {/* Left Column: Add New Item & Service Types */}
              <div className="lg:col-span-1 space-y-6">
                {/* Service Types Management */}
                <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6">
                  <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest mb-6">Service Types</h2>
                  
                  <div className="space-y-4 mb-6">
                    {serviceTypes.map(type => (
                      <div 
                        key={type.id} 
                        className={`flex items-center justify-between p-3 rounded-xl border group transition-all ${state.activeServiceTypeId === type.id ? 'bg-emerald-500/10 border-emerald-500' : 'bg-zinc-950 border-white/5'}`}
                      >
                        <div>
                          <div className={`font-bold text-sm ${state.activeServiceTypeId === type.id ? 'text-emerald-400' : 'text-white'}`}>{type.name}</div>
                          <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">
                            {type.startTime} — {type.endTime} ({type.duration}m)
                          </div>
                        </div>
                        <button 
                          onClick={() => deleteServiceType(type.id)}
                          className="p-2 text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3 pt-4 border-t border-white/5">
                    <select
                      value={selectedServiceTypeOption}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setSelectedServiceTypeOption(nextValue);
                        setNewServiceTypeName(nextValue);
                        setServiceTypeMessage(null);
                      }}
                      className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    >
                      <option value="">Select a service type...</option>
                      {serviceTypeOptions.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <input 
                      type="text" 
                      value={newServiceTypeName}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setNewServiceTypeName(nextValue);
                        const matchedOption = serviceTypeOptions.find((name) => name.toLowerCase() === nextValue.trim().toLowerCase()) || '';
                        setSelectedServiceTypeOption(matchedOption);
                        setServiceTypeMessage(null);
                      }}
                      placeholder="Or type a custom service type"
                      className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => setActivePicker({
                          type: 'time',
                          title: 'Set Start Time',
                          onConfirm: (val) => setNewServiceTypeStart(val)
                        })}
                        className="bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-sm text-left flex flex-col"
                      >
                        <span className="text-[10px] text-zinc-500 uppercase">Start Time</span>
                        <span className="font-mono font-bold">{newServiceTypeStart}</span>
                      </button>
                      <button 
                        onClick={() => setActivePicker({
                          type: 'time',
                          title: 'Set End Time',
                          onConfirm: (val) => setNewServiceTypeEnd(val)
                        })}
                        className="bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-sm text-left flex flex-col"
                      >
                        <span className="text-[10px] text-zinc-500 uppercase">End Time</span>
                        <span className="font-mono font-bold">{newServiceTypeEnd}</span>
                      </button>
                    </div>

                    <button 
                      onClick={() => setActivePicker({
                        type: 'duration',
                        title: 'Set Total Duration',
                        onConfirm: (val) => setNewServiceTypeDuration(parseInt(val))
                      })}
                      className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-sm text-left flex flex-col"
                    >
                      <span className="text-[10px] text-zinc-500 uppercase">Total Duration</span>
                      <span className="font-mono font-bold">{newServiceTypeDuration} Minutes</span>
                    </button>
                    <button 
                      onClick={addServiceType}
                      disabled={!isAdminUnlocked}
                      className="w-full bg-white text-black font-bold py-2 rounded-xl hover:bg-zinc-200 transition-colors text-sm"
                    >
                      ADD SERVICE TYPE
                    </button>
                    {serviceTypeMessage && (
                      <div className={`text-xs ${serviceTypeMessage.includes('added') ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {serviceTypeMessage}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6">
                  <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest mb-6">Add New Item</h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-zinc-500 uppercase mb-1.5 block font-bold">Common Items (Combo Box)</label>
                      <select 
                        onChange={(e) => setNewItemTitle(e.target.value)}
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-2.5 focus:outline-none focus:border-emerald-500 mb-2"
                        value={newItemTitle}
                      >
                        <option value="">-- Select or type below --</option>
                        {commonItems.map(item => (
                          <option key={item.id} value={item.title}>{item.title}</option>
                        ))}
                      </select>
                      <input 
                        type="text" 
                        value={newItemTitle}
                        onChange={(e) => setNewItemTitle(e.target.value)}
                        placeholder="Or type custom title..."
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 uppercase mb-1.5 block font-bold">Speaker / Lead</label>
                      <input 
                        type="text" 
                        value={newItemSpeaker}
                        onChange={(e) => setNewItemSpeaker(e.target.value)}
                        placeholder="Name of speaker..."
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-500 uppercase mb-1.5 block font-bold">Duration (Minutes)</label>
                      <button 
                        onClick={() => setActivePicker({
                          type: 'duration',
                          title: 'Set Item Duration',
                          onConfirm: (val) => setNewItemDuration(parseInt(val))
                        })}
                        className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-left flex flex-col"
                      >
                        <span className="font-mono font-bold">{newItemDuration} Minutes</span>
                      </button>
                    </div>
                    <button 
                      onClick={addItem}
                      className="w-full bg-emerald-500 text-black font-black py-4 rounded-xl hover:bg-emerald-400 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                    >
                      <Plus className="w-5 h-5" />
                      ADD TO ORDER
                    </button>
                  </div>
                </div>

                {/* System Settings */}
                <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6">
                  <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest mb-6">System Settings</h2>
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs text-zinc-500 uppercase mb-1.5 block font-bold">Timer Display Threshold</label>
                      <div className="flex items-center gap-3">
                        <input 
                          type="range" 
                          min="30" 
                          max="600" 
                          step="30"
                          value={state.timerThreshold || 120}
                          onChange={(e) => updateServiceState({ timerThreshold: parseInt(e.target.value) })}
                          className="flex-1 accent-emerald-500"
                        />
                        <span className="font-mono font-bold text-emerald-400 w-16 text-right">
                          {Math.floor((state.timerThreshold || 120) / 60)}m
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-600 mt-2 uppercase">
                        Timer will only appear on projection when less than this time remains.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Common Items Management */}
                <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6">
                  <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest mb-6">Manage Common Items</h2>
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={newCommonItemTitle}
                        onChange={(e) => setNewCommonItemTitle(e.target.value)}
                        placeholder="New common item..."
                        className="flex-1 bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500"
                      />
                      <button 
                        onClick={addCommonItem}
                        className="bg-white text-black p-2 rounded-xl hover:bg-zinc-200 transition-colors"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                      {commonItems.map(item => (
                        <div key={item.id} className="flex items-center justify-between bg-white/5 px-3 py-2 rounded-lg group">
                          <span className="text-sm uppercase font-medium">{item.title}</span>
                          <button 
                            onClick={() => deleteCommonItem(item.id)}
                            className="text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Manage Order & Times */}
              <div className="lg:col-span-2">
                <div className="bg-zinc-900 border border-white/5 rounded-2xl overflow-hidden">
                  <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/2">
                    <h2 className="text-sm font-mono text-zinc-500 uppercase tracking-widest">Setup Order of Service</h2>
                    <span className="text-xs text-zinc-500">Drag & Drop coming soon • Use arrows to reorder</span>
                  </div>
                  
                  <div className="divide-y divide-white/5">
                    {items.map((item, index) => (
                      <div 
                        key={item.id}
                        className={`flex items-center gap-4 p-5 hover:bg-white/5 transition-colors group border-l-4 ${state.activeItemId === item.id ? 'bg-emerald-500/5 border-emerald-500' : 'border-transparent'}`}
                      >
                        <div className="flex flex-col items-center gap-1 w-8">
                          <button 
                            disabled={index === 0}
                            onClick={() => moveItem(index, 'up')}
                            className="p-1 hover:text-emerald-500 disabled:opacity-20"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <span className="text-xs font-mono text-zinc-600">{index + 1}</span>
                          <button 
                            disabled={index === items.length - 1}
                            onClick={() => moveItem(index, 'down')}
                            className="p-1 hover:text-emerald-500 disabled:opacity-20"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex-1">
                          <input 
                            type="text"
                            value={item.title}
                            onChange={(e) => updateDoc(doc(db, 'service_items', item.id), { title: e.target.value })}
                            className={`bg-transparent border-none font-bold uppercase tracking-tight text-lg focus:ring-0 w-full p-0 ${state.activeItemId === item.id ? 'text-emerald-400' : 'text-white'}`}
                          />
                          <div className="flex items-center gap-4 mt-2">
                            <div className="flex items-center gap-2 bg-zinc-950 border border-white/5 rounded-lg px-3 py-1">
                              <Clock className="w-3 h-3 text-zinc-500" />
                              <input 
                                type="number"
                                value={item.duration}
                                onChange={(e) => updateItemDuration(item.id, parseInt(e.target.value))}
                                className="bg-transparent border-none w-12 p-0 text-sm focus:ring-0 font-mono"
                              />
                              <span className="text-[10px] text-zinc-600 uppercase">mins</span>
                            </div>
                            <div className="flex items-center gap-2 bg-zinc-950 border border-white/5 rounded-lg px-3 py-1 flex-1">
                              <span className="text-[10px] text-zinc-600 uppercase">Speaker:</span>
                              <input 
                                type="text"
                                value={item.speaker || ''}
                                onChange={(e) => updateDoc(doc(db, 'service_items', item.id), { speaker: e.target.value })}
                                placeholder="Add speaker..."
                                className="bg-transparent border-none flex-1 p-0 text-sm focus:ring-0 font-mono"
                              />
                            </div>
                            {state.activeItemId === item.id && (
                              <span className="text-[10px] bg-emerald-500 text-black px-1.5 py-0.5 rounded font-black animate-pulse">ACTIVE</span>
                            )}
                          </div>
                        </div>

                        <button 
                          onClick={() => deleteItem(item.id)}
                          className="p-3 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {items.length === 0 && (
                    <div className="p-20 text-center text-zinc-600">
                      <LayoutDashboard className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p>No items in the order of service yet.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Info */}
      {!isFullscreen && (
        <footer className="fixed bottom-0 left-0 right-0 h-12 border-t border-white/5 bg-zinc-950/80 backdrop-blur-md flex items-center justify-between px-6 text-[10px] text-zinc-600 uppercase tracking-[0.2em]">
          <div>System Status: Operational</div>
          <div className="flex gap-6">
            <span>{currentTime.toDateString()}</span>
            <span>Church Service Management v1.0</span>
          </div>
        </footer>
      )}

      {/* Global Time Picker Overlay */}
      <TimePicker 
        isOpen={!!activePicker}
        onClose={() => setActivePicker(null)}
        onConfirm={activePicker?.onConfirm || (() => {})}
        title={activePicker?.title || ''}
        type={activePicker?.type || 'duration'}
      />
    </div>
  );
}
