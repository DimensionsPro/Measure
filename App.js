1|import React, { useEffect, useMemo, useRef, useState } from 'react';
2|import { SafeAreaView, View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, Alert, Image, Platform, Modal, Pressable, Animated, Easing, AppState, ActivityIndicator } from 'react-native';
3|import * as ImagePicker from 'expo-image-picker';
4|import * as Print from 'expo-print';
5|import * as Sharing from 'expo-sharing';
6|import * as FileSystem from 'expo-file-system';
7|import * as ImageManipulator from 'expo-image-manipulator';
8|import { buildCsvFromOpenings, buildHtmlReport } from './app/src/services/reportService';
9|import { enqueueChange, flushQueue, isOnline, fetchRemoteMeasurements, mergeMeasurements, loadQueue } from './app/src/services/sync/syncService';
10|import { SCAN_FIELD_SCHEMA, analyzeWindowPhoto } from './app/src/services/scanner/scanService';
const INSTALL_TYPES = ['Nail fin', 'New construction', 'Retrofit block', 'Retrofit Z-bar'];
13|const OPENING_TYPES = ['Window', 'Door', 'Skylight'];
14|const DOOR_SUBTYPES = ['Multi-slide', 'Bi-folding', 'Patio Sliding Door', 'Swinging Door'];
15|const WINDOW_SUBTYPES = ['DH', 'SH', 'Casement', 'Slider', 'Picture Window', 'Awning', 'Other'];
16|const SKYLIGHT_SUBTYPES = ['Deck mount', 'Curb mount'];
17|const SKYLIGHT_CURB_MEAS_TYPES = ['Outside curb dimensions', 'Inside curb dimensions', 'Make size'];
18|const SKYLIGHT_PITCH_OPTIONS = ['Flat', '2:12', '3:12', '4:12', '5:12', '6:12', '7:12', '8:12', '9:12', '10:12', '12:12'];
19|const APP_LOGO = require('./app/assets/images/logo-pro-horizontal.png');
20|const BRAND = {
21|  orange: '#FF6B00',
22|  cyan: '#00BFFF',
23|  dark: '#121212',
24|  gray: '#2A2A2A'
25|};
26|const LOCAL_AUTH_KEY = 'dimensions_local_auth_v1';
const steps = [
29|  'Job Information',
30|  'Room',
31|  'Measurement (W x H)',
32|  'Jamb thickness',
33|  'Photo',
34|  'Net frame or rough opening',
35|  'Glass type',
36|  'Glass / Window Conditions :',
37|  'Grids + design',
38|  'Installation type',
39|  'Existing window type',
40|  'General notes',
41|  'Overall summary'
42|];
const getTodayMMDDYYYY = () => {
45|  const d = new Date();
46|  const dd = String(d.getDate()).padStart(2, '0');
47|  const mm = String(d.getMonth() + 1).padStart(2, '0');
48|  const yyyy = d.getFullYear();
49|  return `${mm}-${dd}-${yyyy}`;
50|};
const newMeasurementId = () => `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
53|const newOpeningUid = () => `o_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const emptyOpening = {
56|  room: '',
57|  openingCode: '',
58|  qty: '1',
59|  openingType: 'Window',
60|  subtype: 'DH',
61|  configA: '',
62|  configB: '',
63|  configC: '',
64|  photoUri: '',
65|  photoNote: '',
66|  width: '',
67|  height: '',
68|  jamb: '',
69|  basis: 'Net frame',
70|  glassType: '',
71|  glassSelections: [],
72|  tempered: 'No',
73|  fireZone: 'No',
74|  fallingHazard: 'No',
75|  egress: 'No',
76|  grids: 'No',
77|  gridType: '',
78|  gridDesign: '',
79|  installType: 'Nail fin',
80|  existingType: '',
81|  operation: '',
82|  notes: '',
83|  measureMethod: 'manual'
84|};
export default function App() {
87|  const [step, setStep] = useState(0);
88|  const [job, setJob] = useState({
89|    address: '',
90|    jobName: '',
91|    measureDate: getTodayMMDDYYYY(),
92|    measuredBy: '',
93|    onSiteContact: ''
94|  });
95|  const [opening, setOpening] = useState(emptyOpening);
96|  const [openings, setOpenings] = useState([]);
97|  const [editIndex, setEditIndex] = useState(null);
98|  const [editOpeningUid, setEditOpeningUid] = useState(null);
99|  const [entryMode, setEntryMode] = useState('create'); // create | edit | copy
100|  const [showReportChooser, setShowReportChooser] = useState(false);
101|  const [savedJobs, setSavedJobs] = useState([]);
102|  const [trashJobs, setTrashJobs] = useState([]);
103|  const [showArchive, setShowArchive] = useState(false);
104|  const [archiveQuery, setArchiveQuery] = useState('');
105|  const [validationError, setValidationError] = useState('');
106|  const [showHome, setShowHome] = useState(true);
107|  const [showIntro, setShowIntro] = useState(true);
108|  const [draftData, setDraftData] = useState(null);
109|  const logoDropY = useRef(new Animated.Value(-240)).current;
110|  const logoScale = useRef(new Animated.Value(1.6)).current;
111|  const logoTilt = useRef(new Animated.Value(-12)).current;
112|  const titleDropY = useRef(new Animated.Value(-160)).current;
113|  const titleOpacity = useRef(new Animated.Value(0)).current;
114|  const introOpacity = useRef(new Animated.Value(1)).current;
115|  const dustOpacity = useRef(new Animated.Value(0)).current;
116|  const dustSpread = useRef(new Animated.Value(0.6)).current;
117|  const [introReady, setIntroReady] = useState(false);
118|  const [measurementId, setMeasurementId] = useState(newMeasurementId());
119|  const [qtyPickerIndex, setQtyPickerIndex] = useState(null);
120|  const [qtyCustomValue, setQtyCustomValue] = useState('');
121|  const [confirmState, setConfirmState] = useState({ visible: false, message: '', onConfirm: null });
122|  const [showJobInfoEditor, setShowJobInfoEditor] = useState(false);
123|  const [offlineMode, setOfflineMode] = useState(false);
124|  const [syncState, setSyncState] = useState('synced'); // syncing | synced | offline | error
125|  const [pendingMeasurementIds, setPendingMeasurementIds] = useState(new Set());
126|  const [pendingQueueCount, setPendingQueueCount] = useState(0);
127|  const [lastCloudSyncAt, setLastCloudSyncAt] = useState(null);
128|  const [lastSyncError, setLastSyncError] = useState('');
129|  const [deviceId, setDeviceId] = useState('unknown');
130|  const [cloudSavedAtById, setCloudSavedAtById] = useState({});
131|  const [cloudOpeningsCountById, setCloudOpeningsCountById] = useState({});
132|  const [authLoading, setAuthLoading] = useState(false);
133|  const [authUser, setAuthUser] = useState(null);
134|  const [loginUsername, setLoginUsername] = useState('');
135|  const [loginPassword, setLoginPassword] = useState('');
136|  const [loginError, setLoginError] = useState('');
137|  const [scanBusy, setScanBusy] = useState(false);
const latestJobRef = useRef(job);
140|  const latestOpeningsRef = useRef(openings);
141|  const latestMeasurementIdRef = useRef(measurementId);
142|  const latestSavedJobsRef = useRef(savedJobs);
const totalSteps = steps.length - 1; // summary is final view
145|  const isSummary = step === totalSteps;
const qtyOf = (o) => {
148|    const n = Number(o?.qty);
149|    return Number.isFinite(n) && n > 0 ? n : 1;
150|  };
const isWindowType = (o) => ((o?.openingType || '').toLowerCase().includes('window'));
153|  const isDoorType = (o) => {
154|    const t = (o?.openingType || '').toLowerCase();
155|    return t.includes('door') || t.includes('slider') || t.includes('bi-fold') || t.includes('bifold') || t.includes('multi-slide');
156|  };
157|  const isSkylightType = (o) => ((o?.openingType || '').toLowerCase().includes('skylight'));
const buildCounts = (list = []) => ({
160|    windows: list.filter(isWindowType).reduce((sum, x) => sum + qtyOf(x), 0),
161|    doors: list.filter(isDoorType).reduce((sum, x) => sum + qtyOf(x), 0),
162|    skylights: list.filter(isSkylightType).reduce((sum, x) => sum + qtyOf(x), 0),
163|    total: list.reduce((sum, x) => sum + qtyOf(x), 0),
164|    lines: list.length
165|  });
const sanitizeMeasurementForCloud = (m) => ({
168|    ...m,
169|    openings: (m.openings || []).map(o => ({
170|      ...o,
171|      // Keep compressed embedded photo for cross-device sync; drop local-only URI.
172|      photoDataUri: o.photoDataUri || '',
173|      photoUri: ''
174|    }))
175|  });
const counts = useMemo(() => buildCounts(openings), [openings]);
178|  const windowCount = counts.windows;
179|  const doorCount = counts.doors;
180|  const skylightCount = counts.skylights;
const getMeasurementSyncStatus = (m) => {
183|    if (!m?.id) return 'pending';
184|    if (pendingMeasurementIds.has(m.id)) return 'pending';
const localTs = new Date(m?.savedAt || 0).getTime() || 0;
187|    const cloudTs = new Date(cloudSavedAtById[m.id] || 0).getTime() || 0;
const localCount = Array.isArray(m?.openings) ? m.openings.length : Number(m?.counts?.lines || 0);
190|    const cloudCount = Number(cloudOpeningsCountById[m.id] || 0);
const tsConfirmed = cloudTs >= localTs && cloudTs > 0;
193|    const countConfirmed = localCount > 0 ? cloudCount >= localCount : true;
// Green check only after cloud confirms both recency and expected opening-count integrity.
196|    return tsConfirmed && countConfirmed ? 'synced' : 'pending';
197|  };
const currentMeasurementSyncStatus = getMeasurementSyncStatus(savedJobs.find(x => x.id === measurementId) || { id: measurementId, savedAt: 0 });
const archiveKey = 'dimensions_pro_archive_v1';
202|  const trashKey = 'dimensions_pro_trash_v1';
203|  const draftKey = 'dimensions_pro_draft_v1';
const refreshPendingMeasurements = () => {
206|    try {
207|      const queue = loadQueue() || [];
208|      const ids = new Set(
209|        queue
210|          .filter(item => item?.entity === 'measurement' && item?.entityId)
211|          .map(item => item.entityId)
212|      );
213|      setPendingMeasurementIds(ids);
214|      setPendingQueueCount(queue.length);
215|      const latestErr = [...queue].reverse().find(q => q?.lastError)?.lastError || '';
216|      setLastSyncError(latestErr ? String(latestErr).slice(0, 120) : '');
217|    } catch {
218|      setPendingMeasurementIds(new Set());
219|      setPendingQueueCount(0);
220|    }
221|  };
const syncNow = async () => {
224|    if (!isOnline()) {
225|      setOfflineMode(true);
226|      setSyncState('offline');
227|      refreshPendingMeasurements();
228|      return { ok: false, offline: true, flushed: 0, remaining: null };
229|    }
setSyncState('syncing');
232|    try {
233|      const result = await flushQueue();
234|      setSyncState(result.remaining === 0 ? 'synced' : 'error');
235|      if (result.ok) {
236|        setLastCloudSyncAt(new Date().toISOString());
237|        setLastSyncError('');
238|      }
239|      refreshPendingMeasurements();
240|      return result;
241|    } catch {
242|      setSyncState('error');
243|      refreshPendingMeasurements();
244|      return { ok: false, offline: false, flushed: 0, remaining: null };
245|    }
246|  };
const showSyncBanner = offlineMode || syncState === 'syncing' || syncState === 'error';
249|  const syncBannerText = offlineMode || syncState === 'offline'
250|    ? "You're working offline — saving locally now. Cloud backup will resume instantly when reception returns."
251|    : syncState === 'syncing'
252|      ? 'Saving to cloud backup…'
253|      : 'Saved locally. Cloud backup retrying in background…';
const pruneToOneYear = (items) => {
256|    const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
257|    return (items || []).filter(x => new Date(x.savedAt).getTime() >= cutoff);
258|  };
const stripPhotosFromMeasurement = (m) => ({
261|    ...m,
262|    openings: (m.openings || []).map(o => ({ ...o, photoUri: '' }))
263|  });
const toLightArchive = (arr) => (arr || []).map(stripPhotosFromMeasurement);
const persistArchive = async (items) => {
268|    const cleaned = pruneToOneYear(items);
269|    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
270|      const raw = JSON.stringify(cleaned);
271|      try {
272|        localStorage.setItem(archiveKey, raw);
273|      } catch {
274|        // Fallback for storage quota pressure (usually from many/large photo URIs):
275|        // persist all non-photo data so measurements/items never disappear.
276|        localStorage.setItem(archiveKey, JSON.stringify(toLightArchive(cleaned)));
277|      }
278|    } else {
279|      const path = `${FileSystem.documentDirectory}field_measure_archive.json`;
280|      await FileSystem.writeAsStringAsync(path, JSON.stringify(cleaned), { encoding: FileSystem.EncodingType.UTF8 });
281|    }
282|    setSavedJobs(cleaned);
283|  };
const persistTrash = async (items) => {
286|    const cleaned = (items || []).filter(x => x && x.trashedAt);
287|    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
288|      localStorage.setItem(trashKey, JSON.stringify(cleaned));
289|    } else {
290|      const path = `${FileSystem.documentDirectory}field_measure_trash.json`;
291|      await FileSystem.writeAsStringAsync(path, JSON.stringify(cleaned), { encoding: FileSystem.EncodingType.UTF8 });
292|    }
293|    setTrashJobs(cleaned);
294|  };
const purgeExpiredTrash = async (items = []) => {
297|    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
298|    const kept = [];
299|    const expired = [];
300|    for (const t of (items || [])) {
301|      const ts = new Date(t.trashedAt || 0).getTime();
302|      if (ts && ts < cutoff) expired.push(t); else kept.push(t);
303|    }
if (expired.length) {
306|      for (const t of expired) {
307|        enqueueChange({ entity: 'measurement', entityId: t.id, op: 'delete', payload: null });
308|      }
309|      await syncNow();
310|    }
return kept;
313|  };
const loadArchive = async () => {
316|    try {
317|      let parsed = [];
318|      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
319|        parsed = JSON.parse(localStorage.getItem(archiveKey) || '[]');
320|      } else {
321|        const path = `${FileSystem.documentDirectory}field_measure_archive.json`;
322|        const info = await FileSystem.getInfoAsync(path);
323|        if (info.exists) {
324|          parsed = JSON.parse(await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 }));
325|        }
326|      }
// Load trash first so deleted jobs cannot reappear from remote merge.
329|      let trashParsed = [];
330|      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
331|        trashParsed = JSON.parse(localStorage.getItem(trashKey) || '[]');
332|      } else {
333|        const tPath = `${FileSystem.documentDirectory}field_measure_trash.json`;
334|        const tInfo = await FileSystem.getInfoAsync(tPath);
335|        if (tInfo.exists) {
336|          trashParsed = JSON.parse(await FileSystem.readAsStringAsync(tPath, { encoding: FileSystem.EncodingType.UTF8 }));
337|        }
338|      }
339|      const cleanedTrash = await purgeExpiredTrash(trashParsed);
340|      await persistTrash(cleanedTrash);
341|      const trashedIds = new Set((cleanedTrash || []).map(t => t.id));
let merged = pruneToOneYear(parsed).filter(x => !trashedIds.has(x.id));
if (isOnline()) {
346|        try {
347|          await syncNow();
348|          const remote = pruneToOneYear(await fetchRemoteMeasurements());
349|          const remoteTsMap = {};
350|          const remoteCountMap = {};
351|          for (const r of remote) {
352|            remoteTsMap[r.id] = r.savedAt || null;
353|            remoteCountMap[r.id] = Array.isArray(r.openings) ? r.openings.length : Number(r?.counts?.lines || 0);
354|          }
355|          setCloudSavedAtById(remoteTsMap);
356|          setCloudOpeningsCountById(remoteCountMap);
// Cloud-authoritative when online so all devices converge to same active stack.
359|          // Keep only local pending upserts (not yet uploaded) on top of remote.
360|          const queue = loadQueue() || [];
361|          const pendingUpserts = queue
362|            .filter(item => item?.entity === 'measurement' && item?.op === 'upsert' && item?.payload)
363|            .map(item => item.payload);
const remoteById = new Map(remote.map(x => [x.id, x]));
366|          for (const p of pendingUpserts) {
367|            remoteById.set(p.id, p);
368|          }
merged = Array.from(remoteById.values())
371|            .filter(x => !trashedIds.has(x.id))
372|            .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
373|        } catch {
374|          // keep local data if remote pull fails
375|        }
376|      }
setSavedJobs(merged);
379|      await persistArchive(merged);
380|    } catch {
381|      setSavedJobs([]);
382|      setCloudSavedAtById({});
383|      setCloudOpeningsCountById({});
384|    }
385|  };
const persistDraft = async (payload) => {
388|    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
389|      const raw = JSON.stringify(payload);
390|      try {
391|        localStorage.setItem(draftKey, raw);
392|      } catch {
393|        const lightweight = {
394|          ...payload,
395|          opening: payload.opening ? { ...payload.opening, photoUri: '' } : payload.opening,
396|          openings: (payload.openings || []).map(o => ({ ...o, photoUri: '' }))
397|        };
398|        localStorage.setItem(draftKey, JSON.stringify(lightweight));
399|      }
400|    } else {
401|      const path = `${FileSystem.documentDirectory}field_measure_draft.json`;
402|      await FileSystem.writeAsStringAsync(path, JSON.stringify(payload), { encoding: FileSystem.EncodingType.UTF8 });
403|    }
404|    setDraftData(payload);
405|  };
const clearDraft = async () => {
408|    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
409|      localStorage.removeItem(draftKey);
410|    } else {
411|      const path = `${FileSystem.documentDirectory}field_measure_draft.json`;
412|      const info = await FileSystem.getInfoAsync(path);
413|      if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
414|    }
415|    setDraftData(null);
416|  };
const loadDraft = async () => {
419|    try {
420|      let parsed = null;
421|      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
422|        parsed = JSON.parse(localStorage.getItem(draftKey) || 'null');
423|      } else {
424|        const path = `${FileSystem.documentDirectory}field_measure_draft.json`;
425|        const info = await FileSystem.getInfoAsync(path);
426|        if (info.exists) {
427|          parsed = JSON.parse(await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 }));
428|        }
429|      }
430|      setDraftData(parsed || null);
431|    } catch {
432|      setDraftData(null);
433|    }
434|  };
useEffect(() => {
437|    try {
438|      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
439|        const raw = localStorage.getItem(LOCAL_AUTH_KEY);
440|        if (raw) {
441|          const parsed = JSON.parse(raw);
442|          if (parsed?.username) {
443|            setAuthUser({ email: parsed.username });
444|          }
445|        }
446|      }
447|    } catch {}
448|    setAuthLoading(false);
449|  }, []);
useEffect(() => {
452|    // Always start from main page on app load.
453|    setShowHome(true);
454|    loadArchive();
455|    loadDraft();
456|    refreshPendingMeasurements();
try {
459|      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
460|        const key = 'field_measure_device_id_v1';
461|        let id = localStorage.getItem(key);
462|        if (!id) {
463|          id = `dev_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36).slice(-4)}`;
464|          localStorage.setItem(key, id);
465|        }
466|        setDeviceId(id);
467|      } else {
468|        setDeviceId(Platform.OS || 'native');
469|      }
470|    } catch {
471|      setDeviceId('unknown');
472|    }
Animated.sequence([
475|      Animated.delay(120),
476|      Animated.parallel([
477|        Animated.spring(logoDropY, {
478|          toValue: 0,
479|          speed: 24,
480|          bounciness: 5,
481|          useNativeDriver: true
482|        }),
483|        Animated.sequence([
484|          Animated.timing(logoScale, {
485|            toValue: 1.08,
486|            duration: 140,
487|            easing: Easing.out(Easing.quad),
488|            useNativeDriver: true
489|          }),
490|          Animated.timing(logoScale, {
491|            toValue: 1,
492|            duration: 90,
493|            easing: Easing.in(Easing.quad),
494|            useNativeDriver: true
495|          })
496|        ]),
497|        Animated.timing(logoTilt, {
498|          toValue: 0,
499|          duration: 180,
500|          easing: Easing.out(Easing.cubic),
