import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, Alert, Image, Platform, Modal, Pressable, Animated, Easing, AppState, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { buildCsvFromOpenings, buildHtmlReport } from '../services/reportService';
import { enqueueChange, flushQueue, isOnline, fetchRemoteMeasurements, initializeSyncQueue, loadQueueFresh } from '../services/sync/syncService';
import { SCAN_FIELD_SCHEMA, analyzeWindowPhoto } from '../services/scanner/scanService';

const INSTALL_TYPES = ['Nail fin', 'New construction', 'Retrofit block', 'Retrofit Z-bar'];
const OPENING_TYPES = ['Window', 'Door', 'Skylight'];
const DOOR_SUBTYPES = ['Multi-slide', 'Bi-folding', 'Patio Sliding Door', 'Swinging Door'];
const WINDOW_SUBTYPES = ['DH', 'SH', 'Casement', 'Slider', 'Picture Window', 'Awning', 'Other'];
const SKYLIGHT_SUBTYPES = ['Deck mount', 'Curb mount'];
const SKYLIGHT_CURB_MEAS_TYPES = ['Outside curb dimensions', 'Inside curb dimensions', 'Make size'];
const SKYLIGHT_PITCH_OPTIONS = ['Flat', '2:12', '3:12', '4:12', '5:12', '6:12', '7:12', '8:12', '9:12', '10:12', '12:12'];
const APP_LOGO = require('../../assets/images/logo-pro-horizontal.png');
const BRAND = {
  orange: '#FF6B00',
  cyan: '#00BFFF',
  dark: '#121212',
  gray: '#2A2A2A'
};
const UI = {
  bg: '#0f172a',
  surface: '#172033',
  surfaceWarm: '#1e293b',
  surfaceSoft: '#26364d',
  faint: '#26364d',
  ink: '#f8fafc',
  muted: '#cbd5e1',
  border: '#334155',
  borderStrong: '#475569',
  primary: '#f97316',
  primaryDeep: '#fb923c',
  secondary: '#06b6d4',
  secondarySoft: '#12313c',
  danger: '#dc2626',
  slate: '#334155',
  logoPlate: '#0b1220'
};
const PASSWORD_EYE_ICON = require('../../assets/images/password-eye.svg');
const PASSWORD_EYE_OFF_ICON = require('../../assets/images/password-eye-off.svg');
const LOCAL_AUTH_KEY = 'dimensions_pro_auth_v1';

const steps = [
  'Job Information',
  'Room',
  'Measurement (W x H)',
  'Jamb thickness',
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
  photoDataUri: '',
  extraPhotoUri: '',
  extraPhotoDataUri: '',
  photoNote: '',
  width: '',
  height: '',
  scannedWidth: '',
  scannedHeight: '',
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
  measureMethod: 'snap'
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
  const [entryMode, setEntryMode] = useState('create'); // create | edit | copy
  const [showReportChooser, setShowReportChooser] = useState(false);
  const [savedJobs, setSavedJobs] = useState([]);
  const [trashJobs, setTrashJobs] = useState([]);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [validationError, setValidationError] = useState('');
  const [showHome, setShowHome] = useState(true);
  const [showIntro, setShowIntro] = useState(false);
  const [draftData, setDraftData] = useState(null);
  const logoDropY = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(1)).current;
  const logoTilt = useRef(new Animated.Value(0)).current;
  const titleDropY = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(1)).current;
  const introOpacity = useRef(new Animated.Value(0)).current;
  const dustOpacity = useRef(new Animated.Value(0)).current;
  const dustSpread = useRef(new Animated.Value(0.6)).current;
  const [introReady, setIntroReady] = useState(true);
  const [measurementId, setMeasurementId] = useState(newMeasurementId());
  const [qtyPickerIndex, setQtyPickerIndex] = useState(null);
  const [qtyCustomValue, setQtyCustomValue] = useState('');
  const [confirmState, setConfirmState] = useState({ visible: false, title: '', message: '', confirmLabel: 'Confirm', cancelLabel: 'Cancel', onConfirm: null });
  const [showJobInfoEditor, setShowJobInfoEditor] = useState(false);
  const [openingDetailIndex, setOpeningDetailIndex] = useState(null);
  const [offlineMode, setOfflineMode] = useState(false);
  const [syncState, setSyncState] = useState('synced'); // syncing | synced | offline | error
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
  const [showPassword, setShowPassword] = useState(false);
  const [stayLoggedIn, setStayLoggedIn] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [measureMethodTouched, setMeasureMethodTouched] = useState(false);

  const latestJobRef = useRef(job);
  const latestOpeningsRef = useRef(openings);
  const latestMeasurementIdRef = useRef(measurementId);
  const latestSavedJobsRef = useRef(savedJobs);

  const totalSteps = steps.length - 1; // summary is final view
  const lastEntryStep = totalSteps - 1;
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

  const buildCounts = (list = []) => ({
    windows: list.filter(isWindowType).reduce((sum, x) => sum + qtyOf(x), 0),
    doors: list.filter(isDoorType).reduce((sum, x) => sum + qtyOf(x), 0),
    skylights: list.filter(isSkylightType).reduce((sum, x) => sum + qtyOf(x), 0),
    total: list.reduce((sum, x) => sum + qtyOf(x), 0),
    lines: list.length
  });

  const sanitizeMeasurementForCloud = (m) => ({
    ...m,
    openings: (m.openings || []).map(o => ({
      ...o,
      // Keep compressed embedded photo for cross-device sync; drop local-only URI.
      photoDataUri: o.photoDataUri || '',
      photoUri: '',
      extraPhotoDataUri: o.extraPhotoDataUri || '',
      extraPhotoUri: ''
    }))
  });

  const counts = useMemo(() => buildCounts(openings), [openings]);
  const windowCount = counts.windows;
  const doorCount = counts.doors;
  const skylightCount = counts.skylights;

  const getMeasurementSyncStatus = (m) => {
    if (!m?.id) return 'pending';
    if (pendingMeasurementIds.has(m.id)) return 'pending';

    const localTs = new Date(m?.savedAt || 0).getTime() || 0;
    const cloudTs = new Date(cloudSavedAtById[m.id] || 0).getTime() || 0;

    const localCount = Array.isArray(m?.openings) ? m.openings.length : Number(m?.counts?.lines || 0);
    const cloudCount = Number(cloudOpeningsCountById[m.id] || 0);

    const tsConfirmed = cloudTs >= localTs && cloudTs > 0;
    const countConfirmed = localCount > 0 ? cloudCount >= localCount : true;

    // Green check only after cloud confirms both recency and expected opening-count integrity.
    return tsConfirmed && countConfirmed ? 'synced' : 'pending';
  };

  const currentMeasurementSyncStatus = getMeasurementSyncStatus(savedJobs.find(x => x.id === measurementId) || { id: measurementId, savedAt: 0 });
  const selectedOpeningDetail = openingDetailIndex !== null ? openings[openingDetailIndex] || null : null;

  const archiveKey = 'dimensions_pro_archive_v1';
  const trashKey = 'dimensions_pro_trash_v1';
  const draftKey = 'dimensions_pro_draft_v1';

  const refreshPendingMeasurements = async () => {
    try {
      const queue = await loadQueueFresh();
      const ids = new Set(
        queue
          .filter(item => item?.entity === 'measurement' && item?.entityId)
          .map(item => item.entityId)
      );
      setPendingMeasurementIds(ids);
      setPendingQueueCount(queue.length);
      const latestErr = [...queue].reverse().find(q => q?.lastError)?.lastError || '';
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
      await refreshPendingMeasurements();
      return { ok: false, offline: true, flushed: 0, remaining: null };
    }

    setSyncState('syncing');
    try {
      const result = await flushQueue();
      setSyncState(result.remaining === 0 ? 'synced' : 'error');
      if (result.ok) {
        setLastCloudSyncAt(new Date().toISOString());
        setLastSyncError('');
        try {
          const remote = pruneToOneYear(await fetchRemoteMeasurements());
          const remoteTsMap = {};
          const remoteCountMap = {};
          for (const r of remote) {
            remoteTsMap[r.id] = r.savedAt || null;
            remoteCountMap[r.id] = Array.isArray(r.openings) ? r.openings.length : Number(r?.counts?.lines || 0);
          }
          setCloudSavedAtById(remoteTsMap);
          setCloudOpeningsCountById(remoteCountMap);
        } catch (e) {
          setLastSyncError(String(e?.message || e).slice(0, 120));
        }
      }
      await refreshPendingMeasurements();
      return result;
    } catch (e) {
      setSyncState('error');
      setLastSyncError(String(e?.message || e).slice(0, 120));
      await refreshPendingMeasurements();
      return { ok: false, offline: false, flushed: 0, remaining: null };
    }
  };

  const showSyncBanner = offlineMode || syncState === 'syncing' || syncState === 'error';
  const syncBannerText = offlineMode || syncState === 'offline'
    ? "You're working offline — saving locally now. Cloud backup will resume instantly when reception returns."
    : syncState === 'syncing'
      ? 'Saving to cloud backup…'
      : `Saved locally. Cloud backup retrying in background${lastSyncError ? `: ${lastSyncError}` : '…'}`;

  const pruneToOneYear = (items) => {
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    return (items || []).filter(x => new Date(x.savedAt).getTime() >= cutoff);
  };

  const stripPhotosFromMeasurement = (m) => ({
    ...m,
    openings: (m.openings || []).map(o => ({ ...o, photoUri: '', extraPhotoUri: '' }))
  });

  const toLightArchive = (arr) => (arr || []).map(stripPhotosFromMeasurement);

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
    const cleaned = (items || []).filter(x => x && x.trashedAt);
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
    for (const t of (items || [])) {
      const ts = new Date(t.trashedAt || 0).getTime();
      if (ts && ts < cutoff) expired.push(t); else kept.push(t);
    }

    if (expired.length) {
      for (const t of expired) {
        await enqueueChange({ entity: 'measurement', entityId: t.id, op: 'delete', payload: null });
      }
      await syncNow();
    }

    return kept;
  };

  const loadArchive = async () => {
    try {
      let parsed = [];
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        parsed = JSON.parse(localStorage.getItem(archiveKey) || '[]');
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
        trashParsed = JSON.parse(localStorage.getItem(trashKey) || '[]');
      } else {
        const tPath = `${FileSystem.documentDirectory}field_measure_trash.json`;
        const tInfo = await FileSystem.getInfoAsync(tPath);
        if (tInfo.exists) {
          trashParsed = JSON.parse(await FileSystem.readAsStringAsync(tPath, { encoding: FileSystem.EncodingType.UTF8 }));
        }
      }
      const cleanedTrash = await purgeExpiredTrash(trashParsed);
      await persistTrash(cleanedTrash);
      const trashedIds = new Set((cleanedTrash || []).map(t => t.id));

      let merged = pruneToOneYear(parsed).filter(x => !trashedIds.has(x.id));

      if (isOnline()) {
        try {
          await syncNow();
          const remote = pruneToOneYear(await fetchRemoteMeasurements());
          const remoteTsMap = {};
          const remoteCountMap = {};
          for (const r of remote) {
            remoteTsMap[r.id] = r.savedAt || null;
            remoteCountMap[r.id] = Array.isArray(r.openings) ? r.openings.length : Number(r?.counts?.lines || 0);
          }
          setCloudSavedAtById(remoteTsMap);
          setCloudOpeningsCountById(remoteCountMap);

          // Cloud-authoritative when online so all devices converge to same active stack.
          // Keep only local pending upserts (not yet uploaded) on top of remote.
          const queue = await loadQueueFresh();
          const pendingUpserts = queue
            .filter(item => item?.entity === 'measurement' && item?.op === 'upsert' && item?.payload)
            .map(item => item.payload);

          const remoteById = new Map(remote.map(x => [x.id, x]));
          for (const p of pendingUpserts) {
            remoteById.set(p.id, p);
          }

          merged = Array.from(remoteById.values())
            .filter(x => !trashedIds.has(x.id))
            .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
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
          opening: payload.opening ? { ...payload.opening, photoUri: '', extraPhotoUri: '' } : payload.opening,
          openings: (payload.openings || []).map(o => ({ ...o, photoUri: '', extraPhotoUri: '' }))
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
        parsed = JSON.parse(localStorage.getItem(draftKey) || 'null');
      } else {
        const path = `${FileSystem.documentDirectory}field_measure_draft.json`;
        const info = await FileSystem.getInfoAsync(path);
        if (info.exists) {
          parsed = JSON.parse(await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 }));
        }
      }
      setDraftData(parsed || null);
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
            setStayLoggedIn(true);
          }
        }
      }
    } catch {}
    setAuthLoading(false);
  }, []);

  useEffect(() => {
    // Always start from main page on app load.
    setShowHome(true);
    initializeSyncQueue()
      .then(() => refreshPendingMeasurements())
      .catch(() => {});
    loadArchive();
    loadDraft();

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
        setDeviceId(Platform.OS || 'native');
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
          useNativeDriver: true
        }),
        Animated.delay(0)
      ]),
      Animated.delay(120),
      Animated.parallel([
        Animated.spring(titleDropY, {
          toValue: 0,
          speed: 20,
          bounciness: 4,
          useNativeDriver: true
        }),
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 150,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true
        })
      ])
    ]).start(() => setIntroReady(true));
  }, []);

  useEffect(() => {
    latestJobRef.current = job;
    latestOpeningsRef.current = openings;
    latestMeasurementIdRef.current = measurementId;
    latestSavedJobsRef.current = savedJobs;
  }, [job, openings, measurementId, savedJobs]);

  useEffect(() => {
    if (step !== 2) return;
    if (measureMethodTouched) return;
    if (opening.measureMethod === 'snap') return;
    setOpening(prev => ({ ...prev, measureMethod: 'snap' }));
  }, [step, opening.measureMethod, measureMethodTouched]);

  useEffect(() => {
    if (!isSummary) return;
    if (!job.jobName || !job.address || !openings.length) return;
    const t = setTimeout(() => {
      upsertCurrentJobToArchive(true);
    }, 300);
    return () => clearTimeout(t);
  }, [isSummary, job, openings]);

  // Durable autosave: persist snapshot during active editing too (not only summary/exit).
  useEffect(() => {
    if (!job.jobName || !job.address || !openings.length) return;
    const t = setTimeout(() => {
      persistSnapshotOnExit();
    }, 180);
    return () => clearTimeout(t);
  }, [job, openings, measurementId]);

  const stepValid = useMemo(() => {
    switch (step) {
      case 0: return !!job.address && !!job.jobName && isValidDateMMDDYYYY(job.measureDate);
      case 1: return !!opening.room && !!opening.openingCode && isValidQty(opening.qty) && !!buildOperation(opening);
      case 2:
        return opening.measureMethod === 'manual'
          ? (isValidInchFractionMeasurement(opening.width) && isValidInchFractionMeasurement(opening.height))
          : !!(opening.photoUri || opening.photoDataUri) && isValidInchFractionMeasurement(opening.width) && isValidInchFractionMeasurement(opening.height);
      case 3: return opening.openingType === 'Skylight' ? true : isValidMeasurement(opening.jamb);
      case 4: return opening.openingType === 'Skylight' ? true : !!opening.basis;
      case 5: return opening.openingType === 'Skylight' ? true : (opening.glassSelections.length >= 1 && opening.glassSelections.length <= 2);
      case 6: return opening.openingType === 'Skylight' ? true : (!!opening.tempered && !!opening.fireZone && !!opening.fallingHazard && !!opening.egress);
      case 7: return opening.openingType === 'Skylight' ? true : (opening.grids === 'No' || (!!opening.gridType && !!opening.gridDesign));
      case 8: return opening.openingType === 'Skylight' ? true : !!opening.installType;
      case 9: return true;
      case 10: return true;
      default: return true;
    }
  }, [step, job, opening]);

  const isStepRelevant = (s, openingType) => {
    if (openingType !== 'Skylight') return true;
    // For skylights, skip window/door-only stages.
    const skylightSkipped = [3, 4, 5, 6, 7, 8]; // jamb, basis, glass, tempered/fire, grids, install
    return !skylightSkipped.includes(s);
  };

  const getStepError = () => {
    switch (step) {
      case 0: return 'Please fill Job Name, Address, and Date in MM-DD-YYYY format.';
      case 1: return 'Please complete Room, Opening ID, Quantity, and subtype selection details.';
      case 2:
        return opening.measureMethod === 'manual'
          ? 'Please enter valid Width and Height using inches and fractions only (for example, 23 1/2).'
          : 'Please capture or pick a photo, then tap Scan until width and height are detected. Use Manual Entry if you need to type dimensions.';
      case 3: return opening.openingType === 'Skylight' ? '' : 'Please enter a valid Jamb size (fractions with optional brackets, or up to 2 decimals).';
      case 5: return 'Please choose 1 or 2 glass options.';
      case 7: return 'Grid type and design are required when Grids = Yes.';
      default: return 'Please complete required fields before continuing.';
    }
  };

  const failSave = (title, message, targetStep = null) => {
    setValidationError(`${title}: ${message}`);
    if (typeof targetStep === 'number') {
      setStep(targetStep);
    }
    Alert.alert(title, message);
    return false;
  };

  const next = async () => {
    if (!stepValid) {
      setValidationError(getStepError());
      return;
    }
    setValidationError('');
    if (step >= totalSteps) return;
    let ns = step + 1;
    while (ns < totalSteps && !isStepRelevant(ns, opening.openingType)) ns += 1;

    if (ns >= totalSteps) {
      await finishOpening();
      return;
    }

    setStep(Math.min(ns, totalSteps));
  };

  const back = () => {
    setValidationError('');
    let ps = step - 1;
    while (ps > 0 && !isStepRelevant(ps, opening.openingType)) ps -= 1;
    setStep(Math.max(0, ps));
  };

  const saveCurrentOpening = async () => {
    const resolvedOperation = buildOperation(opening) || opening.operation;
    const resolvedGlass = (opening.glassSelections || []).join(' + ') || opening.glassType;
    if (!opening.room || !opening.openingCode || !isValidQty(opening.qty) || !resolvedOperation) {
      const missing = [
        !opening.room ? 'Room' : null,
        !opening.openingCode ? 'Opening ID' : null,
        !isValidQty(opening.qty) ? 'Quantity' : null,
        !resolvedOperation ? 'Operation/configuration' : null
      ].filter(Boolean);
      return failSave('Missing room details', `Please complete: ${missing.join(', ')}.`, 1);
    }
    if (!opening.width || !opening.height) {
      return failSave('Dimensions required', 'Please scan a photo until width and height are detected, or switch to Manual Entry and type the dimensions.', 2);
    }
    if (!isValidInchFractionMeasurement(opening.width) || !isValidInchFractionMeasurement(opening.height)) {
      return failSave('Invalid size format', 'Width and height must use inches and fractions only, like 23 1/2 or 48 1/4.', 2);
    }

    if (opening.openingType !== 'Skylight') {
      if (!opening.jamb) {
        return failSave('Jamb required', 'Please enter jamb thickness.', 3);
      }
      if (!isValidMeasurement(opening.jamb)) {
        return failSave('Invalid jamb format', 'Jamb must use a valid fraction or decimal, like 4 9/16 or 4.56.', 3);
      }
      if (!opening.basis) {
        return failSave('Measurement basis required', 'Please choose Net frame or Rough opening.', 4);
      }
      if (!opening.glassSelections?.length || opening.glassSelections.length > 2) {
        return failSave('Glass options required', 'Please choose 1 or 2 glass options.', 5);
      }
      if (!opening.tempered || !opening.fireZone || !opening.fallingHazard || !opening.egress) {
        return failSave('Condition options required', 'Please complete tempered, fire zone, falling hazard, and egress selections.', 6);
      }
      if (opening.grids === 'Yes' && (!opening.gridType || !opening.gridDesign)) {
        return failSave('Grid details required', 'Please add grid type and design.', 7);
      }
      if (!opening.installType) {
        return failSave('Installation type required', 'Please choose an installation type.', 8);
      }
    }

    if (opening.openingType === 'Skylight') {
      if (!resolvedOperation) {
        return failSave('Skylight details required', 'Please complete skylight pitch and roof type selections.', 1);
      }
    }

    const finalOpening = {
      ...opening,
      _uid: opening._uid || newOpeningUid(),
      tempered: opening.openingType === 'Door' ? 'Yes' : opening.tempered,
      operation: resolvedOperation,
      glassType: resolvedGlass
    };

    let nextOpenings = [...openings];
    if (editOpeningUid) {
      let matched = false;
      nextOpenings = nextOpenings.map(o => {
        if (o._uid === editOpeningUid) {
          matched = true;
          return finalOpening;
        }
        return o;
      });
      if (!matched && editIndex !== null && editIndex >= 0 && editIndex < nextOpenings.length) {
        nextOpenings[editIndex] = finalOpening;
      }
    } else if (editIndex === null) {
      nextOpenings.push(finalOpening);
    } else {
      nextOpenings[editIndex] = finalOpening;
    }

    setOpenings(nextOpenings);

    // Persist immediately so quick navigation can't lose this edit.
    const payload = {
      id: measurementId,
      savedAt: new Date().toISOString(),
      job,
      openings: nextOpenings,
      counts: buildCounts(nextOpenings)
    };
    const nextArchive = [payload, ...savedJobs.filter(x => x.id !== payload.id)];
    // Update in-memory archive immediately so main page reflects changes instantly.
    setSavedJobs(pruneToOneYear(nextArchive));

    try {
      await persistArchive(nextArchive);
      await enqueueChange({ entity: 'measurement', entityId: payload.id, op: 'upsert', payload: sanitizeMeasurementForCloud(payload) });
      const syncResult = await syncNow();
      if (syncResult?.ok) {
        setCloudSavedAtById(prev => ({ ...prev, [payload.id]: payload.savedAt }));
        setCloudOpeningsCountById(prev => ({ ...prev, [payload.id]: nextOpenings.length }));
      } else {
        Alert.alert('Saved locally', 'Measurement is saved on this device and will upload to cloud automatically when connection/service is available.');
      }
    } catch {
      Alert.alert('Saved locally', 'Measurement is saved on this device. Cloud sync will retry automatically.');
    }

    setEditIndex(null);
    setEditOpeningUid(null);
    setEntryMode('create');
    setMeasureMethodTouched(false);
    setOpening(emptyOpening);
    setValidationError('');
    return true;
  };

  const finishOpening = async () => {
    const ok = await saveCurrentOpening();
    if (ok) {
      await clearDraft();
      setStep(totalSteps);
      Alert.alert('Opening saved', `This project now has ${openings.length + (editIndex === null ? 1 : 0)} saved opening${openings.length + (editIndex === null ? 1 : 0) === 1 ? '' : 's'}.`);
    }
  };

  const saveAndExit = async () => {
    const ok = await saveCurrentOpening();
    if (ok) {
      await clearDraft();
      setStep(totalSteps);
      return;
    }

    // If not complete yet, store as unfinished draft and return home.
    const payload = {
      savedAt: new Date().toISOString(),
      measurementId,
      step,
      job,
      opening,
      openings,
      editIndex,
      editOpeningUid,
      entryMode
    };
    await persistDraft(payload);
    setShowHome(true);
  };

  const resumeDraft = () => {
    if (!draftData) return;
    setMeasureMethodTouched(false);
    setScanMessage('');
    setMeasurementId(draftData.measurementId || newMeasurementId());
    setJob({ ...(draftData.job || job), measureDate: normalizeDateToMMDDYYYY(draftData.job?.measureDate) || getTodayMMDDYYYY() });
    setOpening(draftData.opening || emptyOpening);
    setOpenings(draftData.openings || []);
    setEditIndex(draftData.editIndex ?? null);
    setEditOpeningUid(draftData.editOpeningUid ?? null);
    setEntryMode(draftData.entryMode || 'create');
    setStep(typeof draftData.step === 'number' ? draftData.step : 0);
    setValidationError('');
    setShowHome(false);
  };

  const startNewMeasurement = async () => {
    await clearDraft();
    setMeasureMethodTouched(false);
    setScanMessage('');
    setMeasurementId(newMeasurementId());
    setShowHome(false);
    setShowArchive(false);
    setArchiveQuery('');
    setValidationError('');
    setEditIndex(null);
    setEditOpeningUid(null);
    setEntryMode('create');
    setOpening(emptyOpening);
    setOpenings([]);
    setJob({
      address: '',
      jobName: '',
      measureDate: getTodayMMDDYYYY(),
      measuredBy: '',
      onSiteContact: ''
    });
    setStep(0);
  };

  const addAnother = () => {
    setShowHome(false);
    setEditIndex(null);
    setEditOpeningUid(null);
    setEntryMode('create');
    setMeasureMethodTouched(false);
    setScanMessage('');
    setOpening(emptyOpening);
    setStep(1);
  };

  const backToMainPage = async () => {
    // Persist locally first (reliable), then navigate, then push cloud in background.
    let payload = null;
    try {
      payload = await upsertLocalArchiveOnly({ silent: true });
    } catch {}

    setShowHome(true);

    if (payload) {
      await enqueueChange({ entity: 'measurement', entityId: payload.id, op: 'upsert', payload: sanitizeMeasurementForCloud(payload) });
      syncNow().catch(() => {});
    }
  };

  const enterFromIntro = () => {
    if (!introReady) return;
    Animated.timing(introOpacity, {
      toValue: 0,
      duration: 260,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true
    }).start(() => setShowIntro(false));
  };

  const editOpening = (idx) => {
    const target = openings[idx];
    if (!target) return;

    // Ensure every editable row has a stable uid.
    const uid = target._uid || newOpeningUid();
    if (!target._uid) {
      setOpenings(prev => prev.map((o, i) => (i === idx ? { ...o, _uid: uid } : o)));
    }

    setEditIndex(idx);
    setEditOpeningUid(uid);
    setEntryMode('edit');
    setMeasureMethodTouched(false);
    setScanMessage('');
    setOpening({ ...target, _uid: uid });
    setStep(1);
  };

  const copyOpening = (idx) => {
    const src = openings[idx];

    const base = `${src.openingCode || 'item'}_copy`;
    let nextCode = base;
    let n = 2;
    const exists = (code) => openings.some((o, i) => i !== idx && o.openingCode === code);
    while (exists(nextCode)) {
      nextCode = `${base}${n}`;
      n += 1;
    }

    const duplicated = {
      ...src,
      _uid: newOpeningUid(),
      openingCode: nextCode
    };

    setOpenings(prev => [...prev, duplicated]);
  };

  const upsertLocalArchiveOnly = async ({ silent = true } = {}) => {
    if (!job.jobName || !job.address || !openings.length) {
      if (!silent) Alert.alert('Missing job info', 'Need job name, address, and at least 1 item before saving to archive.');
      return null;
    }
    const payload = {
      id: measurementId,
      savedAt: new Date().toISOString(),
      job,
      openings,
      counts: buildCounts(openings)
    };
    const next = [payload, ...savedJobs.filter(x => x.id !== payload.id)];
    await persistArchive(next);
    return payload;
  };

  const upsertCurrentJobToArchive = async (silent = true) => {
    const payload = await upsertLocalArchiveOnly({ silent });
    if (!payload) return;

    await enqueueChange({ entity: 'measurement', entityId: payload.id, op: 'upsert', payload: sanitizeMeasurementForCloud(payload) });
    const syncResult = await syncNow();
    if (syncResult?.ok) {
      setCloudSavedAtById(prev => ({ ...prev, [payload.id]: payload.savedAt }));
      setCloudOpeningsCountById(prev => ({ ...prev, [payload.id]: Array.isArray(payload.openings) ? payload.openings.length : 0 }));
    }

    if (!silent) Alert.alert('Saved', 'Job saved to 1-year measurement archive.');
  };

  const persistSnapshotOnExit = () => {
    try {
      const j = latestJobRef.current;
      const list = latestOpeningsRef.current || [];
      const mid = latestMeasurementIdRef.current;
      const existing = latestSavedJobsRef.current || [];
      if (!j?.jobName || !j?.address || !list.length) return;

      const payload = {
        id: mid,
        savedAt: new Date().toISOString(),
        job: j,
        openings: list,
        counts: buildCounts(list)
      };

      const next = pruneToOneYear([payload, ...existing.filter(x => x.id !== payload.id)]);

      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        const raw = JSON.stringify(next);
        try {
          localStorage.setItem(archiveKey, raw);
        } catch {
          localStorage.setItem(archiveKey, JSON.stringify(toLightArchive(next)));
        }
      }

      setSavedJobs(next);
    } catch {}
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') return;
      persistSnapshotOnExit();
      upsertCurrentJobToArchive(true).catch(() => {});
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    // Bulletproof local persistence while editing: debounce-write archive + draft.
    const hasAnyData = !!(job.jobName || job.address || openings.length);
    if (!hasAnyData) return;

    const t = setTimeout(() => {
      upsertLocalArchiveOnly({ silent: true }).catch(() => {});

      // If we're already at summary/completed state, clear draft flag so cards don't show unfinished.
      if (isSummary) {
        clearDraft().catch(() => {});
        return;
      }

      const draftPayload = {
        savedAt: new Date().toISOString(),
        measurementId,
        step,
        job,
        opening,
        openings,
        editIndex,
        editOpeningUid,
        entryMode
      };
      persistDraft(draftPayload).catch(() => {});
    }, 700);

    return () => clearTimeout(t);
  }, [measurementId, step, isSummary, job, opening, openings, editIndex, editOpeningUid, entryMode]);

  useEffect(() => {
    // Keep per-measurement cloud status badges fresh.
    refreshPendingMeasurements().catch(() => {});
    const t = setInterval(() => {
      refreshPendingMeasurements().catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (!pendingQueueCount) return;
      syncNow()
        .then((result) => {
          if (result?.flushed) {
            loadArchive().catch(() => {});
          }
        })
        .catch(() => {});
    }, 15000);

    return () => clearInterval(t);
  }, [pendingQueueCount]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    setOfflineMode(!navigator.onLine);
    setSyncState(navigator.onLine ? 'synced' : 'offline');

    const onOnline = () => {
      setOfflineMode(false);
      // When connection returns, push pending writes then pull cloud-authoritative view.
      syncNow().then(() => loadArchive()).catch(() => {});
    };
    const onOffline = () => {
      setOfflineMode(true);
      setSyncState('offline');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const isLocalhost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if ('serviceWorker' in navigator) {
      if (isLocalhost) {
        navigator.serviceWorker.getRegistrations()
          .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
          .catch(() => {});
      } else {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    // Automatic cloud authority reconciliation across devices.
    const t = setInterval(() => {
      if (!navigator.onLine) return;
      loadArchive().catch(() => {});
    }, 15000);

    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    // Use intro time to pull latest cloud state before user enters.
    if (!showIntro) return;
    loadArchive().catch(() => {});
  }, [showIntro]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const onPageHide = () => persistSnapshotOnExit();
    const onBeforeUnload = () => persistSnapshotOnExit();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persistSnapshotOnExit();
    };

    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const playDeleteSound = () => {
    try {
      if (Platform.OS === 'web' && typeof Audio !== 'undefined') {
        const a = new Audio('https://assets.mixkit.co/active_storage/sfx/2058/2058-preview.mp3');
        a.volume = 0.35;
        a.play().catch(() => {});
      }
    } catch {}
  };

  const openConfirm = (message, onConfirm, options = {}) => {
    setConfirmState({
      visible: true,
      title: options.title || 'Please Confirm',
      message,
      confirmLabel: options.confirmLabel || 'Confirm',
      cancelLabel: options.cancelLabel || 'Cancel',
      onConfirm
    });
  };

  const closeConfirm = () => setConfirmState({ visible: false, title: '', message: '', confirmLabel: 'Confirm', cancelLabel: 'Cancel', onConfirm: null });

  const deleteArchivedJob = async (id) => {
    const target = savedJobs.find(x => x.id === id);
    const next = savedJobs.filter(x => x.id !== id);

    // Update UI state immediately so main page/archive reflect delete right away.
    setSavedJobs(next);

    let nextTrash = trashJobs;
    if (target) {
      nextTrash = [{ ...target, trashedAt: new Date().toISOString() }, ...trashJobs.filter(t => t.id !== id)];
      setTrashJobs(nextTrash);
    }

    await persistArchive(next);
    if (target) {
      await persistTrash(nextTrash);
    }

    // Queue remote delete so server state matches local delete/trash state.
    await enqueueChange({ entity: 'measurement', entityId: id, op: 'delete', payload: null });
    await syncNow();
  };

  const restoreFromTrash = async (id) => {
    const target = trashJobs.find(t => t.id === id);
    if (!target) return;
    const nextTrash = trashJobs.filter(t => t.id !== id);
    const restored = { ...target };
    delete restored.trashedAt;
    const nextArchive = [restored, ...savedJobs.filter(s => s.id !== id)];

    // Immediate UI update for restore action.
    setTrashJobs(nextTrash);
    setSavedJobs(nextArchive);

    await persistTrash(nextTrash);
    await persistArchive(nextArchive);

    await enqueueChange({ entity: 'measurement', entityId: restored.id, op: 'upsert', payload: sanitizeMeasurementForCloud(restored) });
    await syncNow();
  };

  const confirmDeleteArchivedJob = (id, name) => {
    openConfirm(
      'Your project will be moved to Trash and can be restored for 24 hours.',
      async () => {
        playDeleteSound();
        await deleteArchivedJob(id);
        closeConfirm();
      },
      { title: `Do you want to delete "${name || 'this project'}"?`, confirmLabel: 'Delete', cancelLabel: 'Cancel' }
    );
  };

  const deleteOpening = (idx) => {
    openConfirm(
      'This will remove the selected opening from the current measurement.',
      async () => {
        playDeleteSound();
        if (openings.length <= 1) {
          const target = savedJobs.find(x => x.id === measurementId);
          const nextArchive = savedJobs.filter(x => x.id !== measurementId);
          await persistArchive(nextArchive);
          if (target) {
            const nextTrash = [{ ...target, trashedAt: new Date().toISOString() }, ...trashJobs.filter(t => t.id !== measurementId)];
            await persistTrash(nextTrash);
          }
          await clearDraft();
          setOpenings([]);
          setOpening(emptyOpening);
          setMeasurementId(newMeasurementId());
          setEditIndex(null);
          setEditOpeningUid(null);
          setEntryMode('create');
          setShowArchive(false);
          setArchiveQuery('');
          setShowHome(true);
          closeConfirm();
          return;
        }
        setOpenings(prev => prev.filter((_, i) => i !== idx));
        closeConfirm();
      },
      { title: 'Remove Opening?', confirmLabel: 'Delete', cancelLabel: 'Cancel' }
    );
  };

  const openArchivedJob = (saved) => {
    // If this measurement has a linked unfinished draft item, resume draft state directly.
    if (draftData?.measurementId && draftData.measurementId === saved.id) {
      resumeDraft();
      setShowArchive(false);
      return;
    }

    setShowHome(false);
    setMeasureMethodTouched(false);
    setMeasurementId(saved.id || newMeasurementId());
    setJob({ ...(saved.job || {}), measureDate: normalizeDateToMMDDYYYY(saved.job?.measureDate) || getTodayMMDDYYYY() });
    setOpenings(saved.openings || []);
    setEditIndex(null);
    setEditOpeningUid(null);
    setEntryMode('create');
    setValidationError('');
    setStep(totalSteps);
    setShowArchive(false);
  };

  const filteredArchive = useMemo(() => {
    const q = archiveQuery.trim().toLowerCase();

    const toTs = (x) => {
      const d = (x?.job?.measureDate || '').trim();
      const m = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (m) {
        const mm = Number(m[1]);
        const dd = Number(m[2]);
        const yyyy = Number(m[3]);
        return new Date(yyyy, mm - 1, dd).getTime();
      }
      return new Date(x?.savedAt || 0).getTime() || 0;
    };

    const base = q
      ? savedJobs.filter(x => (x.job?.jobName || '').toLowerCase().includes(q) || (x.job?.address || '').toLowerCase().includes(q))
      : savedJobs;

    return [...base].sort((a, b) => toTs(b) - toTs(a));
  }, [archiveQuery, savedJobs]);

  const filteredDraftForHome = useMemo(() => {
    if (!draftData) return null;
    const q = archiveQuery.trim().toLowerCase();
    const draftJob = draftData.job || {};
    if (!q) return draftData;
    const hit = (draftJob.jobName || '').toLowerCase().includes(q) || (draftJob.address || '').toLowerCase().includes(q);
    return hit ? draftData : null;
  }, [archiveQuery, draftData]);

  const linkedDraftMeasurementId = useMemo(() => {
    if (!draftData?.measurementId) return null;
    return savedJobs.some(s => s.id === draftData.measurementId) ? draftData.measurementId : null;
  }, [draftData, savedJobs]);

  const exportBackupJson = async () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      archive: savedJobs || [],
      draft: draftData || null
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `field-measure-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    Alert.alert('Backup export', 'Backup export is currently available on web.');
  };

  const applyBackupPayload = async (parsed) => {
    const incomingArchive = Array.isArray(parsed.archive) ? pruneToOneYear(parsed.archive) : [];
    const draft = parsed.draft || null;

    // Merge import with existing archive (newest savedAt wins by id) to avoid accidental overwrite loss.
    const mergedArchive = pruneToOneYear(mergeMeasurements(savedJobs || [], incomingArchive));

    await persistArchive(mergedArchive);
    if (draft) {
      await persistDraft(draft);
    }

    const importedOnly = incomingArchive.length;
    const mergedTotal = mergedArchive.length;
    Alert.alert('Import complete', `Loaded ${importedOnly} from backup. Archive now has ${mergedTotal} measurement(s).`);
  };

  const importBackupJson = async () => {
    if (!(Platform.OS === 'web' && typeof window !== 'undefined')) {
      Alert.alert('Backup import', 'Backup import is currently available on web.');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        await applyBackupPayload(parsed);
      } catch {
        Alert.alert('Import failed', 'Invalid backup file or incomplete JSON. Please import a full .json export file.');
      }
    };
    input.click();
  };

  const importBackupFromClipboard = async () => {
    if (!(Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard)) {
      Alert.alert('Clipboard import', 'Clipboard import is available on web browsers with clipboard permission.');
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      await applyBackupPayload(parsed);
    } catch {
      Alert.alert('Clipboard import failed', 'Could not parse JSON from clipboard. Copy the full backup JSON and try again in Safari browser.');
    }
  };

  const updateQty = (idx, qty) => {
    setOpenings(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], qty: String(qty) };
      return copy;
    });
  };

  const toDataUriFromBlob = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const makeStableWebPhotoUri = async (asset) => {
    const PHOTO_SYNC_MAX_BYTES = 1200 * 1024;
    if (!asset) return '';

    if (asset.base64) {
      const dataUri = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
      try {
        const resp = await fetch(dataUri);
        const blob = await resp.blob();
        return await compressWebBlobToDataUri(blob, PHOTO_SYNC_MAX_BYTES);
      } catch {
        return dataUri;
      }
    }

    if (asset.file) {
      try {
        const compressed = await compressWebBlobToDataUri(asset.file, PHOTO_SYNC_MAX_BYTES);
        return compressed;
      } catch {
        return await toDataUriFromBlob(asset.file);
      }
    }

    if (asset.uri) {
      try {
        const resp = await fetch(asset.uri);
        const blob = await resp.blob();
        return await compressWebBlobToDataUri(blob, PHOTO_SYNC_MAX_BYTES);
      } catch {
        return asset.uri;
      }
    }

    return '';
  };

  const buildNativeCompressedDataUri = async (uri) => {
    const PHOTO_SYNC_MAX_BYTES = 1200 * 1024;
    const compressedUri = await compressNativeUriUnder2MB(uri, PHOTO_SYNC_MAX_BYTES);
    const b64 = await FileSystem.readAsStringAsync(compressedUri, { encoding: FileSystem.EncodingType.Base64 });
    return `data:${getMimeFromUri(compressedUri)};base64,${b64}`;
  };

  const capturePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera access needed', 'Please allow camera access to capture opening photos.');
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false, base64: Platform.OS === 'web' });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      const stableData = Platform.OS === 'web' ? await makeStableWebPhotoUri(asset) : await buildNativeCompressedDataUri(asset.uri);
      setScanMessage('Photo ready. Tap Scan to detect dimensions.');
      setOpening(prev => ({ ...prev, photoUri: stableData || asset.uri, photoDataUri: stableData || prev.photoDataUri || '', width: '', height: '', scannedWidth: '', scannedHeight: '' }));
    }
  };

  const pickPhotoFromLibrary = async () => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) {
          setScanMessage('No photo was selected.');
          return;
        }

        try {
          const stableData = await compressWebBlobToDataUri(file, 1200 * 1024);
          setScanMessage('Photo ready. Tap Scan to detect dimensions.');
          setValidationError('');
          setOpening(prev => ({ ...prev, photoUri: stableData, photoDataUri: stableData, width: '', height: '', scannedWidth: '', scannedHeight: '' }));
        } catch {
          try {
            const dataUri = await toDataUriFromBlob(file);
            setScanMessage('Photo ready. Tap Scan to detect dimensions.');
            setValidationError('');
            setOpening(prev => ({ ...prev, photoUri: dataUri, photoDataUri: dataUri, width: '', height: '', scannedWidth: '', scannedHeight: '' }));
          } catch {
            setScanMessage('Photo import failed. Try taking a new photo or choosing a smaller image.');
            Alert.alert('Photo import failed', 'Try taking a new photo or choosing a smaller image.');
          }
        }
      };
      input.click();
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Photo library access needed', 'Please allow photo library access.');
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: false, base64: Platform.OS === 'web' });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      const stableData = Platform.OS === 'web' ? await makeStableWebPhotoUri(asset) : await buildNativeCompressedDataUri(asset.uri);
      setScanMessage('Photo ready. Tap Scan to detect dimensions.');
      setOpening(prev => ({ ...prev, photoUri: stableData || asset.uri, photoDataUri: stableData || prev.photoDataUri || '', width: '', height: '', scannedWidth: '', scannedHeight: '' }));
    }
  };

  const captureExtraPhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera access needed', 'Please allow camera access to capture extra photos.');
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false, base64: Platform.OS === 'web' });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      const stableData = Platform.OS === 'web' ? await makeStableWebPhotoUri(asset) : await buildNativeCompressedDataUri(asset.uri);
      setOpening(prev => ({ ...prev, extraPhotoUri: stableData || asset.uri, extraPhotoDataUri: stableData || prev.extraPhotoDataUri || '' }));
    }
  };

  const pickExtraPhotoFromLibrary = async () => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
          const stableData = await compressWebBlobToDataUri(file, 1200 * 1024);
          setOpening(prev => ({ ...prev, extraPhotoUri: stableData, extraPhotoDataUri: stableData }));
        } catch {
          try {
            const dataUri = await toDataUriFromBlob(file);
            setOpening(prev => ({ ...prev, extraPhotoUri: dataUri, extraPhotoDataUri: dataUri }));
          } catch {
            Alert.alert('Photo import failed', 'Try choosing a smaller extra photo.');
          }
        }
      };
      input.click();
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Photo library access needed', 'Please allow photo library access.');
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: false, base64: Platform.OS === 'web' });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      const stableData = Platform.OS === 'web' ? await makeStableWebPhotoUri(asset) : await buildNativeCompressedDataUri(asset.uri);
      setOpening(prev => ({ ...prev, extraPhotoUri: stableData || asset.uri, extraPhotoDataUri: stableData || prev.extraPhotoDataUri || '' }));
    }
  };

  const scanFromCurrentPhoto = async (useCreditCard = false) => {
    if (!opening.photoUri && !opening.photoDataUri) {
      setScanMessage('Capture or pick a head-on photo before scanning.');
      Alert.alert('Scan needs a photo', 'Capture or pick a head-on photo first.');
      return;
    }

    setScanBusy(true);
    setValidationError('');
    setScanMessage('Scanning photo...');
    try {
      const result = await analyzeWindowPhoto({
        photoUri: opening.photoDataUri || opening.photoUri,
        useCreditCard,
        expectedOpeningType: opening.openingType,
        Image
      });

      const t = SCAN_FIELD_SCHEMA.confidenceThresholdDefault || 0.7;
      const next = { ...opening };
      const f = result.fields || {};

      const validSubtypeOptions = opening.openingType === 'Door'
        ? DOOR_SUBTYPES
        : opening.openingType === 'Skylight'
          ? SKYLIGHT_SUBTYPES
          : WINDOW_SUBTYPES;
      if (f.subtype?.confidence >= t && validSubtypeOptions.includes(f.subtype?.value)) {
        next.subtype = f.subtype.value;
      }
      if (f.operation?.confidence >= t && f.operation?.value) {
        next.operation = f.operation.value;
      }
      if (f.hasGrids?.confidence >= t) {
        next.grids = f.hasGrids.value ? 'Yes' : 'No';
      }
      if (f.estimatedWidthIn?.confidence >= t && Number.isFinite(f.estimatedWidthIn.value)) {
        next.width = formatMeasurementToQuarterInches(f.estimatedWidthIn.value);
        next.scannedWidth = next.width;
      }
      if (f.estimatedHeightIn?.confidence >= t && Number.isFinite(f.estimatedHeightIn.value)) {
        next.height = formatMeasurementToQuarterInches(f.estimatedHeightIn.value);
        next.scannedHeight = next.height;
      }

      setOpening(next);

      const applied = [
        f.openingType?.confidence >= t ? 'type' : null,
        f.subtype?.confidence >= t ? 'subtype' : null,
        f.operation?.confidence >= t ? 'operation' : null,
        f.hasGrids?.confidence >= t ? 'grids' : null,
        f.estimatedWidthIn?.confidence >= t ? 'width' : null,
        f.estimatedHeightIn?.confidence >= t ? 'height' : null
      ].filter(Boolean);

      const detectedSize = isValidInchFractionMeasurement(next.width) && isValidInchFractionMeasurement(next.height);
      if (!detectedSize) {
        const message = 'Scan could not detect reliable dimensions. Make sure the credit card/1" marker and opening edges are clear, or use Manual Entry.';
        setScanMessage(message);
        setValidationError(message);
        Alert.alert('Scan needs a clearer photo', message);
        return;
      }

      const completeMessage = `Detected ${next.width}" x ${next.height}" from ${result.meta?.measurementSource || 'vision'}. Please verify before continuing.`;
      setScanMessage(completeMessage);
      Alert.alert(
        'DimensionSnap Analysis Complete',
        applied.length
          ? `Applied: ${applied.join(', ')}\nMeasured: ${next.width || '-'}" x ${next.height || '-'}"\nSource: ${result.meta?.measurementSource || 'vision'}\n\nPlease verify these values manually.`
          : 'Photo quality too low to scale automatically. Ensure your 1" marker or Credit Card is clearly visible and head-on.'
      );
    } catch (e) {
      const message = e?.message || 'Unable to analyze photo.';
      setScanMessage(`Scan failed: ${message}`);
      setValidationError(`Scan failed: ${message}`);
      Alert.alert('Scan failed', message);
    } finally {
      setScanBusy(false);
    }
  };

  const shareOrDownload = async (uri, mimeType, dialogTitle) => {
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, { mimeType, dialogTitle });
      return;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(uri, '_blank');
      return;
    }
    Alert.alert('File ready', `Saved at:\n${uri}`);
  };

  const emailPdfAttachment = async (uri) => {
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'Email PDF Report'
      });
      return;
    }
    Alert.alert('PDF ready', `Saved at:\n${uri}`);
  };

  const exportPdfWebPrint = async (html) => {
    if (typeof window === 'undefined') return;

    const helperBar = `
      <div style="position:sticky;top:0;z-index:9999;display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 12px;background:#0f172a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="font-weight:600;">Report Preview</div>
        <div style="display:flex;gap:8px;">
          <button id="printBtn" style="background:#0ea5e9;border:none;color:#fff;padding:8px 10px;border-radius:8px;font-weight:600;">Print / Save PDF</button>
          <button id="closeBtn" style="background:#334155;border:none;color:#fff;padding:8px 10px;border-radius:8px;font-weight:600;">✕ Close</button>
        </div>
      </div>
    `;

    const previewDoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1" /><style>body{margin:0;background:#fff;} .previewWrap{padding:0.25in;} @media print { .previewWrap{padding:0;} #closeBtn,#printBtn{display:none;} }</style></head><body>${helperBar}<div class="previewWrap">${html}</div></body></html>`;

    const bindPreviewActions = (targetWin, isSameTab = false) => {
      try {
        const printBtn = targetWin.document.getElementById('printBtn');
        const closeBtn = targetWin.document.getElementById('closeBtn');
        if (printBtn) printBtn.onclick = () => { try { targetWin.print(); } catch {} };
        if (closeBtn) closeBtn.onclick = () => {
          if (isSameTab) {
            try { targetWin.location.reload(); } catch {}
          } else {
            try { targetWin.close(); } catch {}
            try { window.focus(); } catch {}
          }
        };
      } catch {}
    };

    const w = window.open('', '_blank');
    if (w) {
      w.document.open();
      w.document.write(previewDoc);
      w.document.close();
      w.focus();
      bindPreviewActions(w, false);
      setTimeout(() => { try { w.print(); } catch {} }, 250);
      return;
    }

    // iPhone/PWA popup-block fallback: replace current tab temporarily.
    const sameTab = window;
    sameTab.document.open();
    sameTab.document.write(previewDoc);
    sameTab.document.close();
    bindPreviewActions(sameTab, true);
    setTimeout(() => { try { sameTab.print(); } catch {} }, 250);
  };

  const getMimeFromUri = (uri = '') => {
    const u = uri.toLowerCase();
    if (u.endsWith('.png')) return 'image/png';
    if (u.endsWith('.webp')) return 'image/webp';
    if (u.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
  };

  const compressWebBlobToDataUri = async (blob, maxBytes = 2 * 1024 * 1024) => {
    const toDataUri = (b) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(b);
    });

    if (blob.size <= maxBytes) return await toDataUri(blob);

    const bitmap = await createImageBitmap(blob);
    let quality = 0.85;
    let scale = Math.sqrt(maxBytes / blob.size);
    scale = Math.max(0.35, Math.min(1, scale));

    let lastDataUrl = await toDataUri(blob);
    for (let i = 0; i < 5; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(600, Math.floor(bitmap.width * scale));
      canvas.height = Math.max(600, Math.floor(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      lastDataUrl = dataUrl;
      const sizeApprox = Math.ceil((dataUrl.length * 3) / 4);
      if (sizeApprox <= maxBytes) return dataUrl;
      quality -= 0.12;
      scale *= 0.85;
    }

    return lastDataUrl;
  };

  const compressNativeUriUnder2MB = async (uri, maxBytes = 2 * 1024 * 1024) => {
    let currentUri = uri;
    const qualities = [0.85, 0.7, 0.55, 0.4];
    const widths = [1800, 1400, 1100, 900];

    for (let i = 0; i < qualities.length; i++) {
      const info = await FileSystem.getInfoAsync(currentUri, { size: true });
      if (info.size && info.size <= maxBytes) return currentUri;

      const manipulated = await ImageManipulator.manipulateAsync(
        currentUri,
        [{ resize: { width: widths[i] } }],
        { compress: qualities[i], format: ImageManipulator.SaveFormat.JPEG }
      );
      currentUri = manipulated.uri;
    }

    return currentUri;
  };

  const withEmbeddedImages = async (items) => {
    const next = [];
    const REPORT_IMAGE_MAX_BYTES = 700 * 1024; // keep mobile PDF generation stable

    for (const o of items) {
      if (o.photoDataUri) {
        // If already embedded, avoid expensive reconversion unless it's very large.
        const approxBytes = Math.ceil((o.photoDataUri.length * 3) / 4);
        if (approxBytes <= REPORT_IMAGE_MAX_BYTES) {
          next.push(o);
          continue;
        }
        try {
          const resp = await fetch(o.photoDataUri);
          const blob = await resp.blob();
          const dataUri = await compressWebBlobToDataUri(blob, REPORT_IMAGE_MAX_BYTES);
          next.push({ ...o, photoDataUri: dataUri });
        } catch {
          next.push(o);
        }
        continue;
      }

      if (!o.photoUri) {
        next.push(o);
        continue;
      }

      try {
        let dataUri = '';
        if (Platform.OS === 'web') {
          const resp = await fetch(o.photoUri);
          const blob = await resp.blob();
          dataUri = await compressWebBlobToDataUri(blob, REPORT_IMAGE_MAX_BYTES);
        } else {
          const compressedUri = await compressNativeUriUnder2MB(o.photoUri, REPORT_IMAGE_MAX_BYTES);
          const b64 = await FileSystem.readAsStringAsync(compressedUri, { encoding: FileSystem.EncodingType.Base64 });
          dataUri = `data:${getMimeFromUri(compressedUri)};base64,${b64}`;
        }
        next.push({ ...o, photoDataUri: dataUri });
      } catch {
        next.push(o);
      }
    }
    return next;
  };

  const exportPdfSave = async () => {
    setShowReportChooser(false);
    const openingsWithImages = await withEmbeddedImages(openings);
    const html = buildHtmlReport(job, openingsWithImages);
    const safeJob = (job.jobName || 'job').replace(/[^a-z0-9-_]+/gi, '_');
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `${safeJob}_Field_Measurements_${stamp}`;

    if (Platform.OS === 'web') {
      await exportPdfWebPrint(html);
      return;
    }

    const pdf = await Print.printToFileAsync({ html });
    const targetPdfPath = `${FileSystem.documentDirectory}${baseName}.pdf`;
    try {
      await FileSystem.copyAsync({ from: pdf.uri, to: targetPdfPath });
      Alert.alert('PDF saved', `Saved to app storage:\n${targetPdfPath}`);
    } catch {
      Alert.alert('PDF ready', `Generated at:\n${pdf.uri}`);
    }
  };

  const exportPdfShare = async () => {
    setShowReportChooser(false);
    const openingsWithImages = await withEmbeddedImages(openings);
    const html = buildHtmlReport(job, openingsWithImages);
    const safeJob = (job.jobName || 'job').replace(/[^a-z0-9-_]+/gi, '_');
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `${safeJob}_Field_Measurements_${stamp}`;

    if (Platform.OS === 'web') {
      await exportPdfWebPrint(html);
      return;
    }

    const pdf = await Print.printToFileAsync({ html });
    const sharePath = `${FileSystem.cacheDirectory}${baseName}.pdf`;
    try {
      await FileSystem.copyAsync({ from: pdf.uri, to: sharePath });
      await emailPdfAttachment(sharePath);
    } catch {
      await emailPdfAttachment(pdf.uri);
    }
  };

  const exportExcelReport = async () => {
    setShowReportChooser(false);
    const csv = buildCsvFromOpenings(job, openings);
    const safeJob = (job.jobName || 'job').replace(/[^a-z0-9-_]+/gi, '_');
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `${safeJob}_Field_Measurements_${stamp}`;

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const csvPath = `${FileSystem.cacheDirectory}${baseName}.csv`;
    await FileSystem.writeAsStringAsync(csvPath, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await shareOrDownload(csvPath, 'text/csv', 'Share DimensionsPro Excel (CSV)');
  };

  const exportReport = async () => {
    if (!openings.length) return Alert.alert('No openings yet', 'Finish at least one opening first.');

    if (Platform.OS === 'web') {
      setShowReportChooser(prev => !prev);
      return;
    }

    Alert.alert(
      'Generate Report',
      'Choose export format:',
      [
        { text: 'Save PDF to Device', onPress: () => exportPdfSave() },
        { text: 'Share PDF', onPress: () => exportPdfShare() },
        { text: 'Excel (.csv)', onPress: () => exportExcelReport() },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  if (authLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.authWrap}>
          <ActivityIndicator size="large" color={UI.primary} />
          <Text style={styles.authSubtitle}>Checking secure session…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!authUser) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.authWrap}>
          <Image source={APP_LOGO} style={styles.logoLarge} resizeMode="contain" />
          <Text style={styles.h1}>DimensionsPro</Text>
          <Text style={styles.authSubtitle}>Secure portal login</Text>

          <TextInput
            style={[styles.input, { width: '100%' }]}
            placeholder="Username"
            placeholderTextColor={UI.muted}
            autoCapitalize="none"
            value={loginUsername}
            onChangeText={setLoginUsername}
          />
          <View style={styles.passwordInputWrap}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Password"
              placeholderTextColor={UI.muted}
              secureTextEntry={!showPassword}
              value={loginPassword}
              onChangeText={setLoginPassword}
            />
            <TouchableOpacity
              style={styles.passwordEyeButton}
              onPress={() => setShowPassword(prev => !prev)}
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              activeOpacity={0.75}
            >
              <Image source={showPassword ? PASSWORD_EYE_ICON : PASSWORD_EYE_OFF_ICON} style={styles.passwordEyeIconImage} resizeMode="contain" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.stayLoggedInRow} onPress={() => setStayLoggedIn(prev => !prev)} activeOpacity={0.8}>
            <View style={[styles.checkboxBox, stayLoggedIn ? styles.checkboxBoxOn : null]}>
              {stayLoggedIn ? <Text style={styles.checkboxCheck}>✓</Text> : null}
            </View>
            <Text style={styles.stayLoggedInText}>Stay logged in</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.loginBtnCompact} onPress={() => {
            const validUser = loginUsername.trim().toLowerCase() === 'dimensions';
            const validPass = loginPassword === 'Dimensions@13';
            if (!validUser || !validPass) {
              const msg = 'Wrong username and/or password.';
              setLoginError(msg);
              return;
            }
            setLoginError('');
            try {
              if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
                if (stayLoggedIn) {
                  localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify({ username: 'dimensions' }));
                } else {
                  localStorage.removeItem(LOCAL_AUTH_KEY);
                }
              }
            } catch {}
            setShowPassword(false);
            setAuthUser({ email: 'dimensions' });
          }}>
            <Text style={styles.btnText}>Log In</Text>
          </TouchableOpacity>

          {loginError ? <Text style={styles.authErrorText}>{loginError}</Text> : null}
          <Text style={styles.authFinePrint}>Temporary local login enabled.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (showIntro) {
    return (
      <SafeAreaView style={styles.introSafe}>
        <Pressable style={{ flex: 1 }} onPress={enterFromIntro}>
          <Animated.View style={[styles.introWrap, { opacity: introOpacity }]}> 
            <Animated.View
              style={[
                styles.stampBlock,
                {
                  transform: [
                    { perspective: 900 },
                    { translateY: logoDropY },
                    { rotateX: logoTilt.interpolate({ inputRange: [-12, 0], outputRange: ['-12deg', '0deg'] }) },
                    { scale: logoScale }
                  ]
                }
              ]}
            >
              <Image source={APP_LOGO} style={styles.stampLogo} resizeMode="contain" />
            </Animated.View>

            <Animated.View style={[styles.stampTextBlock, { opacity: titleOpacity, transform: [{ translateY: titleDropY }] }]}>
              <Text style={styles.stampText}>MEASUREMENT TOOL</Text>
            </Animated.View>
            {introReady ? <Text style={styles.introTapHint}>Press anywhere to continue</Text> : null}
          </Animated.View>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (showHome) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.authTopRowPinned}>
            <Text style={styles.authUserTextPinned}>DimensionsPro</Text>
            <View style={styles.authActionsRow}>
              <TouchableOpacity style={styles.authSignOutBtn} onPress={() => {
                try {
                  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
                    localStorage.removeItem(LOCAL_AUTH_KEY);
                  }
                } catch {}
                setAuthUser(null);
                setLoginPassword('');
                setShowPassword(false);
              }}>
                <Text style={styles.authSignOutText}>Sign out</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Image source={APP_LOGO} style={styles.logoLarge} resizeMode="contain" />
          {showSyncBanner ? <Text style={[styles.errorText, { color: syncState === 'error' ? UI.danger : UI.primaryDeep }]}>{syncBannerText}</Text> : null}
          <TouchableOpacity style={styles.homePrimaryAction} onPress={startNewMeasurement} activeOpacity={0.86}>
            <View style={styles.homePrimaryActionIcon}>
              <Text style={styles.homePrimaryActionIconText}>+</Text>
            </View>
            <View style={styles.homePrimaryActionCopy}>
              <Text style={styles.homePrimaryActionText}>New Measurement</Text>
              <Text style={styles.homePrimaryActionSubtext}>Start a new job</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.section}>Recent Measurements ({savedJobs.length + (draftData ? 1 : 0)})</Text>
          <Input label="Search by project name or address" value={archiveQuery} onChangeText={setArchiveQuery} placeholder="Search..." />

          {filteredDraftForHome && !linkedDraftMeasurementId ? (
            <TouchableOpacity style={styles.card} onPress={resumeDraft}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{filteredDraftForHome.job?.jobName || 'Unfinished Measurement'}</Text>
                <Text style={styles.unfinishedBadge}>Draft</Text>
              </View>
              <Text style={styles.cardTextCompact}>{filteredDraftForHome.job?.address || '-'}</Text>
              <Text style={styles.cardTextCompact}>Measured: {formatDateForMainList(filteredDraftForHome.job?.measureDate)}</Text>
              <Text style={styles.cardTextCompact}>Items: {(filteredDraftForHome.openings || []).reduce((sum, o) => sum + (Number(o?.qty) > 0 ? Number(o.qty) : 1), 0)}</Text>
            </TouchableOpacity>
          ) : null}

          {filteredArchive.length === 0 && !(filteredDraftForHome && !linkedDraftMeasurementId) ? <Text style={styles.cardText}>No saved measurements yet.</Text> : null}
          {filteredArchive.map((s) => (
            <SwipeArchiveItem
              key={s.id}
              item={s}
              hasUnfinishedItem={linkedDraftMeasurementId === s.id}
              syncStatus={getMeasurementSyncStatus(s)}
              onOpen={() => openArchivedJob(s)}
              onDelete={() => confirmDeleteArchivedJob(s.id, s.job?.jobName)}
            />
          ))}

          <Text style={styles.section}>Trash ({trashJobs.length}) — auto-deletes after 24h</Text>
          {trashJobs.length === 0 ? <Text style={styles.cardText}>Trash is empty.</Text> : null}
          {trashJobs.map((t) => (
            <View key={`trash_${t.id}`} style={styles.card}>
              <Text style={styles.cardTitle}>{t.job?.jobName || '-'}</Text>
              <Text style={styles.cardTextCompact}>{t.job?.address || '-'}</Text>
              <Text style={styles.cardTextCompact}>Deleted: {t.trashedAt ? new Date(t.trashedAt).toLocaleString() : '-'}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TouchableOpacity style={[styles.btn, styles.btnAlt, { marginTop: 0 }]} onPress={() => restoreFromTrash(t.id)}>
                  <Text style={styles.btnText}>Restore</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>

        <Modal visible={confirmState.visible} transparent animationType="fade" onRequestClose={closeConfirm}>
          <Pressable style={styles.modalBackdrop} onPress={closeConfirm}>
            <View style={styles.confirmCard}>
              <Text style={styles.confirmTitle}>{confirmState.title}</Text>
              <Text style={styles.confirmBody}>{confirmState.message}</Text>
              <View style={styles.confirmActions}>
                <TouchableOpacity style={[styles.confirmBtn, styles.confirmNo]} onPress={closeConfirm}>
                  <Text style={styles.confirmBtnText}>{confirmState.cancelLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.confirmBtn, styles.confirmYes]} onPress={() => confirmState.onConfirm && confirmState.onConfirm()}>
                  <Text style={styles.confirmBtnText}>{confirmState.confirmLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Image source={APP_LOGO} style={styles.logo} resizeMode="contain" />
        <Text style={styles.h1}>DimensionsPro</Text>
        {showSyncBanner ? <Text style={[styles.errorText, { color: syncState === 'error' ? UI.danger : UI.primaryDeep }]}>{syncBannerText}</Text> : null}
        {entryMode === 'edit' && editIndex !== null && !isSummary ? <Text style={styles.editBadge}>Editing item #{editIndex + 1}</Text> : null}
        {entryMode === 'copy' && !isSummary ? <Text style={styles.editBadge}>Copy mode</Text> : null}
        <Text style={styles.progress}>Step {Math.min(step + 1, steps.length)} / {steps.length}</Text>
        <Text style={styles.stepTitle}>{steps[step]}</Text>
        {!isSummary && !!validationError ? <Text style={styles.errorText}>{validationError}</Text> : null}

        {!isSummary && renderStep(step, { job, setJob, opening, setOpening, setMeasureMethodTouched, capturePhoto, pickPhotoFromLibrary, captureExtraPhoto, pickExtraPhotoFromLibrary, scanFromCurrentPhoto, scanBusy, scanMessage, setScanMessage })}

        {isSummary && (
          <View>
            <View style={styles.summaryHeaderRow}>
              <Text style={styles.section}>Overall Job Summary</Text>
              <View style={styles.summarySyncWrap}>
                <View style={currentMeasurementSyncStatus === 'synced' ? styles.syncBadgeSynced : styles.syncBadgePending}>
                  <Text style={styles.syncBadgeText}>{currentMeasurementSyncStatus === 'synced' ? '✓' : '…'}</Text>
                </View>
                <Text style={styles.summarySyncText}>{currentMeasurementSyncStatus === 'synced' ? 'Uploaded to cloud' : 'Queued for upload'}</Text>
              </View>
            </View>
            <View style={styles.summaryInfoCard}>
              <View style={styles.summaryInfoCardHeader}>
                <Text style={styles.summaryInfoCardTitle}>Job information</Text>
                <TouchableOpacity style={styles.summaryEditPencil} onPress={() => setShowJobInfoEditor(true)}>
                  <Text style={styles.smallActionIcon}>✏️</Text>
                </TouchableOpacity>
              </View>
              <SummaryRow label="Job" value={job.jobName} />
              <SummaryRow label="Address" value={job.address} />
              <SummaryRow label="Date" value={job.measureDate} />
              <SummaryRow label="Job Site Contact" value={job.onSiteContact || '-'} />
              <SummaryRow label="Measured by" value={job.measuredBy || '-'} />
            </View>

            <Text style={styles.section}>Openings ({counts.total} items across {counts.lines} lines)</Text>
            {openings.map((o, i) => (
              <View key={`${o.openingCode}-${i}`} style={styles.card}>
                <TouchableOpacity onPress={() => setOpeningDetailIndex(i)} activeOpacity={0.85}>
                  <View style={styles.cardTopRow}>
                    <View style={{ flex: 1, paddingRight: 8, justifyContent: 'flex-start' }}>
                      <View style={styles.titleQtyRow}>
                        <Text style={styles.cardTitle} numberOfLines={1}>{o.room} • {o.openingCode} • {o.openingType} ({o.subtype})</Text>
                        <TouchableOpacity style={styles.qtyInputInline} onPress={() => setQtyPickerIndex(i)}>
                          <Text style={styles.qtyText}>{(o.qty || '1').toString()} ▼</Text>
                        </TouchableOpacity>
                        <View style={currentMeasurementSyncStatus === 'synced' ? styles.syncBadgeSynced : styles.syncBadgePending}>
                          <Text style={styles.syncBadgeText}>{currentMeasurementSyncStatus === 'synced' ? '✓' : '…'}</Text>
                        </View>
                      </View>

                      <Text style={styles.cardTextCompact} numberOfLines={2}>
                        {o.width}" x {o.height}"{o.openingType === 'Skylight' ? '' : ` | Jamb ${o.jamb}" | ${o.basis} | ${o.installType}`} | {o.operation}
                      </Text>
                    </View>

                    <View style={styles.rightRailCompact}>
                      {(o.photoDataUri || o.photoUri) ? <Image source={{ uri: o.photoDataUri || o.photoUri }} style={styles.thumbPhoto} /> : <View style={styles.thumbPlaceholder}><Text style={styles.cardText}>No photo</Text></View>}
                      <View style={styles.sideActions}>
                        <TouchableOpacity style={[styles.smallActionBtn, styles.sideActionBtn]} onPress={() => editOpening(i)}>
                          <Text style={styles.smallActionIcon}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.smallActionBtn, styles.sideActionBtn]} onPress={() => copyOpening(i)}>
                          <Text style={styles.smallActionIcon}>⧉</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.smallActionBtn, styles.sideActionBtn]} onPress={() => deleteOpening(i)}>
                          <Text style={styles.smallActionIcon}>🗑</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            ))}

            <View style={styles.footerLine}>
              <Text style={styles.footerLineText}>Windows: {windowCount}   |   Doors: {doorCount}   |   Skylights: {skylightCount}</Text>
            </View>

            <View style={styles.rowGap}>
              <TouchableOpacity style={styles.btn} onPress={addAnother}><Text style={styles.btnText}>Add an Item</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnAlt]} onPress={exportReport}><Text style={styles.btnText}>Generate Quote-Ready Report</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={backToMainPage}><Text style={styles.btnText}>Back to Main Page</Text></TouchableOpacity>

              {showArchive ? (
                <View style={styles.reportChooser}>
                  <Text style={styles.label}>Search by project name or address:</Text>
                  <TextInput
                    style={styles.input}
                    value={archiveQuery}
                    onChangeText={setArchiveQuery}
                    placeholder="Search archive..."
                    placeholderTextColor={UI.muted}
                  />
                  {filteredArchive.length === 0 ? <Text style={styles.cardText}>No saved jobs found.</Text> : null}
                  {filteredArchive.map((s) => (
                    <SwipeArchiveItem
                      key={s.id}
                      item={s}
                      hasUnfinishedItem={linkedDraftMeasurementId === s.id}
                      syncStatus={getMeasurementSyncStatus(s)}
                      onOpen={() => openArchivedJob(s)}
                      onDelete={() => confirmDeleteArchivedJob(s.id, s.job?.jobName)}
                      compact
                    />
                  ))}
                </View>
              ) : null}

              {showReportChooser ? (
                <Modal visible={showReportChooser} transparent animationType="fade" onRequestClose={() => setShowReportChooser(false)}>
                  <Pressable style={styles.modalBackdrop} onPress={() => setShowReportChooser(false)}>
                    <Pressable style={styles.confirmCard} onPress={() => {}}>
                      <Text style={styles.cardTitle}>Generate Quote</Text>
                      <Text style={styles.cardTextCompact}>Choose export format:</Text>
                      <View style={styles.reportChooserActions}>
                        <TouchableOpacity style={[styles.btn, styles.btnAlt, { marginTop: 0 }]} onPress={() => exportPdfShare()}>
                          <Text style={styles.btnText}>PDF</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.btn, { marginTop: 0 }]} onPress={() => exportExcelReport()}>
                          <Text style={styles.btnText}>Excel</Text>
                        </TouchableOpacity>
                      </View>
                    </Pressable>
                  </Pressable>
                </Modal>
              ) : null}
            </View>
          </View>
        )}

        {!isSummary && (
          <View style={styles.navRow}>
            {step > 0 ? (
              <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={back}><Text style={styles.btnText}>Back</Text></TouchableOpacity>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <TouchableOpacity style={[styles.btn, styles.btnSaveExit]} onPress={saveAndExit}>
              <Text style={styles.btnText}>Save & Exit</Text>
            </TouchableOpacity>
            {step < lastEntryStep ? (
              <TouchableOpacity style={styles.btn} onPress={next}><Text style={styles.btnText}>Next</Text></TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.btn} onPress={finishOpening}><Text style={styles.btnText}>{editIndex === null ? 'Finish Opening' : 'Save Changes'}</Text></TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={qtyPickerIndex !== null} transparent animationType="fade" onRequestClose={() => { setQtyPickerIndex(null); setQtyCustomValue(''); }}>
        <Pressable style={styles.modalBackdrop} onPress={() => { setQtyPickerIndex(null); setQtyCustomValue(''); }}>
          <View style={styles.qtyPickerCard}>
            <ScrollView showsVerticalScrollIndicator>
              <TouchableOpacity style={[styles.qtyMenuItem, styles.qtyDeleteItem]} onPress={() => { if (qtyPickerIndex !== null) deleteOpening(qtyPickerIndex); setQtyPickerIndex(null); setQtyCustomValue(''); }}>
                <Text style={styles.qtyDeleteIcon}>🗑</Text>
              </TouchableOpacity>
              {Array.from({ length: 10 }, (_, k) => k + 1).map(n => (
                <TouchableOpacity key={n} style={styles.qtyMenuItem} onPress={() => { if (qtyPickerIndex !== null) updateQty(qtyPickerIndex, n); setQtyPickerIndex(null); setQtyCustomValue(''); }}>
                  <Text style={styles.qtyMenuText}>{n}</Text>
                </TouchableOpacity>
              ))}
              <View style={styles.qtyCustomWrap}>
                <Text style={styles.qtyCustomLabel}>Custom quantity</Text>
                <TextInput
                  style={styles.qtyCustomInput}
                  value={qtyCustomValue}
                  onChangeText={setQtyCustomValue}
                  placeholder="Enter any number"
                  placeholderTextColor={UI.muted}
                  keyboardType="numeric"
                />
                <TouchableOpacity
                  style={styles.qtyCustomBtn}
                  onPress={() => {
                    const n = Number(qtyCustomValue);
                    if (!Number.isInteger(n) || n < 1) {
                      Alert.alert('Invalid quantity', 'Enter a whole number greater than 0.');
                      return;
                    }
                    if (qtyPickerIndex !== null) updateQty(qtyPickerIndex, n);
                    setQtyPickerIndex(null);
                    setQtyCustomValue('');
                  }}
                >
                  <Text style={styles.qtyCustomBtnText}>Apply</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showJobInfoEditor} transparent animationType="slide" onRequestClose={() => setShowJobInfoEditor(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowJobInfoEditor(false)}>
          <Pressable style={styles.confirmCard} onPress={() => {}}>
            <Text style={styles.cardTitle}>Edit Job Information</Text>
            <Input label="Address *" value={job.address} onChangeText={v => setJob({ ...job, address: v })} placeholder="Enter full jobsite address" />
            <Input label="Job name *" value={job.jobName} onChangeText={v => setJob({ ...job, jobName: v })} />
            <Input label="Date * (MM-DD-YYYY)" value={job.measureDate} onChangeText={v => setJob({ ...job, measureDate: v })} placeholder="e.g. 03-27-2026" />
            <Input label="Measured by" value={job.measuredBy} onChangeText={v => setJob({ ...job, measuredBy: v })} />
            <Input label="Job Site Contact" value={job.onSiteContact} onChangeText={v => setJob({ ...job, onSiteContact: v })} />
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmNo]} onPress={() => setShowJobInfoEditor(false)}>
                <Text style={styles.confirmIcon}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, styles.confirmYes]}
                onPress={() => {
                  if (!job.address || !job.jobName || !isValidDateMMDDYYYY(job.measureDate)) {
                    Alert.alert('Missing required fields', 'Please fill Job Name, Address, and Date in MM-DD-YYYY format.');
                    return;
                  }
                  setShowJobInfoEditor(false);
                }}
              >
                <Text style={styles.confirmIcon}>Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={openingDetailIndex !== null} transparent animationType="slide" onRequestClose={() => setOpeningDetailIndex(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpeningDetailIndex(null)}>
          <Pressable style={styles.openingDetailCard} onPress={() => {}}>
            {selectedOpeningDetail ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.openingDetailHeader}>
                  <Text style={styles.cardTitle}>
                    {selectedOpeningDetail.room || '-'} • {selectedOpeningDetail.openingCode || '-'}
                  </Text>
                  <TouchableOpacity style={styles.openingDetailCloseBtn} onPress={() => setOpeningDetailIndex(null)}>
                    <Text style={styles.smallActionIcon}>✕</Text>
                  </TouchableOpacity>
                </View>
                <OpeningDetailRow label="Opening type" value={`${selectedOpeningDetail.openingType || '-'}${selectedOpeningDetail.subtype ? ` (${selectedOpeningDetail.subtype})` : ''}`} />
                <OpeningDetailRow label="Quantity" value={selectedOpeningDetail.qty || '1'} />
                <OpeningDetailRow label="Width" value={selectedOpeningDetail.width ? `${selectedOpeningDetail.width}"` : '-'} />
                <OpeningDetailRow label="Height" value={selectedOpeningDetail.height ? `${selectedOpeningDetail.height}"` : '-'} />
                <OpeningDetailRow label="Operation" value={selectedOpeningDetail.operation || '-'} />
                {selectedOpeningDetail.openingType !== 'Skylight' ? <OpeningDetailRow label="Jamb" value={selectedOpeningDetail.jamb ? `${selectedOpeningDetail.jamb}"` : '-'} /> : null}
                {selectedOpeningDetail.openingType !== 'Skylight' ? <OpeningDetailRow label="Measurement basis" value={selectedOpeningDetail.basis || '-'} /> : null}
                {selectedOpeningDetail.openingType !== 'Skylight' ? <OpeningDetailRow label="Installation type" value={selectedOpeningDetail.installType || '-'} /> : null}
                <OpeningDetailRow label="Glass type" value={selectedOpeningDetail.glassType || (selectedOpeningDetail.glassSelections || []).join(' + ') || '-'} />
                <OpeningDetailRow label="Tempered" value={selectedOpeningDetail.tempered || '-'} />
                <OpeningDetailRow label="Fire zone" value={selectedOpeningDetail.fireZone || '-'} />
                <OpeningDetailRow label="Falling hazard" value={selectedOpeningDetail.fallingHazard || '-'} />
                <OpeningDetailRow label="Egress" value={selectedOpeningDetail.egress || '-'} />
                <OpeningDetailRow label="Grids" value={selectedOpeningDetail.grids || '-'} />
                {selectedOpeningDetail.gridType ? <OpeningDetailRow label="Grid type" value={selectedOpeningDetail.gridType} /> : null}
                {selectedOpeningDetail.gridDesign ? <OpeningDetailRow label="Grid design" value={selectedOpeningDetail.gridDesign} /> : null}
                <OpeningDetailRow label="Existing type" value={selectedOpeningDetail.existingType || '-'} />
                <OpeningDetailRow label="General notes" value={selectedOpeningDetail.notes || '-'} multiline />
                <OpeningDetailRow label="Photo notes" value={selectedOpeningDetail.photoNote || '-'} multiline />

                {(selectedOpeningDetail.photoDataUri || selectedOpeningDetail.photoUri) ? (
                  <>
                    <Text style={styles.section}>Primary Photo</Text>
                    <Image source={{ uri: selectedOpeningDetail.photoDataUri || selectedOpeningDetail.photoUri }} style={styles.previewPhoto} />
                  </>
                ) : null}

                {(selectedOpeningDetail.extraPhotoDataUri || selectedOpeningDetail.extraPhotoUri) ? (
                  <>
                    <Text style={styles.section}>Extra Photo</Text>
                    <Image source={{ uri: selectedOpeningDetail.extraPhotoDataUri || selectedOpeningDetail.extraPhotoUri }} style={styles.previewPhoto} />
                  </>
                ) : null}
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={confirmState.visible} transparent animationType="fade" onRequestClose={closeConfirm}>
        <Pressable style={styles.modalBackdrop} onPress={closeConfirm}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{confirmState.title}</Text>
            <Text style={styles.confirmBody}>{confirmState.message}</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmNo]} onPress={closeConfirm}>
                <Text style={styles.confirmBtnText}>{confirmState.cancelLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmYes]} onPress={() => confirmState.onConfirm && confirmState.onConfirm()}>
                <Text style={styles.confirmBtnText}>{confirmState.confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function renderStep(step, ctx) {
  const { job, setJob, opening, setOpening, setMeasureMethodTouched, capturePhoto, pickPhotoFromLibrary, captureExtraPhoto, pickExtraPhotoFromLibrary, scanFromCurrentPhoto, scanBusy, scanMessage, setScanMessage } = ctx;
  switch (step) {
    case 0:
      return (
        <>
          <Input label="Address *" value={job.address} onChangeText={v => setJob({ ...job, address: v })} placeholder="Enter full jobsite address" />
          <Input label="Job name *" value={job.jobName} onChangeText={v => setJob({ ...job, jobName: v })} />
          <Input label="Date * (MM-DD-YYYY)" value={job.measureDate} onChangeText={v => setJob({ ...job, measureDate: v })} placeholder="e.g. 03-27-2026" />
          <Input label="Measured by" value={job.measuredBy} onChangeText={v => setJob({ ...job, measuredBy: v })} />
          <Input label="Job Site Contact" value={job.onSiteContact} onChangeText={v => setJob({ ...job, onSiteContact: v })} />
        </>
      );
    case 1:
      return (
        <>
          <Input label="Room *" value={opening.room} onChangeText={v => setOpening({ ...opening, room: v })} />
          <Input label="Opening ID * (W1 / D2 / etc.)" value={opening.openingCode} onChangeText={v => setOpening({ ...opening, openingCode: v })} />
          <Input label="Quantity *" value={opening.qty} onChangeText={v => setOpening({ ...opening, qty: v })} keyboardType="numeric" />
          <PickerLike
            label="Opening type"
            value={opening.openingType}
            options={OPENING_TYPES}
            onChange={v => setOpening({ ...opening, openingType: v, subtype: v === 'Door' ? 'Multi-slide' : v === 'Skylight' ? 'Deck mount' : 'DH', configA: '', configB: '', configC: '', operation: '', tempered: v === 'Door' ? 'Yes' : 'No', fireZone: v === 'Skylight' ? '' : (opening.fireZone || 'No'), fallingHazard: v === 'Skylight' ? '' : (opening.fallingHazard || 'No'), egress: v === 'Skylight' ? '' : (opening.egress || 'No'), grids: v === 'Skylight' ? '' : opening.grids, gridType: v === 'Skylight' ? '' : opening.gridType, gridDesign: v === 'Skylight' ? '' : opening.gridDesign, glassSelections: v === 'Skylight' ? [] : opening.glassSelections, glassType: v === 'Skylight' ? '' : opening.glassType, installType: v === 'Skylight' ? '' : (opening.installType || 'Nail fin'), jamb: v === 'Skylight' ? '' : opening.jamb, basis: v === 'Skylight' ? '' : (opening.basis || 'Net frame') })}
          />
          <PickerLike
            label="Subtype"
            value={opening.subtype}
            options={opening.openingType === 'Door' ? DOOR_SUBTYPES : opening.openingType === 'Skylight' ? SKYLIGHT_SUBTYPES : WINDOW_SUBTYPES}
            onChange={v => setOpening({ ...opening, subtype: v, configA: '', configB: '', configC: '', operation: '' })}
          />
          <OperationSubmenu opening={opening} setOpening={setOpening} />
        </>
      );
    case 2:
      return (
        <>
          <Text style={styles.label}>How do you want to add dimensions? *</Text>
          <View style={styles.rowGap}>
            <TouchableOpacity
              style={[styles.btn, opening.measureMethod === 'manual' ? null : styles.btnGhost]}
              onPress={() => {
                setMeasureMethodTouched(true);
                setScanMessage('');
                setOpening({ ...opening, measureMethod: 'manual' });
              }}
            >
              <Text style={styles.btnText}>Manual Entry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnAlt, opening.measureMethod === 'snap' ? null : styles.btnGhost]}
              onPress={() => {
                setMeasureMethodTouched(true);
                setScanMessage(opening.photoUri || opening.photoDataUri ? 'Photo ready. Tap Scan to detect dimensions.' : '');
                setOpening({ ...opening, measureMethod: 'snap' });
              }}
            >
              <Text style={styles.btnText}>DimensionSnap</Text>
            </TouchableOpacity>
          </View>

          {opening.measureMethod === 'snap' ? (
            <>
              <Text style={styles.cardText}>Use a head-on photo with a standard credit card visible for scale.</Text>
              {(opening.photoDataUri || opening.photoUri) ? (
                <View style={styles.photoPreviewWrap}>
                  <Image source={{ uri: opening.photoDataUri || opening.photoUri }} style={styles.previewPhoto} />
                  <TouchableOpacity
                    style={styles.photoOverlayDelete}
                    onPress={() => {
                      setOpening({
                        ...opening,
                        photoUri: '',
                        photoDataUri: '',
                        width: '',
                        height: '',
                        scannedWidth: '',
                        scannedHeight: ''
                      });
                      setScanMessage('');
                    }}
                  >
                    <Text style={styles.photoOverlayDeleteText}>🗑</Text>
                  </TouchableOpacity>
                </View>
              ) : <Text style={styles.label}>No scan photo selected yet.</Text>}
              <View style={styles.rowGap}>
                <TouchableOpacity style={styles.btn} onPress={capturePhoto}><Text style={styles.btnText}>Capture Photo</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={pickPhotoFromLibrary}><Text style={styles.btnText}>Pick from Library</Text></TouchableOpacity>
              </View>
              {(opening.photoDataUri || opening.photoUri) ? (
                <View style={styles.rowGap}>
                  <TouchableOpacity style={[styles.btn, { backgroundColor: '#0284c7', flex: 1 }]} onPress={() => scanFromCurrentPhoto(true)} disabled={scanBusy}>
                    <Text style={styles.btnText}>{scanBusy ? 'Scanning...' : 'Scan Credit Card'}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {scanBusy ? (
                <View style={styles.scanStatusRow}>
                  <ActivityIndicator color="#38bdf8" />
                  <Text style={styles.scanStatusText}>Scanning photo...</Text>
                </View>
              ) : null}
              {scanMessage ? <Text style={styles.scanStatusText}>{scanMessage}</Text> : null}
            </>
          ) : null}

          {opening.measureMethod === 'manual' ? (
            <>
              <Text style={styles.cardText}>Enter width and height in inches using whole numbers or fractions only.</Text>
              <Input label='Width (in) *' value={opening.width} onChangeText={v => setOpening({ ...opening, width: v })} placeholder='e.g. 23 1/2' />
              <Input label='Height (in) *' value={opening.height} onChangeText={v => setOpening({ ...opening, height: v })} placeholder='e.g. 48 1/4' />
            </>
          ) : (
            <>
              <Text style={styles.cardText}>Verify DimensionSnap results before continuing. Edit width and height here if the estimate is off.</Text>
              <Input label='Verified width (in) *' value={opening.width} onChangeText={v => setOpening({ ...opening, width: v })} placeholder='e.g. 96' />
              <Input label='Verified height (in) *' value={opening.height} onChangeText={v => setOpening({ ...opening, height: v })} placeholder='e.g. 80' />
              {(opening.scannedWidth || opening.scannedHeight) ? (
                <View style={styles.lockedRow}>
                  <Text style={styles.cardTextCompact}>Original scanned size</Text>
                  <Text style={styles.cardText}>{`${opening.scannedWidth || '-'} W x ${opening.scannedHeight || '-'} H`}</Text>
                </View>
              ) : null}
            </>
          )}
        </>
      );
    case 3:
      return opening.openingType === 'Skylight' ? (
        <Text style={styles.cardText}>Jamb does not apply to skylights. Skipping this step.</Text>
      ) : (
        <>
          <Input label='Jamb thickness (inside, in) *' value={opening.jamb} onChangeText={v => setOpening({ ...opening, jamb: v })} placeholder='e.g. 4 9/16 or 4.56' />
          <Text style={styles.cardText}>Jamb is always recorded as inside size (not adjusted for Net vs Rough Opening).</Text>
        </>
      );
    case 4:
      return opening.openingType === 'Skylight' ? (
        <Text style={styles.cardText}>Net frame / rough opening does not apply to skylights. Skipping this step.</Text>
      ) : (
        <>
          <PickerLike label='Measurement basis (W/H only) *' value={opening.basis} options={['Net frame', 'Rough opening']} onChange={v => setOpening({ ...opening, basis: v })} />
          <Text style={styles.cardText}>Basis selection affects width/height only. Jamb stays as inside size.</Text>
        </>
      );
    case 5:
      return opening.openingType === 'Skylight' ? (
        <Text style={styles.cardText}>Glass type does not apply to skylights. Skipping this step.</Text>
      ) : (
        <>
          <Text style={styles.label}>Choose 1 or 2 glass options *</Text>
          <MultiPickTwo
            options={['LowE3', 'Clear', 'Privacy', 'Other']}
            values={opening.glassSelections}
            onChange={vals => setOpening({ ...opening, glassSelections: vals })}
          />
          <Text style={styles.cardText}>If you select “Other”, add details in General Notes. (Clear + Privacy cannot be combined.)</Text>
        </>
      );
    case 6:
      return opening.openingType === 'Skylight' ? (
        <Text style={styles.cardText}>Tempered / fire-zone check does not apply to skylights. Skipping this step.</Text>
      ) : (
        <>
          {opening.openingType === 'Door' ? (
            <View style={styles.lockedRow}>
              <Text style={styles.label}>Tempered *</Text>
              <Text style={styles.lockedText}>Yes (Auto-locked for all doors)</Text>
            </View>
          ) : (
            <PickerLike label='Tempered *' value={opening.tempered} options={['Yes', 'No']} onChange={v => setOpening({ ...opening, tempered: v })} />
          )}
          <Text style={styles.label}>Glass / Window Conditions :</Text>
          <PickerLike label='Fire zone *' value={opening.fireZone} options={['Yes', 'No']} onChange={v => setOpening({ ...opening, fireZone: v })} />
          <PickerLike label='Falling hazard *' value={opening.fallingHazard || 'No'} options={['Yes', 'No']} onChange={v => setOpening({ ...opening, fallingHazard: v })} />
          <PickerLike label='Egress *' value={opening.egress || 'No'} options={['Yes', 'No']} onChange={v => setOpening({ ...opening, egress: v })} />
        </>
      );
    case 7:
      return opening.openingType === 'Skylight' ? (
        <Text style={styles.cardText}>Grids do not apply to skylights. Skipping this step.</Text>
      ) : (
        <>
          <PickerLike label='Grids *' value={opening.grids} options={['Yes', 'No']} onChange={v => setOpening({ ...opening, grids: v })} />
          {opening.grids === 'Yes' && (
            <>
              <Input label='Grid type *' value={opening.gridType} onChangeText={v => setOpening({ ...opening, gridType: v })} />
              <Input label='Grid design *' value={opening.gridDesign} onChangeText={v => setOpening({ ...opening, gridDesign: v })} />
            </>
          )}
        </>
      );
    case 8:
      return opening.openingType === 'Skylight' ? (
        <Text style={styles.cardText}>Installation type does not apply to skylights (already defined by Deck/Curb mount). Skipping this step.</Text>
      ) : (
        <PickerLike label='Installation type *' value={opening.installType} options={INSTALL_TYPES} onChange={v => setOpening({ ...opening, installType: v })} />
      );
    case 9:
      return <Input label={opening.openingType === 'Skylight' ? 'Existing skylight type' : 'Existing window type'} value={opening.existingType} onChangeText={v => setOpening({ ...opening, existingType: v })} />;
    case 10:
      return (
        <>
          <Input label='General notes' value={opening.notes} onChangeText={v => setOpening({ ...opening, notes: v })} multiline />
          <Text style={styles.section}>Extra Photos</Text>
          {(opening.extraPhotoDataUri || opening.extraPhotoUri) ? (
            <View style={styles.photoPreviewWrap}>
              <Image source={{ uri: opening.extraPhotoDataUri || opening.extraPhotoUri }} style={styles.previewPhoto} />
              <TouchableOpacity
                style={styles.photoOverlayDelete}
                onPress={() => setOpening({
                  ...opening,
                  extraPhotoUri: '',
                  extraPhotoDataUri: '',
                  photoNote: ''
                })}
              >
                <Text style={styles.photoOverlayDeleteText}>🗑</Text>
              </TouchableOpacity>
            </View>
          ) : <Text style={styles.label}>No extra photo added.</Text>}
          <View style={styles.rowGap}>
            <TouchableOpacity style={styles.btn} onPress={captureExtraPhoto}><Text style={styles.btnText}>Capture Extra Photo</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={pickExtraPhotoFromLibrary}><Text style={styles.btnText}>Pick Extra Photo</Text></TouchableOpacity>
          </View>
          <Input label='Photo notes (optional)' value={opening.photoNote} onChangeText={v => setOpening({ ...opening, photoNote: v })} multiline />
        </>
      );
    default:
      return null;
  }
}

function SwipeArchiveItem({ item, onOpen, onDelete, compact = false, hasUnfinishedItem = false, syncStatus = 'synced' }) {
  return (
    <View style={[styles.card, compact ? { marginTop: 8 } : null]}>
      <TouchableOpacity style={styles.rowDeleteXFloating} onPress={onDelete}>
        <Text style={styles.rowDeleteXText}>X</Text>
      </TouchableOpacity>
      <View style={styles.cardTitleRow}>
        <TouchableOpacity style={{ flex: 1, paddingRight: 28 }} onPress={onOpen}>
          <Text style={styles.cardTitle}>{item.job?.jobName || '-'}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={onOpen}>
        <Text style={styles.cardTextCompact}>{item.job?.address || '-'}</Text>
        <Text style={styles.cardTextCompact}>Measured: {formatDateForMainList(item.job?.measureDate)}</Text>
        <Text style={styles.cardTextCompact}>Items: {item.counts?.total || 0}</Text>
        {hasUnfinishedItem ? <Text style={[styles.cardTextCompact, { color: UI.primaryDeep, fontWeight: '900' }]}>Unfinished item in progress</Text> : null}
      </TouchableOpacity>
      <View style={styles.syncFooterRow}>
        {syncStatus === 'synced' ? (
          <View style={styles.syncBadgeSynced}>
            <Text style={styles.syncBadgeText}>✓</Text>
          </View>
        ) : (
          <View style={styles.syncBadgePending}>
            <Text style={styles.syncBadgeText}>…</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Input({ label, ...props }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={UI.muted} style={[styles.input, props.multiline && { minHeight: 80 }]} {...props} />
    </View>
  );
}

function PickerLike({ label, options, value, onChange }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {options.map(opt => (
          <TouchableOpacity key={opt} style={[styles.pill, value === opt && styles.pillOn]} onPress={() => onChange(opt)}>
            <Text style={[styles.pillText, value === opt && styles.pillTextOn]}>{opt}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function MultiPickTwo({ options, values, onChange }) {
  const toggle = (opt) => {
    const has = values.includes(opt);
    if (has) return onChange(values.filter(v => v !== opt));
    if (values.length >= 2) return;

    const next = [...values, opt];
    const hasClear = next.includes('Clear');
    const hasPrivacy = next.includes('Privacy');
    if (hasClear && hasPrivacy) {
      Alert.alert('Invalid combination', 'Clear and Privacy cannot be selected together.');
      return;
    }

    onChange(next);
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
      {options.map(opt => {
        const on = values.includes(opt);
        return (
          <TouchableOpacity key={opt} style={[styles.pill, on && styles.pillOn]} onPress={() => toggle(opt)}>
            <Text style={[styles.pillText, on && styles.pillTextOn]}>{opt}</Text>
          </TouchableOpacity>
        );
      })}
      <View style={{ justifyContent: 'center', paddingHorizontal: 8 }}>
        <Text style={styles.label}>{values.length}/2 selected (min 1)</Text>
      </View>
    </ScrollView>
  );
}

function SummaryRow({ label, value }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value || '-'}</Text>
    </View>
  );
}

function OpeningDetailRow({ label, value, multiline = false }) {
  return (
    <View style={[styles.summaryRow, multiline ? { alignItems: 'flex-start' } : null]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, multiline ? styles.summaryValueMultiline : null]}>{value || '-'}</Text>
    </View>
  );
}

function OperationSubmenu({ opening, setOpening }) {
  if (opening.openingType === 'Door') {
    if (opening.subtype === 'Multi-slide') {
      return <Input label="Pattern (X/O/P + free text) *" value={opening.configA} onChangeText={v => setOpening({ ...opening, configA: v })} />;
    }
    if (opening.subtype === 'Bi-folding') {
      return (
        <>
          <PickerLike label="Stack side *" value={opening.configA} options={['R', 'L']} onChange={v => setOpening({ ...opening, configA: v })} />
          <Input label="Panel pattern (X count/free text) *" value={opening.configB} onChangeText={v => setOpening({ ...opening, configB: v })} />
          <PickerLike label="In/Out *" value={opening.configC} options={['In', 'Out']} onChange={v => setOpening({ ...opening, configC: v })} />
        </>
      );
    }
    if (opening.subtype === 'Patio Sliding Door') {
      return <Input label="Pattern (X/O only) *" value={opening.configA} onChangeText={v => setOpening({ ...opening, configA: v })} />;
    }
    if (opening.subtype === 'Swinging Door') {
      return (
        <>
          <PickerLike label="Single / Double *" value={opening.configA} options={['Single', 'Double']} onChange={v => setOpening({ ...opening, configA: v })} />
          <PickerLike label="In/Out swing *" value={opening.configB} options={['In Swing', 'Out Swing']} onChange={v => setOpening({ ...opening, configB: v })} />
          <PickerLike label="Handing *" value={opening.configC} options={['L Hand', 'R Hand']} onChange={v => setOpening({ ...opening, configC: v })} />
        </>
      );
    }
  }

  if (opening.openingType === 'Skylight') {
    return (
      <>
        {opening.subtype === 'Curb mount' ? (
          <PickerLike
            label="Measurement type *"
            value={opening.configA}
            options={SKYLIGHT_CURB_MEAS_TYPES}
            onChange={v => setOpening({ ...opening, configA: v })}
          />
        ) : null}
        <PickerLike
          label="Slope check (roof pitch) *"
          value={opening.configB}
          options={SKYLIGHT_PITCH_OPTIONS}
          onChange={v => setOpening({ ...opening, configB: v })}
        />
        <PickerLike
          label="Roof type *"
          value={opening.configC}
          options={['Low', 'High']}
          onChange={v => setOpening({ ...opening, configC: v })}
        />
        <Text style={styles.cardText}>Low = shingles/metal/concrete tile. High = Spanish tile/shakes.</Text>
      </>
    );
  }

  // Window
  if (opening.subtype === 'Casement') {
    return <PickerLike label="Casement handing *" value={opening.configA} options={['LH', 'RH']} onChange={v => setOpening({ ...opening, configA: v })} />;
  }
  if (opening.subtype === 'Slider') {
    return <PickerLike label="Slider pattern *" value={opening.configA} options={['XO', 'OX', 'XOX']} onChange={v => setOpening({ ...opening, configA: v })} />;
  }
  if (opening.subtype === 'Picture Window') {
    return <PickerLike label="Picture window type *" value={opening.configA} options={['Direct Set', 'Picture Frame']} onChange={v => setOpening({ ...opening, configA: v })} />;
  }
  if (opening.subtype === 'Other') {
    return <Input label="Window type description *" value={opening.configA} onChangeText={v => setOpening({ ...opening, configA: v })} placeholder="Describe window type" />;
  }
  return null;
}

function normalizeDateToMMDDYYYY(v) {
  const s = (v || '').toString().trim();
  if (!s) return '';
  if (!/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  const [a, b, y] = s.split('-');
  const first = Number(a);
  const second = Number(b);

  // Clearly DD-MM-YYYY (e.g., 28-03-2026) -> flip
  if (first > 12 && second >= 1 && second <= 12) return `${b}-${a}-${y}`;

  // Assume already MM-DD-YYYY in all other valid cases (ambiguous dates kept as entered)
  return `${a}-${b}-${y}`;
}

function formatDateForMainList(v) {
  const s = (v || '').toString().trim();
  if (!s) return '-';
  return normalizeDateToMMDDYYYY(s);
}

function isValidQty(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1;
}

function isValidDateMMDDYYYY(v) {
  const s = (v || '').toString().trim();
  if (!/^\d{2}-\d{2}-\d{4}$/.test(s)) return false;
  const [mm, dd, yyyy] = s.split('-').map(Number);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || yyyy < 2000) return false;
  return true;
}

function isValidMeasurement(v) {
  const s = (v || '').toString().trim();
  if (!s) return false;
  // Decimal up to 2 places: 23 or 23.5 or 23.25
  if (/^\d+(\.\d{1,2})?$/.test(s)) return true;
  // Fraction: 1/2 or (1/2)
  if (/^\(?\d+\/\d+\)?$/.test(s)) return true;
  // Mixed number: 23 1/2 or 23 (1/2)
  if (/^\d+\s+\(?\d+\/\d+\)?$/.test(s)) return true;
  return false;
}

function isValidInchFractionMeasurement(v) {
  const s = (v || '').toString().trim();
  if (!s) return false;
  if (/^\d+$/.test(s)) return true;
  if (/^\(?\d+\/\d+\)?$/.test(s)) return true;
  if (/^\d+\s+\(?\d+\/\d+\)?$/.test(s)) return true;
  return false;
}

function formatMeasurementToQuarterInches(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';

  const roundedQuarters = Math.round(n * 4);
  const whole = Math.floor(roundedQuarters / 4);
  const remainder = roundedQuarters % 4;

  if (remainder === 0) return String(whole);
  if (whole === 0) {
    if (remainder === 1) return '1/4';
    if (remainder === 2) return '1/2';
    return '3/4';
  }

  if (remainder === 1) return `${whole} 1/4`;
  if (remainder === 2) return `${whole} 1/2`;
  return `${whole} 3/4`;
}

function buildOperation(opening) {
  if (opening.openingType === 'Door') {
    if (opening.subtype === 'Multi-slide') return opening.configA?.trim() ? `Multi-slide: ${opening.configA.trim()}` : '';
    if (opening.subtype === 'Bi-folding') return opening.configA && opening.configB && opening.configC ? `Bi-folding: ${opening.configA} | ${opening.configB} | ${opening.configC}` : '';
    if (opening.subtype === 'Patio Sliding Door') return opening.configA?.trim() ? `Patio Sliding Door: ${opening.configA.trim()}` : '';
    if (opening.subtype === 'Swinging Door') return opening.configA && opening.configB && opening.configC ? `Swinging Door: ${opening.configA} | ${opening.configB} | ${opening.configC}` : '';
    return '';
  }

  if (opening.openingType === 'Skylight') {
    if (opening.subtype === 'Deck mount') {
      return opening.configB && opening.configC ? `Skylight Deck mount | Pitch ${opening.configB} | Roof ${opening.configC}` : '';
    }
    if (opening.subtype === 'Curb mount') {
      return opening.configA && opening.configB && opening.configC
        ? `Skylight Curb mount | ${opening.configA} | Pitch ${opening.configB} | Roof ${opening.configC}`
        : '';
    }
    return '';
  }

  if (opening.subtype === 'DH' || opening.subtype === 'SH' || opening.subtype === 'Awning') return opening.subtype;
  if (opening.subtype === 'Casement') return opening.configA ? `Casement ${opening.configA}` : '';
  if (opening.subtype === 'Slider') return opening.configA || '';
  if (opening.subtype === 'Picture Window') return opening.configA || '';
  if (opening.subtype === 'Other') return opening.configA ? `Other: ${opening.configA}` : '';
  return '';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: UI.bg },
  introSafe: { flex: 1, backgroundColor: '#000' },
  introWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  introVideoFrame: { width: '92%', maxWidth: 420, aspectRatio: 9 / 16, alignItems: 'center', justifyContent: 'center' },
  introVideo: { width: '100%', height: '100%' },
  introOverlay: { position: 'absolute', left: 0, right: 0, bottom: 26, alignItems: 'center' },
  stampBlock: {
    width: '96%',
    maxWidth: 520,
    backgroundColor: '#0b0b0c',
    borderWidth: 4,
    borderColor: '#4b5563',
    borderRadius: 10,
    paddingVertical: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.78,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 }
  },
  stampLogo: { width: '100%', height: 320 },
  dustWrap: {
    width: '88%',
    maxWidth: 410,
    height: 24,
    marginTop: -4,
    marginBottom: -2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  dustPuff: {
    backgroundColor: '#e5e7eb',
    borderRadius: 999,
    opacity: 0.78
  },
  dustPuffLeft: { width: 44, height: 8 },
  dustPuffMid: { width: 60, height: 10 },
  dustPuffRight: { width: 44, height: 8 },
  dustPuffSmall: { width: 24, height: 6, opacity: 0.58 },
  stampTextBlock: {
    marginTop: 14,
    backgroundColor: '#0f0f10',
    borderWidth: 3,
    borderColor: '#3f3f46',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stampText: { color: '#f3f4f6', fontSize: 20, fontWeight: '900', letterSpacing: 2.4, textAlign: 'center' },
  introTapHint: { color: '#9ca3af', marginTop: 18, fontSize: 12, textAlign: 'center', letterSpacing: 0.4 },
  container: { padding: 18, paddingTop: 12, paddingBottom: 96 },
  logo: { width: 180, height: 60, alignSelf: 'center', marginBottom: 4 },
  logoLarge: { width: '78%', maxWidth: 310, height: 96, alignSelf: 'center', marginTop: 2, marginBottom: 16 },
  h1: { color: UI.ink, fontSize: 28, fontWeight: '900', marginBottom: 8, textAlign: 'center', letterSpacing: -0.4 },
  authWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 22, gap: 12 },
  authSubtitle: { color: UI.muted, textAlign: 'center', marginBottom: 8, fontSize: 16, lineHeight: 23 },
  authFinePrint: { color: UI.muted, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  authErrorText: { color: UI.danger, fontSize: 13, fontWeight: '800', textAlign: 'center', marginTop: 6 },
  authTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  authTopRowPinned: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  authUserText: { color: UI.muted, fontSize: 13, flex: 1, marginRight: 8, fontWeight: '700' },
  authUserTextPinned: { color: UI.muted, fontSize: 13, flex: 1, marginRight: 8, textAlign: 'left', fontWeight: '800', opacity: 0.9 },
  authActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  authRefreshBtn: { backgroundColor: UI.surfaceWarm, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: UI.border },
  authSignOutBtn: { backgroundColor: UI.surfaceWarm, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: UI.border },
  authSignOutText: { color: UI.ink, fontSize: 13, fontWeight: '900' },
  loginBtnCompact: { backgroundColor: UI.primary, alignSelf: 'center', borderRadius: 16, paddingHorizontal: 34, paddingVertical: 14, minWidth: 150, marginTop: 8 },
  passwordInputWrap: { width: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: UI.surface, borderRadius: 16, borderWidth: 1.5, borderColor: UI.border, minHeight: 54 },
  passwordInput: { flex: 1, color: UI.ink, padding: 14, paddingRight: 8, fontSize: 17 },
  passwordEyeButton: { width: 54, height: 42, alignItems: 'center', justifyContent: 'center' },
  passwordEyeIconImage: { width: 30, height: 30 },
  stayLoggedInRow: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, marginBottom: 2 },
  checkboxBox: { width: 24, height: 24, borderRadius: 8, borderWidth: 1.5, borderColor: UI.borderStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: UI.surface },
  checkboxBoxOn: { backgroundColor: BRAND.orange, borderColor: BRAND.orange },
  checkboxCheck: { color: '#fff', fontSize: 14, fontWeight: '900', lineHeight: 16 },
  stayLoggedInText: { color: UI.ink, fontSize: 14, fontWeight: '800' },
  editBadge: { color: UI.primaryDeep, textAlign: 'center', marginBottom: 8, fontWeight: '900' },
  progress: { color: UI.secondary, marginBottom: 8, fontSize: 17, fontWeight: '900' },
  stepTitle: { color: UI.ink, fontSize: 22, fontWeight: '900', marginBottom: 14, letterSpacing: -0.25 },
  errorText: { color: UI.danger, marginBottom: 12, fontWeight: '800', fontSize: 14 },
  section: { color: UI.primaryDeep, fontSize: 19, fontWeight: '900', marginTop: 18, marginBottom: 12, letterSpacing: -0.2 },
  syncDebugStrip: { backgroundColor: UI.surfaceWarm, borderWidth: 1, borderColor: UI.border, borderRadius: 14, padding: 10, marginBottom: 10, gap: 2 },
  syncDebugText: { color: UI.muted, fontSize: 12 },
  label: { color: UI.ink, marginBottom: 7, fontSize: 17, fontWeight: '800' },
  input: { backgroundColor: UI.surface, color: UI.ink, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, borderWidth: 1.5, borderColor: UI.border, fontSize: 18, minHeight: 56 },
  photoPreviewWrap: { position: 'relative', marginBottom: 10 },
  previewPhoto: { width: '100%', height: 230, borderRadius: 22, borderWidth: 2, borderColor: UI.borderStrong },
  photoOverlayDelete: { position: 'absolute', right: 12, bottom: 12, width: 44, height: 44, borderRadius: 16, backgroundColor: 'rgba(255,253,248,0.94)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: UI.borderStrong },
  photoOverlayDeleteText: { fontSize: 17, color: UI.ink },
  cardTopRow: { flexDirection: 'row', alignItems: 'center' },
  titleQtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 1 },
  qtyInputInline: { backgroundColor: UI.secondarySoft, borderWidth: 1, borderColor: '#9accc4', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, minWidth: 54, alignItems: 'center' },
  qtyText: { color: UI.secondary, fontWeight: '900', fontSize: 14 },
  cardTextCompact: { color: UI.muted, fontSize: 15, lineHeight: 20 },
  qtyMenuItem: { paddingVertical: 11, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: UI.faint },
  qtyDeleteItem: { backgroundColor: 'transparent', marginTop: 6, marginBottom: 4 },
  qtyMenuText: { color: UI.ink, fontWeight: '900', fontSize: 16 },
  qtyDeleteIcon: { color: UI.danger, fontWeight: '900', borderWidth: 1, borderColor: '#f1b5ae', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  qtyCustomWrap: { padding: 12, borderTopWidth: 1, borderTopColor: UI.faint },
  qtyCustomLabel: { color: UI.muted, fontSize: 13, fontWeight: '800', marginBottom: 7 },
  qtyCustomInput: { backgroundColor: UI.surface, color: UI.ink, borderWidth: 1, borderColor: UI.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  qtyCustomBtn: { marginTop: 9, backgroundColor: UI.secondary, borderRadius: 12, alignItems: 'center', paddingVertical: 10 },
  qtyCustomBtnText: { color: '#fff', fontWeight: '700' },
  rightRailCompact: { width: 118, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 4 },
  sideActions: { width: 38, gap: 3 },
  thumbPhoto: { width: 66, height: 66, borderRadius: 16, borderWidth: 1.5, borderColor: UI.border },
  thumbPlaceholder: { width: 66, height: 66, borderRadius: 16, borderWidth: 1.5, borderColor: UI.border, alignItems: 'center', justifyContent: 'center', backgroundColor: UI.surfaceWarm },
  smallActionBtn: { width: 38, backgroundColor: 'transparent', borderRadius: 7, paddingVertical: 4, alignItems: 'center' },
  sideActionBtn: { width: 38, paddingVertical: 3 },
  smallActionText: { color: UI.ink, fontSize: 15, fontWeight: '900' },
  smallActionIcon: { color: UI.ink, fontSize: 17, fontWeight: '900', lineHeight: 19 },
  pill: { paddingHorizontal: 15, paddingVertical: 11, borderRadius: 999, borderWidth: 1.5, borderColor: UI.border, marginRight: 9, backgroundColor: UI.surface },
  pillOn: { backgroundColor: UI.secondary, borderColor: UI.secondary },
  pillText: { color: UI.ink, fontSize: 16, fontWeight: '800' },
  pillTextOn: { color: 'white' },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 16 },
  btn: {
    flex: 1,
    backgroundColor: UI.primary,
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: 'center',
    marginTop: 10,
    minHeight: 58,
    justifyContent: 'center',
    shadowColor: UI.primaryDeep,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 }
  },
  btnAlt: { backgroundColor: UI.secondary },
  btnGhost: { backgroundColor: UI.slate },
  btnDeleteProject: { backgroundColor: UI.danger },
  btnSaveExit: { backgroundColor: '#f59e0b' },
  btnText: { color: 'white', fontWeight: '900', textAlign: 'center', fontSize: 18, letterSpacing: -0.1 },
  homePrimaryAction: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: UI.primary,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#fed7aa',
    paddingHorizontal: 20,
    paddingVertical: 18,
    marginTop: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: UI.primaryDeep,
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }
  },
  homePrimaryActionIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  homePrimaryActionIconText: { color: '#fff', fontSize: 26, fontWeight: '900', lineHeight: 28 },
  homePrimaryActionCopy: { alignItems: 'flex-start' },
  homePrimaryActionText: { color: '#fff', fontSize: 20, fontWeight: '900', lineHeight: 24, letterSpacing: -0.2 },
  homePrimaryActionSubtext: { color: '#fff7ed', fontSize: 14, fontWeight: '800', marginTop: 2 },
  card: {
    backgroundColor: UI.surface,
    borderColor: UI.border,
    borderWidth: 1.5,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    overflow: 'visible',
    shadowColor: '#8b6f5e',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 }
  },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardTitle: { color: UI.ink, fontWeight: '900', marginBottom: 2, fontSize: 18, lineHeight: 22 },
  summaryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  summarySyncWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, marginBottom: 8, flexShrink: 1, justifyContent: 'flex-end' },
  summarySyncText: { color: UI.secondary, fontSize: 13, fontWeight: '900', textAlign: 'right' },
  summaryInfoCard: { backgroundColor: UI.surface, borderColor: UI.border, borderWidth: 1.5, borderRadius: 24, padding: 16, marginBottom: 12 },
  summaryInfoCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: UI.faint },
  summaryInfoCardTitle: { color: UI.muted, fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.6 },
  summaryEditPencil: { width: 42, height: 42, borderRadius: 15, backgroundColor: UI.surfaceWarm, borderWidth: 1.5, borderColor: UI.border, alignItems: 'center', justifyContent: 'center' },
  openingDetailCard: { width: '92%', maxWidth: 540, maxHeight: '84%', backgroundColor: UI.surface, borderWidth: 1.5, borderColor: UI.border, borderRadius: 26, padding: 18 },
  openingDetailHeader: { position: 'relative', paddingRight: 64, paddingTop: 6, marginBottom: 8 },
  openingDetailCloseBtn: { position: 'absolute', right: 4, top: 1, width: 38, height: 38, borderRadius: 14, backgroundColor: UI.surfaceWarm, borderWidth: 1.5, borderColor: UI.borderStrong, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  syncLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  syncFooterRow: { marginTop: 4, alignItems: 'flex-end', minHeight: 20 },
  syncBadgeSynced: { width: 20, height: 20, borderRadius: 10, backgroundColor: UI.secondary, borderWidth: 1, borderColor: UI.secondarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 0 },
  syncBadgePending: { width: 20, height: 20, borderRadius: 10, backgroundColor: UI.slate, borderWidth: 1, borderColor: UI.borderStrong, alignItems: 'center', justifyContent: 'center', marginRight: 0 },
  syncBadgeText: { color: '#fff', fontSize: 12, fontWeight: '900', lineHeight: 13 },
  scanStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  scanStatusText: { color: UI.muted, fontSize: 12, lineHeight: 16, marginTop: 6 },
  unfinishedBadge: { color: UI.primaryDeep, fontSize: 12, fontWeight: '900', borderWidth: 1, borderColor: '#fdba74', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: '#fff7ed' },
  rowDeleteX: { width: 22, height: 22, borderRadius: 8, backgroundColor: UI.danger, alignItems: 'center', justifyContent: 'center' },
  rowDeleteXFloating: { position: 'absolute', right: 10, top: 8, width: 22, height: 22, borderRadius: 8, backgroundColor: UI.danger, alignItems: 'center', justifyContent: 'center', zIndex: 6 },
  rowDeleteXText: { color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 12 },
  cardText: { color: UI.muted, fontSize: 14, lineHeight: 18, marginBottom: 2 },
  rowGap: { gap: 8, marginTop: 10 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  summaryLabel: { color: UI.muted, fontSize: 15, fontWeight: '800' },
  summaryValue: { color: UI.ink, maxWidth: '65%', textAlign: 'right', fontSize: 15, fontWeight: '900' },
  summaryValueMultiline: { textAlign: 'left', maxWidth: '60%' },
  footerLine: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: UI.faint },
  footerLineText: { color: UI.ink, fontWeight: '900', fontSize: 15 },
  lockedRow: { backgroundColor: UI.surfaceWarm, borderWidth: 1, borderColor: UI.border, borderRadius: 16, padding: 13, marginBottom: 12 },
  lockedText: { color: UI.ink, fontWeight: '800' },
  reportChooser: { backgroundColor: UI.surface, borderWidth: 1.5, borderColor: UI.border, borderRadius: 20, padding: 14 },
  reportChooserActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  swipeHint: { color: UI.danger, fontSize: 12, fontWeight: '800', marginTop: 7 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(37,48,64,0.35)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  qtyPickerCard: { width: 138, maxHeight: 420, backgroundColor: UI.surface, borderWidth: 1.5, borderColor: UI.border, borderRadius: 18, overflow: 'hidden' },
  confirmCard: { width: '88%', maxWidth: 390, backgroundColor: UI.surface, borderWidth: 1.5, borderColor: UI.border, borderRadius: 24, padding: 20 },
  confirmTitle: { color: UI.ink, fontSize: 20, fontWeight: '700', lineHeight: 27, marginBottom: 8 },
  confirmBody: { color: UI.muted, fontSize: 16, lineHeight: 23, fontWeight: '700' },
  confirmActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 12 },
  confirmBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  confirmNo: { backgroundColor: UI.slate },
  confirmYes: { backgroundColor: UI.danger },
  confirmBtnText: { color: 'white', fontSize: 16, fontWeight: '800' },
  confirmIcon: { color: 'white', fontSize: 18, fontWeight: '800' },
});
