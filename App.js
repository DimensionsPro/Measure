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
const APP_LOGO = require('./app/assets/logo.jpg');
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
  const [entryMode, setEntryMode] = useState('create'); // create | edit | copy
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

  const archiveKey = 'lion_field_measure_archive_v1';
  const trashKey = 'lion_field_measure_trash_v1';
  const draftKey = 'lion_field_measure_draft_v1';

  const refreshPendingMeasurements = () => {
    try {
      const queue = loadQueue() || [];
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

  const showSyncBanner = offlineMode || syncState === 'syncing' || syncState === 'error';
  const syncBannerText = offlineMode || syncState === 'offline'
    ? "You're working offline — saving locally now. Cloud backup will resume instantly when reception returns."
    : syncState === 'syncing'
      ? 'Saving to cloud backup…'
      : 'Saved locally. Cloud backup retrying in background…';

  const pruneToOneYear = (items) => {
    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
    return (items || []).filter(x => new Date(x.savedAt).getTime() >= cutoff);
  };

  const stripPhotosFromMeasurement = (m) => ({
    ...m,
    openings: (m.openings || []).map(o => ({ ...o, photoUri: '' }))
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
          const queue = loadQueue() || [];
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
          opening: payload.opening ? { ...payload.opening, photoUri: '' } : payload.opening,
          openings: (payload.openings || []).map(o => ({ ...o, photoUri: '' }))
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
      case 2: return isValidMeasurement(opening.width) && isValidMeasurement(opening.height);
      case 3: return opening.openingType === 'Skylight' ? true : isValidMeasurement(opening.jamb);
      case 4: return !!opening.photoUri;
      case 5: return opening.openingType === 'Skylight' ? true : !!opening.basis;
      case 6: return opening.openingType === 'Skylight' ? true : (opening.glassSelections.length >= 1 && opening.glassSelections.length <= 2);
      case 7: return opening.openingType === 'Skylight' ? true : (!!opening.tempered && !!opening.fireZone && !!opening.fallingHazard && !!opening.egress);
      case 8: return opening.openingType === 'Skylight' ? true : (opening.grids === 'No' || (!!opening.gridType && !!opening.gridDesign));
      case 9: return opening.openingType === 'Skylight' ? true : !!opening.installType;
      case 10: return true;
      case 11: return true;
      default: return true;
    }
  }, [step, job, opening]);

  const isStepRelevant = (s, openingType) => {
    if (openingType !== 'Skylight') return true;
    // For skylights, skip window/door-only stages.
    const skylightSkipped = [3, 5, 6, 7, 8, 9]; // jamb, basis, glass, tempered/fire, grids, install
    return !skylightSkipped.includes(s);
  };

  const getStepError = () => {
    switch (step) {
      case 0: return 'Please fill Job Name, Address, and Date in MM-DD-YYYY format.';
      case 1: return 'Please complete Room, Opening ID, Quantity, and subtype selection details.';
      case 2: return 'Please enter valid Width and Height (fractions with optional brackets, or up to 2 decimals).';
      case 3: return opening.openingType === 'Skylight' ? '' : 'Please enter a valid Jamb size (fractions with optional brackets, or up to 2 decimals).';
      case 4: return 'Please capture or select a photo for this item.';
      case 6: return 'Please choose 1 or 2 glass options.';
      case 8: return 'Grid type and design are required when Grids = Yes.';
      default: return 'Please complete required fields before continuing.';
    }
  };

  const next = () => {
    if (!stepValid) {
      setValidationError(getStepError());
      return;
    }
    setValidationError('');
    if (step >= totalSteps) return;
    let ns = step + 1;
    while (ns < totalSteps && !isStepRelevant(ns, opening.openingType)) ns += 1;
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
    if (!opening.room || !opening.openingCode || !isValidQty(opening.qty) || !opening.photoUri || !opening.width || !opening.height || (opening.openingType !== 'Skylight' && !opening.jamb) || (opening.openingType !== 'Skylight' && !opening.installType) || !resolvedOperation) {
      Alert.alert('Missing required fields', 'Please complete required opening fields.');
      return false;
    }
    if (!isValidMeasurement(opening.width) || !isValidMeasurement(opening.height) || (opening.openingType !== 'Skylight' && !isValidMeasurement(opening.jamb))) {
      Alert.alert('Invalid size format', 'Use fractions (e.g., 23 1/2 or 23 (1/2)) or decimals up to 2 places (e.g., 23.25).');
      return false;
    }
    if (opening.grids === 'Yes' && (!opening.gridType || !opening.gridDesign)) {
      Alert.alert('Grid details required', 'Please add grid type and design.');
      return false;
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
      enqueueChange({ entity: 'measurement', entityId: payload.id, op: 'upsert', payload: sanitizeMeasurementForCloud(payload) });
      const syncResult = await syncNow();
      if (!syncResult?.ok) {
        Alert.alert('Saved locally', 'Measurement is saved on this device and will upload to cloud automatically when connection/service is available.');
      }
    } catch {
      Alert.alert('Saved locally', 'Measurement is saved on this device. Cloud sync will retry automatically.');
    }

    setEditIndex(null);
    setEditOpeningUid(null);
    setEntryMode('create');
    setOpening(emptyOpening);
    return true;
  };

  const finishOpening = async () => {
    const ok = await saveCurrentOpening();
    if (ok) {
      await clearDraft();
      setStep(totalSteps);
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
      enqueueChange({ entity: 'measurement', entityId: payload.id, op: 'upsert', payload: sanitizeMeasurementForCloud(payload) });
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

    enqueueChange({ entity: 'measurement', entityId: payload.id, op: 'upsert', payload: sanitizeMeasurementForCloud(payload) });
    await syncNow();

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
    refreshPendingMeasurements();
    const t = setInterval(() => refreshPendingMeasurements(), 3000);
    return () => clearInterval(t);
  }, []);

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

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
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

  const openConfirm = (message, onConfirm) => {
    setConfirmState({ visible: true, message, onConfirm });
  };

  const closeConfirm = () => setConfirmState({ visible: false, message: '', onConfirm: null });

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
    enqueueChange({ entity: 'measurement', entityId: id, op: 'delete', payload: null });
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

    enqueueChange({ entity: 'measurement', entityId: restored.id, op: 'upsert', payload: sanitizeMeasurementForCloud(restored) });
    await syncNow();
  };

  const confirmDeleteArchivedJob = (id, name) => {
    openConfirm(`Delete "${name || 'this measurement'}"?`, async () => {
      playDeleteSound();
      await deleteArchivedJob(id);
      closeConfirm();
    });
  };

  const deleteOpening = (idx) => {
    openConfirm('Remove this item from the current measurement?', async () => {
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
    });
  };

  const openArchivedJob = (saved) => {
    // If this measurement has a linked unfinished draft item, resume draft state directly.
    if (draftData?.measurementId && draftData.measurementId === saved.id) {
      resumeDraft();
      setShowArchive(false);
      return;
    }

    setShowHome(false);
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
    const PHOTO_SYNC_MAX_BYTES = 450 * 1024;
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
    const PHOTO_SYNC_MAX_BYTES = 450 * 1024;
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
      setOpening(prev => ({ ...prev, photoUri: stableData || asset.uri, photoDataUri: stableData || prev.photoDataUri || '' }));
    }
  };

  const pickPhotoFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Photo library access needed', 'Please allow photo library access.');
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: false, base64: Platform.OS === 'web' });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      const stableData = Platform.OS === 'web' ? await makeStableWebPhotoUri(asset) : await buildNativeCompressedDataUri(asset.uri);
      setOpening(prev => ({ ...prev, photoUri: stableData || asset.uri, photoDataUri: stableData || prev.photoDataUri || '' }));
    }
  };

  const scanFromCurrentPhoto = async (useCreditCard = false) => {
    if (!opening.photoUri && !opening.photoDataUri) {
      Alert.alert('Scan needs a photo', 'Capture or pick a head-on photo first.');
      return;
    }

    setScanBusy(true);
    try {
      const result = await analyzeWindowPhoto({
        photoUri: opening.photoDataUri || opening.photoUri,
        useCreditCard,
        Image
      });

      const t = SCAN_FIELD_SCHEMA.confidenceThresholdDefault || 0.7;
      const next = { ...opening };
      const f = result.fields || {};

      if (f.openingType?.confidence >= t && f.openingType?.value) {
        next.openingType = f.openingType.value;
      }
      if (f.subtype?.confidence >= t && f.subtype?.value) {
        next.subtype = f.subtype.value;
      }
      if (f.operation?.confidence >= t && f.operation?.value) {
        next.operation = f.operation.value;
      }
      if (f.hasGrids?.confidence >= t) {
        next.grids = f.hasGrids.value ? 'Yes' : 'No';
      }
      if (f.estimatedWidthIn?.confidence >= t && Number.isFinite(f.estimatedWidthIn.value)) {
        next.width = String(f.estimatedWidthIn.value);
      }
      if (f.estimatedHeightIn?.confidence >= t && Number.isFinite(f.estimatedHeightIn.value)) {
        next.height = String(f.estimatedHeightIn.value);
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

      Alert.alert(
        'DimensionSnap Analysis Complete',
        applied.length
          ? `Precision Scale Applied: ${applied.join(', ')} (rounded to nearest 1/4").\n\nPlease verify these values manually.`
          : 'Photo quality too low to scale automatically. Ensure your 1" marker or Credit Card is clearly visible and head-on.'
      );
    } catch (e) {
      Alert.alert('Scan failed', e?.message || 'Unable to analyze photo.');
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
    await shareOrDownload(csvPath, 'text/csv', 'Share Field Measurements Excel (CSV)');
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
          <ActivityIndicator size="large" color="#93c5fd" />
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
          <Text style={styles.h1}>Field Measurements</Text>
          <Text style={styles.authSubtitle}>Secure portal login</Text>

          <TextInput
            style={[styles.input, { width: '100%' }]}
            placeholder="Username"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            value={loginUsername}
            onChangeText={setLoginUsername}
          />
          <TextInput
            style={[styles.input, { width: '100%' }]}
            placeholder="Password"
            placeholderTextColor="#94a3b8"
            secureTextEntry
            value={loginPassword}
            onChangeText={setLoginPassword}
          />

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
                localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify({ username: 'dimensions' }));
              }
            } catch {}
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
            <Text style={styles.authUserTextPinned}>{authUser?.email || 'Signed in'}</Text>
            <View style={styles.authActionsRow}>
              <TouchableOpacity style={styles.authRefreshBtn} onPress={async () => {
                await syncNow().catch(() => {});
                await loadArchive();
              }}>
                <Text style={styles.authSignOutText}>Refresh</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.authSignOutBtn} onPress={() => {
                try {
                  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
                    localStorage.removeItem(LOCAL_AUTH_KEY);
                  }
                } catch {}
                setAuthUser(null);
                setLoginPassword('');
              }}>
                <Text style={styles.authSignOutText}>Sign out</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Image source={APP_LOGO} style={styles.logoLarge} resizeMode="contain" />
          <Text style={styles.h1}>Field Measurements</Text>
          {showSyncBanner ? <Text style={[styles.errorText, { color: syncState === 'error' ? '#fca5a5' : '#fbbf24' }]}>{syncBannerText}</Text> : null}
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#16a34a' }]} onPress={startNewMeasurement}>
            <Text style={styles.btnText}>+ Add New Measurement</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: '#334155' }]} onPress={exportBackupJson}>
              <Text style={styles.btnText}>Export Backup</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: '#475569' }]} onPress={importBackupJson}>
              <Text style={styles.btnText}>Import Backup</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: '#64748b' }]} onPress={importBackupFromClipboard}>
              <Text style={styles.btnText}>Import from Clipboard</Text>
            </TouchableOpacity>
          </View>

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
                <TouchableOpacity style={[styles.btn, { marginTop: 0, backgroundColor: '#0ea5e9' }]} onPress={() => restoreFromTrash(t.id)}>
                  <Text style={styles.btnText}>Restore</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>

        <Modal visible={confirmState.visible} transparent animationType="fade" onRequestClose={closeConfirm}>
          <Pressable style={styles.modalBackdrop} onPress={closeConfirm}>
            <View style={styles.confirmCard}>
              <Text style={styles.cardTitle}>{confirmState.message}</Text>
              <View style={styles.confirmActions}>
                <TouchableOpacity style={[styles.confirmBtn, styles.confirmNo]} onPress={closeConfirm}>
                  <Text style={styles.confirmIcon}>✖</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.confirmBtn, styles.confirmYes]} onPress={() => confirmState.onConfirm && confirmState.onConfirm()}>
                  <Text style={styles.confirmIcon}>✔</Text>
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
        <Text style={styles.h1}>Field Measure</Text>
        {showSyncBanner ? <Text style={[styles.errorText, { color: syncState === 'error' ? '#fca5a5' : '#fbbf24' }]}>{syncBannerText}</Text> : null}
        {entryMode === 'edit' && editIndex !== null && !isSummary ? <Text style={styles.editBadge}>Editing item #{editIndex + 1}</Text> : null}
        {entryMode === 'copy' && !isSummary ? <Text style={styles.editBadge}>Copy mode</Text> : null}
        <Text style={styles.progress}>Step {Math.min(step + 1, steps.length)} / {steps.length}</Text>
        <Text style={styles.stepTitle}>{steps[step]}</Text>
        {!isSummary && !!validationError ? <Text style={styles.errorText}>{validationError}</Text> : null}

        {!isSummary && renderStep(step, { job, setJob, opening, setOpening, capturePhoto, pickPhotoFromLibrary, scanFromCurrentPhoto, scanBusy })}

        {isSummary && (
          <View>
            <Text style={styles.section}>Overall Job Summary</Text>
            <View style={styles.syncLegendRow}>
              <View style={currentMeasurementSyncStatus === 'synced' ? styles.syncBadgeSynced : styles.syncBadgePending}>
                <Text style={styles.syncBadgeText}>{currentMeasurementSyncStatus === 'synced' ? '✓' : '…'}</Text>
              </View>
              <Text style={styles.cardTextCompact}>{currentMeasurementSyncStatus === 'synced' ? 'Uploaded to cloud' : 'Queued for cloud upload'}</Text>
            </View>
            <SummaryRow label="Job" value={job.jobName} />
            <SummaryRow label="Address" value={job.address} />
            <SummaryRow label="Date" value={job.measureDate} />
            <SummaryRow label="Job Site Contact" value={job.onSiteContact || '-'} />
            <SummaryRow label="Measured by" value={job.measuredBy || '-'} />
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={() => setShowJobInfoEditor(true)}>
              <Text style={styles.btnText}>Edit Job Information</Text>
            </TouchableOpacity>

            <Text style={styles.section}>Openings ({counts.total} items across {counts.lines} lines)</Text>
            {openings.map((o, i) => (
              <View key={`${o.openingCode}-${i}`} style={styles.card}>
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
              </View>
            ))}

            <View style={styles.footerLine}>
              <Text style={styles.footerLineText}>Windows: {windowCount}   |   Doors: {doorCount}   |   Skylights: {skylightCount}</Text>
            </View>

            <View style={styles.rowGap}>
              <TouchableOpacity style={styles.btn} onPress={addAnother}><Text style={styles.btnText}>Add an Item</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, styles.btnAlt]} onPress={exportReport}><Text style={styles.btnText}>Generate Quote-Ready Report</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { backgroundColor: '#475569' }]} onPress={backToMainPage}><Text style={styles.btnText}>Back to Main Page</Text></TouchableOpacity>

              {showArchive ? (
                <View style={styles.reportChooser}>
                  <Text style={styles.label}>Search by project name or address:</Text>
                  <TextInput
                    style={styles.input}
                    value={archiveQuery}
                    onChangeText={setArchiveQuery}
                    placeholder="Search archive..."
                    placeholderTextColor="#94a3b8"
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
                <View style={styles.reportChooser}>
                  <Text style={styles.label}>Choose report format:</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={[styles.btn, { marginTop: 0, backgroundColor: '#0ea5e9' }]} onPress={() => exportPdfShare()}>
                      <Text style={styles.btnText}>Share PDF</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btn, { marginTop: 0, backgroundColor: '#7c3aed' }]} onPress={() => exportExcelReport()}>
                      <Text style={styles.btnText}>Excel (.csv)</Text>
                    </TouchableOpacity>
                  </View>
                </View>
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
            {step < 11 ? (
              <TouchableOpacity style={styles.btn} onPress={next}><Text style={styles.btnText}>Next</Text></TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.btn} onPress={finishOpening}><Text style={styles.btnText}>{editIndex === null ? 'Finish Opening' : 'Save Changes'}</Text></TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.btn, styles.btnSaveExit]} onPress={saveAndExit}>
              <Text style={styles.btnText}>Save & Exit</Text>
            </TouchableOpacity>
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
                  placeholderTextColor="#94a3b8"
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

      <Modal visible={confirmState.visible} transparent animationType="fade" onRequestClose={closeConfirm}>
        <Pressable style={styles.modalBackdrop} onPress={closeConfirm}>
          <View style={styles.confirmCard}>
            <Text style={styles.cardTitle}>{confirmState.message}</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmNo]} onPress={closeConfirm}>
                <Text style={styles.confirmIcon}>X</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, styles.confirmYes]} onPress={() => confirmState.onConfirm && confirmState.onConfirm()}>
                <Text style={styles.confirmIcon}>✓</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function renderStep(step, ctx) {
  const { job, setJob, opening, setOpening, capturePhoto, pickPhotoFromLibrary, scanFromCurrentPhoto, scanBusy } = ctx;
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
              onPress={() => setOpening({ ...opening, measureMethod: 'manual' })}
            >
              <Text style={styles.btnText}>Manual Entry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#7c3aed' }, opening.measureMethod === 'snap' ? null : styles.btnGhost]}
              onPress={() => setOpening({ ...opening, measureMethod: 'snap' })}
            >
              <Text style={styles.btnText}>DimensionSnap</Text>
            </TouchableOpacity>
          </View>

          {opening.measureMethod === 'snap' ? (
            <>
              <Text style={styles.cardText}>Use a head-on photo with a 1" sticker OR a Credit Card visible.</Text>
              {(opening.photoDataUri || opening.photoUri) ? <Image source={{ uri: opening.photoDataUri || opening.photoUri }} style={styles.previewPhoto} /> : <Text style={styles.label}>No scan photo selected yet.</Text>}
              <View style={styles.rowGap}>
                <TouchableOpacity style={styles.btn} onPress={capturePhoto}><Text style={styles.btnText}>Capture Photo</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={pickPhotoFromLibrary}><Text style={styles.btnText}>Pick from Library</Text></TouchableOpacity>
              </View>
              <View style={styles.rowGap}>
                <TouchableOpacity style={[styles.btn, { backgroundColor: '#7c3aed', flex: 1 }]} onPress={() => scanFromCurrentPhoto(false)} disabled={scanBusy}>
                  <Text style={styles.btnText}>{scanBusy ? '...' : 'Scan (1" Sticker)'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, { backgroundColor: '#0284c7', flex: 1 }]} onPress={() => scanFromCurrentPhoto(true)} disabled={scanBusy}>
                  <Text style={styles.btnText}>{scanBusy ? '...' : 'Scan (Credit Card)'}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}

          <Input label='Width (in) *' value={opening.width} onChangeText={v => setOpening({ ...opening, width: v })} placeholder='e.g. 23 1/2 or 23.25' />
          <Input label='Height (in) *' value={opening.height} onChangeText={v => setOpening({ ...opening, height: v })} placeholder='e.g. 48 or 47.75' />
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
      return (
        <>
          {(opening.photoDataUri || opening.photoUri) ? <Image source={{ uri: opening.photoDataUri || opening.photoUri }} style={styles.previewPhoto} /> : <Text style={styles.label}>No photo captured yet.</Text>}
          <View style={styles.rowGap}>
            <TouchableOpacity style={styles.btn} onPress={capturePhoto}><Text style={styles.btnText}>Capture Photo</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnGhost]} onPress={pickPhotoFromLibrary}><Text style={styles.btnText}>Pick from Library</Text></TouchableOpacity>
          </View>
          <Input label="Photo note" value={opening.photoNote} onChangeText={v => setOpening({ ...opening, photoNote: v })} />
        </>
      );
    case 5:
      return opening.openingType === 'Skylight' ? (
        <Text style={styles.cardText}>Net frame / rough opening does not apply to skylights. Skipping this step.</Text>
      ) : (
        <>
          <PickerLike label='Measurement basis (W/H only) *' value={opening.basis} options={['Net frame', 'Rough opening']} onChange={v => setOpening({ ...opening, basis: v })} />
          <Text style={styles.cardText}>Basis selection affects width/height only. Jamb stays as inside size.</Text>
        </>
      );
    case 6:
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
    case 7:
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
    case 8:
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
    case 9:
      return opening.openingType === 'Skylight' ? (
        <Text style={styles.cardText}>Installation type does not apply to skylights (already defined by Deck/Curb mount). Skipping this step.</Text>
      ) : (
        <PickerLike label='Installation type *' value={opening.installType} options={INSTALL_TYPES} onChange={v => setOpening({ ...opening, installType: v })} />
      );
    case 10:
      return <Input label={opening.openingType === 'Skylight' ? 'Existing skylight type' : 'Existing window type'} value={opening.existingType} onChangeText={v => setOpening({ ...opening, existingType: v })} />;
    case 11:
      return <Input label='General notes' value={opening.notes} onChangeText={v => setOpening({ ...opening, notes: v })} multiline />;
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
        {hasUnfinishedItem ? <Text style={[styles.cardTextCompact, { color: '#fbbf24' }]}>Unfinished item in progress</Text> : null}
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
      <TextInput style={[styles.input, props.multiline && { minHeight: 80 }]} {...props} />
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
  safe: { flex: 1, backgroundColor: '#0f172a' },
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
  container: { padding: 16, paddingBottom: 80 },
  logo: { width: 180, height: 60, alignSelf: 'center', marginBottom: 6 },
  logoLarge: { width: 280, height: 100, alignSelf: 'center', marginBottom: 10, marginTop: 8 },
  h1: { color: 'white', fontSize: 22, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  authWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, gap: 10 },
  authSubtitle: { color: '#cbd5e1', textAlign: 'center', marginBottom: 8 },
  authFinePrint: { color: '#94a3b8', fontSize: 12, textAlign: 'center', marginTop: 6 },
  authErrorText: { color: '#fca5a5', fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  authTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  authTopRowPinned: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  authUserText: { color: '#94a3b8', fontSize: 12, flex: 1, marginRight: 8 },
  authUserTextPinned: { color: '#94a3b8', fontSize: 12, flex: 1, marginRight: 8, textAlign: 'left' },
  authActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  authRefreshBtn: { backgroundColor: '#1d4ed8', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  authSignOutBtn: { backgroundColor: '#334155', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  authSignOutText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  loginBtnCompact: { backgroundColor: '#2563eb', alignSelf: 'center', borderRadius: 10, paddingHorizontal: 28, paddingVertical: 10, minWidth: 132, marginTop: 6 },
  editBadge: { color: '#fbbf24', textAlign: 'center', marginBottom: 6, fontWeight: '700' },
  progress: { color: '#93c5fd', marginBottom: 8 },
  stepTitle: { color: 'white', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  errorText: { color: '#ef4444', marginBottom: 10, fontWeight: '700' },
  section: { color: '#93c5fd', fontSize: 16, fontWeight: '700', marginTop: 14, marginBottom: 10 },
  syncDebugStrip: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 8, padding: 8, marginBottom: 8, gap: 2 },
  syncDebugText: { color: '#94a3b8', fontSize: 12 },
  label: { color: '#cbd5e1', marginBottom: 4 },
  input: { backgroundColor: '#1e293b', color: 'white', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  previewPhoto: { width: '100%', height: 220, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  cardTopRow: { flexDirection: 'row', alignItems: 'center' },
  titleQtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: 1 },
  qtyInputInline: { backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, minWidth: 50, alignItems: 'center' },
  qtyText: { color: 'white', fontWeight: '700', fontSize: 13 },
  cardTextCompact: { color: '#cbd5e1', fontSize: 14, lineHeight: 17 },
  qtyMenuItem: { paddingVertical: 8, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  qtyDeleteItem: { backgroundColor: 'transparent', marginTop: 6, marginBottom: 4 },
  qtyMenuText: { color: 'white', fontWeight: '700' },
  qtyDeleteIcon: { color: '#ef4444', fontWeight: '700', borderWidth: 1, borderColor: '#ef4444', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  qtyCustomWrap: { padding: 10, borderTopWidth: 1, borderTopColor: '#1f2937' },
  qtyCustomLabel: { color: '#cbd5e1', fontSize: 12, marginBottom: 6 },
  qtyCustomInput: { backgroundColor: '#0f172a', color: '#fff', borderWidth: 1, borderColor: '#334155', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  qtyCustomBtn: { marginTop: 8, backgroundColor: '#2563eb', borderRadius: 8, alignItems: 'center', paddingVertical: 8 },
  qtyCustomBtnText: { color: '#fff', fontWeight: '700' },
  rightRailCompact: { width: 118, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 4 },
  sideActions: { width: 38, gap: 3 },
  thumbPhoto: { width: 62, height: 62, borderRadius: 7, borderWidth: 1, borderColor: '#334155' },
  thumbPlaceholder: { width: 62, height: 62, borderRadius: 7, borderWidth: 1, borderColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  smallActionBtn: { width: 38, backgroundColor: 'transparent', borderRadius: 7, paddingVertical: 4, alignItems: 'center' },
  sideActionBtn: { width: 38, paddingVertical: 3 },
  smallActionText: { color: 'white', fontSize: 14, fontWeight: '700' },
  smallActionIcon: { color: 'white', fontSize: 16, fontWeight: '700', lineHeight: 18 },
  pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#334155', marginRight: 8, backgroundColor: '#1e293b' },
  pillOn: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  pillText: { color: '#cbd5e1' },
  pillTextOn: { color: 'white' },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 12 },
  btn: { flex: 1, backgroundColor: '#22c55e', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  btnAlt: { backgroundColor: '#0ea5e9' },
  btnGhost: { backgroundColor: '#334155' },
  btnSaveExit: { backgroundColor: '#f59e0b' },
  btnText: { color: 'white', fontWeight: '700', textAlign: 'center' },
  card: { backgroundColor: '#1e293b', borderColor: '#334155', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, marginBottom: 6, overflow: 'visible' },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  cardTitle: { color: 'white', fontWeight: '700', marginBottom: 1, fontSize: 15, lineHeight: 18 },
  syncLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  syncFooterRow: { marginTop: 4, alignItems: 'flex-end', minHeight: 20 },
  syncBadgeSynced: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#16a34a', borderWidth: 1, borderColor: '#bbf7d0', alignItems: 'center', justifyContent: 'center', marginRight: 0 },
  syncBadgePending: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#64748b', borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center', marginRight: 0 },
  syncBadgeText: { color: '#fff', fontSize: 12, fontWeight: '900', lineHeight: 13 },
  unfinishedBadge: { color: '#fbbf24', fontSize: 11, fontWeight: '800', borderWidth: 1, borderColor: '#fbbf24', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  rowDeleteX: { width: 18, height: 18, borderRadius: 4, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  rowDeleteXFloating: { position: 'absolute', right: 8, top: 6, width: 18, height: 18, borderRadius: 4, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center', zIndex: 6 },
  rowDeleteXText: { color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 12 },
  cardText: { color: '#cbd5e1', fontSize: 12, lineHeight: 14, marginBottom: 1 },
  rowGap: { gap: 8, marginTop: 10 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  summaryLabel: { color: '#94a3b8' },
  summaryValue: { color: 'white', maxWidth: '65%', textAlign: 'right' },
  footerLine: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#334155' },
  footerLineText: { color: '#e2e8f0', fontWeight: '700' },
  lockedRow: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', borderRadius: 8, padding: 10, marginBottom: 10 },
  lockedText: { color: '#e2e8f0', fontWeight: '700' },
  reportChooser: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155', borderRadius: 10, padding: 10 },
  swipeHint: { color: '#fca5a5', fontSize: 11, marginTop: 6 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  qtyPickerCard: { width: 120, maxHeight: 420, backgroundColor: '#111827', borderWidth: 1, borderColor: '#334155', borderRadius: 10, overflow: 'hidden' },
  confirmCard: { width: '86%', maxWidth: 360, backgroundColor: '#111827', borderWidth: 1, borderColor: '#334155', borderRadius: 12, padding: 14 },
  confirmActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 12 },
  confirmBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  confirmNo: { backgroundColor: '#7f1d1d' },
  confirmYes: { backgroundColor: '#166534' },
  confirmIcon: { color: 'white', fontSize: 18, fontWeight: '800' },
});
