import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, Alert, Image, Platform, Modal, Pressable, Animated, Easing, AppState, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { buildCsvFromOpenings, buildHtmlReport } from './app/src/services/reportService';
import { enqueueChange, flushQueue, isOnline, fetchRemoteMeasurements, mergeMeasurements, loadQueue } from './app/src/services/sync/syncService';
import { SCAN_FIELD_SCHEMA, analyzeWindowPhoto } from './app/src/services/scanner/scanService';
const INSTALL_TYPES = ['Nail fin', 'New construction', 'Retrofit block', 'Retrofit Z-bar'];
const OPENING_TYPES = ['Window', 'Door', 'Skylight'];
const DOOR_SUBTYPES = ['Multi-slide', 'Bi-folding', 'Patio Sliding Door', 'Swinging Door'];
const WINDOW_SUBTYPES = ['DH', 'SH', 'Casement', 'Slider', 'Picture Window', 'Awning', 'Other'];
const SKYLIGHT_SUBTYPES = ['Deck mount', 'Curb mount'];
const SKYLIGHT_CURB_MEAS_TYPES = ['Outside curb dimensions', 'Inside curb dimensions', 'Make size'];
const SKYLIGHT_PITCH_OPTIONS = ['Flat', '2:12', '3:12', '4:12', '5:12', '6:12', '7:12', '8:12', '9:12', '10:12', '12:12'];
const APP_LOGO = require('./app/assets/images/logo-pro-horizontal.png');
const BRAND = {
  orange: '#FF6B00',
  cyan: '#00BFFF',
  dark: '#121212',
  gray: '#2A2A2A'
};
const LOCAL_AUTH_KEY = 'dimensions_local_auth_v1';
const steps = [
  'Job Information',
  'Room',
  'Measurement (W x H)',
  'Jamb thickness',
  'Photo',
  'Net frame or rough opening',
  'Glass type',
  'Glass / Window Conditions :',
  'Grids + design',
  'Installation type',
  'Existing window type',
  'General notes',
  'Overall summary'
];
const getTodayMMDDYYYY = () => {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
};
const newMeasurementId = () => `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const newOpeningUid = () => `o_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const emptyOpening = {
  room: '',
  openingCode: '',
  qty: '1',
  openingType: 'Window',
  subtype: 'DH',
  configA: '',
  configB: '',
  configC: '',
  photoUri: '',
  photoNote: '',
  width: '',
  height: '',
  jamb: '',
  basis: 'Net frame',
  glassType: '',
  glassSelections: [],
  tempered: 'No',
  fireZone: 'No',
  fallingHazard: 'No',
  egress: 'No',
  grids: 'No',
  gridType: '',
  gridDesign: '',
  installType: 'Nail fin',
  existingType: '',
  operation: '',
  notes: '',
  measureMethod: 'manual'
};
export default function App() {
  const [step, setStep] = useState(0);
  const [job, setJob] = useState({
    address: '',
    jobName: '',
    measureDate: getTodayMMDDYYYY(),
    measuredBy: '',
    onSiteContact: ''
  });
  const [opening, setOpening] = useState(emptyOpening);
  const [openings, setOpenings] = useState([]);
  const [editIndex, setEditIndex] = useState(null);
  const [editOpeningUid, setEditOpeningUid] = useState(null);
 copy
  const [showReportChooser, setShowReportChooser] = useState(false);
  const [savedJobs, setSavedJobs] = useState([]);
  const [trashJobs, setTrashJobs] = useState([]);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [validationError, setValidationError] = useState('');
  const [showHome, setShowHome] = useState(true);
  const [showIntro, setShowIntro] = useState(true);
  const [draftData, setDraftData] = useState(null);
  const logoDropY = useRef(new Animated.Value(-240)).current;
  const logoScale = useRef(new Animated.Value(1.6)).current;
  const logoTilt = useRef(new Animated.Value(-12)).current;
  const titleDropY = useRef(new Animated.Value(-160)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const introOpacity = useRef(new Animated.Value(1)).current;
  const dustOpacity = useRef(new Animated.Value(0)).current;
  const dustSpread = useRef(new Animated.Value(0.6)).current;
  const [introReady, setIntroReady] = useState(false);
  const [measurementId, setMeasurementId] = useState(newMeasurementId());
  const [qtyPickerIndex, setQtyPickerIndex] = useState(null);
  const [qtyCustomValue, setQtyCustomValue] = useState('');
  const [confirmState, setConfirmState] = useState({ visible: false, message: '', onConfirm: null });
  const [showJobInfoEditor, setShowJobInfoEditor] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
 error
  const [pendingMeasurementIds, setPendingMeasurementIds] = useState(new Set());
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState(null);
  const [lastSyncError, setLastSyncError] = useState('');
  const [deviceId, setDeviceId] = useState('unknown');
  const [cloudSavedAtById, setCloudSavedAtById] = useState({});
  const [cloudOpeningsCountById, setCloudOpeningsCountById] = useState({});
  const [authLoading, setAuthLoading] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
const latestJobRef = useRef(job);
  const latestOpeningsRef = useRef(openings);
  const latestMeasurementIdRef = useRef(measurementId);
  const latestSavedJobsRef = useRef(savedJobs);
const totalSteps = steps.length - 1; // summary is final view
  const isSummary = step === totalSteps;
const qtyOf = (o) => {
    const n = Number(o?.qty);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  const isWindowType = (o) => ((o?.openingType || '').toLowerCase().includes('window'));
  const isDoorType = (o) => {
    const t = (o?.openingType || '').toLowerCase();
    return t.includes('door') || t.includes('slider') || t.includes('bi-fold') || t.includes('bifold') || t.includes('multi-slide');
  };
  const isSkylightType = (o) => ((o?.openingType || '').toLowerCase().includes('skylight'));

    windows: list.filter(isWindowType).reduce((sum, x) => sum + qtyOf(x), 0),
    doors: list.filter(isDoorType).reduce((sum, x) => sum + qtyOf(x), 0),
    skylights: list.filter(isSkylightType).reduce((sum, x) => sum + qtyOf(x), 0),
    total: list.reduce((sum, x) => sum + qtyOf(x), 0),
    lines: list.length
  });
const sanitizeMeasurementForCloud = (m) => ({
    ...m,
 []).map(o => ({
      ...o,
      // Keep compressed embedded photo for cross-device sync; drop local-only URI.
 '',
      photoUri: ''
    }))
  });
const counts = useMemo(() => buildCounts(openings), [openings]);
  const windowCount = counts.windows;
  const doorCount = counts.doors;
  const skylightCount = counts.skylights;
const getMeasurementSyncStatus = (m) => {
    if (!m?.id) return 'pending';
    if (pendingMeasurementIds.has(m.id)) return 'pending';
 0;
 0;
 0);
 0);
const tsConfirmed = cloudTs >= localTs && cloudTs > 0;
    const countConfirmed = localCount > 0 ? cloudCount >= localCount : true;
// Green check only after cloud confirms both recency and expected opening-count integrity.
    return tsConfirmed && countConfirmed ? 'synced' : 'pending';
  };
 { id: measurementId, savedAt: 0 });
const archiveKey = 'dimensions_pro_archive_v1';
  const trashKey = 'dimensions_pro_trash_v1';
  const draftKey = 'dimensions_pro_draft_v1';
const refreshPendingMeasurements = () => {
    try {
 [];
      const ids = new Set(
        queue
          .filter(item => item?.entity === 'measurement' && item?.entityId)
          .map(item => item.entityId)
      );
      setPendingMeasurementIds(ids);
      setPendingQueueCount(queue.length);
 '';
      setLastSyncError(latestErr ? String(latestErr).slice(0, 120) : '');
    } catch {
      setPendingMeasurementIds(new Set());
      setPendingQueueCount(0);
    }
  };
const syncNow = async () => {
    if (!isOnline()) {
      setOfflineMode(true);
      setSyncState('offline');
      refreshPendingMeasurements();
      return { ok: false, offline: true, flushed: 0, remaining: null };
    }
setSyncState('syncing');
    try {
      const result = await flushQueue();
      setSyncState(result.remaining === 0 ? 'synced' : 'error');
      if (result.ok) {
        setLastCloudSyncAt(new Date().toISOString());
        setLastSyncError('');
      }
      refreshPendingMeasurements();
      return result;
    } catch {
      setSyncState('error');
      refreshPendingMeasurements();
      return { ok: false, offline: false, flushed: 0, remaining: null };
    }
  };
 syncState === 'error';
 syncState === 'offline'
    ? "You're working offline — saving locally now. Cloud backup will resume instantly when reception returns."
    : syncState === 'syncing'
      ? 'Saving to cloud backup…'
      : 'Saved locally. Cloud backup retrying in background…';
const pruneToOneYear = (items) => {
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
 []).filter(x => new Date(x.savedAt).getTime() >= cutoff);
  };
const stripPhotosFromMeasurement = (m) => ({
    ...m,
 []).map(o => ({ ...o, photoUri: '' }))
  });
 []).map(stripPhotosFromMeasurement);
const persistArchive = async (items) => {
    const cleaned = pruneToOneYear(items);
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      const raw = JSON.stringify(cleaned);
      try {
        localStorage.setItem(archiveKey, raw);
      } catch {
        // Fallback for storage quota pressure (usually from many/large photo URIs):
        // persist all non-photo data so measurements/items never disappear.
        localStorage.setItem(archiveKey, JSON.stringify(toLightArchive(cleaned)));
      }
    } else {
      const path = `${FileSystem.documentDirectory}field_measure_archive.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(cleaned), { encoding: FileSystem.EncodingType.UTF8 });
    }
    setSavedJobs(cleaned);
  };
const persistTrash = async (items) => {
 []).filter(x => x && x.trashedAt);
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.setItem(trashKey, JSON.stringify(cleaned));
    } else {
      const path = `${FileSystem.documentDirectory}field_measure_trash.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(cleaned), { encoding: FileSystem.EncodingType.UTF8 });
    }
    setTrashJobs(cleaned);
  };
const purgeExpiredTrash = async (items = []) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const kept = [];
    const expired = [];
 [])) {
 0).getTime();
      if (ts && ts < cutoff) expired.push(t); else kept.push(t);
    }
if (expired.length) {
      for (const t of expired) {
        enqueueChange({ entity: 'measurement', entityId: t.id, op: 'delete', payload: null });
      }
      await syncNow();
    }
return kept;
  };
const loadArchive = async () => {
    try {
      let parsed = [];
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
 '[]');
      } else {
        const path = `${FileSystem.documentDirectory}field_measure_archive.json`;
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists) {
          parsed = JSON.parse(await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 }));
        }
      }
// Load trash first so deleted jobs cannot reappear from remote merge.
      let trashParsed = [];
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
 '[]');
      } else {
        const tPath = `${FileSystem.documentDirectory}field_measure_trash.json`;
        const tInfo = await FileSystem.getInfoAsync(tPath);
        if (tInfo.exists) {
          trashParsed = JSON.parse(await FileSystem.readAsStringAsync(tPath, { encoding: FileSystem.EncodingType.UTF8 }));
        }
      }
      const cleanedTrash = await purgeExpiredTrash(trashParsed);
      await persistTrash(cleanedTrash);
 []).map(t => t.id));
let merged = pruneToOneYear(parsed).filter(x => !trashedIds.has(x.id));
if (isOnline()) {
        try {
          await syncNow();
          const remote = pruneToOneYear(await fetchRemoteMeasurements());
          const remoteTsMap = {};
          const remoteCountMap = {};
          for (const r of remote) {
 null;
 0);
          }
          setCloudSavedAtById(remoteTsMap);
          setCloudOpeningsCountById(remoteCountMap);
// Cloud-authoritative when online so all devices converge to same active stack.
          // Keep only local pending upserts (not yet uploaded) on top of remote.
 [];
          const pendingUpserts = queue
            .filter(item => item?.entity === 'measurement' && item?.op === 'upsert' && item?.payload)
            .map(item => item.payload);
const remoteById = new Map(remote.map(x => [x.id, x]));
          for (const p of pendingUpserts) {
            remoteById.set(p.id, p);
          }
merged = Array.from(remoteById.values())
            .filter(x => !trashedIds.has(x.id))
 0));
        } catch {
          // keep local data if remote pull fails
        }
      }
setSavedJobs(merged);
      await persistArchive(merged);
    } catch {
      setSavedJobs([]);
      setCloudSavedAtById({});
      setCloudOpeningsCountById({});
    }
  };
const persistDraft = async (payload) => {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      const raw = JSON.stringify(payload);
      try {
        localStorage.setItem(draftKey, raw);
      } catch {
        const lightweight = {
          ...payload,
          opening: payload.opening ? { ...payload.opening, photoUri: '' } : payload.opening,
 []).map(o => ({ ...o, photoUri: '' }))
        };
        localStorage.setItem(draftKey, JSON.stringify(lightweight));
      }
    } else {
      const path = `${FileSystem.documentDirectory}field_measure_draft.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(payload), { encoding: FileSystem.EncodingType.UTF8 });
    }
    setDraftData(payload);
  };
const clearDraft = async () => {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.removeItem(draftKey);
    } else {
      const path = `${FileSystem.documentDirectory}field_measure_draft.json`;
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
    }
    setDraftData(null);
  };
const loadDraft = async () => {
    try {
      let parsed = null;
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
 'null');
      } else {
        const path = `${FileSystem.documentDirectory}field_measure_draft.json`;
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists) {
          parsed = JSON.parse(await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 }));
        }
      }
 null);
    } catch {
      setDraftData(null);
    }
  };
useEffect(() => {
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(LOCAL_AUTH_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.username) {
            setAuthUser({ email: parsed.username });
          }
        }
      }
    } catch {}
    setAuthLoading(false);
  }, []);
useEffect(() => {
    // Always start from main page on app load.
    setShowHome(true);
    loadArchive();
    loadDraft();
    refreshPendingMeasurements();
try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        const key = 'field_measure_device_id_v1';
        let id = localStorage.getItem(key);
        if (!id) {
          id = `dev_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36).slice(-4)}`;
          localStorage.setItem(key, id);
        }
        setDeviceId(id);
      } else {
 'native');
      }
    } catch {
      setDeviceId('unknown');
    }
Animated.sequence([
      Animated.delay(120),
      Animated.parallel([
        Animated.spring(logoDropY, {
          toValue: 0,
          speed: 24,
          bounciness: 5,
          useNativeDriver: true
        }),
        Animated.sequence([
          Animated.timing(logoScale, {
            toValue: 1.08,
            duration: 140,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true
          }),
          Animated.timing(logoScale, {
            toValue: 1,
            duration: 90,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true
          })
        ]),
        Animated.timing(logoTilt, {
          toValue: 0,
          duration: 180,
          easing: Easing.out(Easing.cubic),
