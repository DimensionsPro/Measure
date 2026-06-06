// Offline-first sync service (Phase 1 wired)

const QUEUE_KEY = 'fm_pending_changes_v1';

// Initialize Supabase configuration from Env Vars with hardcoded fallbacks
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://nyamrcwprsxbdooewidv.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_EHhbmAvVmmZ53DeO0uJPZA_YII0usRx';

const AUTH_STORAGE_KEY = 'dimensions_pro_auth_v1';

function getAuthToken() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.token || null;
    }
  } catch (e) {
    console.error('Failed to read auth token', e);
  }
  return null;
}

export function isOnline() {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

export function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue || []));
}

export function enqueueChange(change) {
  const queue = loadQueue();
  queue.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    attempts: 0,
    lastError: null,
    ...change
  });
  saveQueue(queue);
  return queue;
}

async function sbRequest(path, { method = 'GET', body, headers: customHeaders } = {}) {
  const token = getAuthToken();
  const authHeader = token ? `Bearer ${token}` : `Bearer ${SUPABASE_PUBLISHABLE_KEY}`;
  
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal,resolution=merge-duplicates',
      ...customHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase ${res.status}: ${txt}`);
  }
}

async function applyRemote(item) {
  if (item.entity === 'measurement' && item.op === 'upsert') {
    const m = item.payload;
    const payloadTs = new Date(m?.savedAt || 0).getTime() || Date.now();

    // Guard against stale queue overwrites: if cloud is newer, skip this local write.
    try {
      const token = getAuthToken();
      const authHeader = token ? `Bearer ${token}` : `Bearer ${SUPABASE_PUBLISHABLE_KEY}`;
      const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs?select=id,updated_at&id=eq.${encodeURIComponent(m.id)}&limit=1`, {
        headers: {
          'apikey': SUPABASE_PUBLISHABLE_KEY,
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      });
      if (existingRes.ok) {
        const rows = await existingRes.json();
        const cloudTs = new Date(rows?.[0]?.updated_at || 0).getTime() || 0;
        if (cloudTs > payloadTs) {
          return; // keep newer cloud copy
        }
      }
    } catch {
      // if guard check fails, proceed with best effort write
    }

    const writeTs = new Date(payloadTs).toISOString();

    await sbRequest('/rest/v1/jobs?on_conflict=id', {
      method: 'POST',
      body: [{
        id: m.id,
        job_name: m.job?.jobName || '',
        address: m.job?.address || '',
        measure_date: m.job?.measureDate || '',
        measured_by: m.job?.measuredBy || '',
        on_site_contact: m.job?.onSiteContact || '',
        updated_at: writeTs
      }]
    });

    // Atomic Upsert: Supabase will handle the conflict based on ID, 
    // removing the need for a destructive DELETE.
    const openingRows = (m.openings || []).map((o, idx) => ({
      id: `${m.id}_${idx + 1}`,
      job_id: m.id,
      payload: o,
      updated_at: writeTs
    }));

    if (openingRows.length) {
      // Use upsert-capable POST or a specific upsert endpoint if available
      await sbRequest('/rest/v1/openings?on_conflict=id', { 
        method: 'POST', 
        body: openingRows,
        headers: { 'Prefer': 'resolution=merge-duplicates' } 
      });
    }
    return;
  }

  if (item.entity === 'measurement' && item.op === 'delete') {
    const id = item.entityId;
    await sbRequest(`/rest/v1/openings?job_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    await sbRequest(`/rest/v1/jobs?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    return;
  }

  throw new Error(`Unsupported sync item: ${item.entity}/${item.op}`);
}

export async function flushQueue() {
  const queue = loadQueue();
  if (!queue.length) return { ok: true, flushed: 0, remaining: 0 };
  
  const results = await Promise.all(queue.map(async (item) => {
    try {
      await applyRemote(item);
      return { success: true, item };
    } catch (e) {
      console.error('Sync failed for item', item.id, e);
      return { success: false, item: { ...item, attempts: (item.attempts || 0) + 1, lastError: String(e?.message || e) } };
    }
  }));

  const next = results.filter(r => !r.success).map(r => r.item);
  const flushed = results.filter(r => r.success).length;

  saveQueue(next);
  return { ok: next.length === 0, flushed, remaining: next.length };
}

export async function fetchRemoteMeasurements() {
  const token = getAuthToken();
  const authHeader = token ? `Bearer ${token}` : `Bearer ${SUPABASE_PUBLISHABLE_KEY}`;
  
  const jobsRes = await fetch(`${SUPABASE_URL}/rest/v1/jobs?select=*&order=updated_at.desc`, {
    headers: {
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    }
  });

  if (!jobsRes.ok) {
    throw new Error(`Supabase jobs ${jobsRes.status}: ${await jobsRes.text()}`);
  }

  const jobs = await jobsRes.json();
  if (!jobs.length) return [];

  const openingsRes = await fetch(`${SUPABASE_URL}/rest/v1/openings?select=job_id,payload,updated_at`, {
    headers: {
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': authHeader,
      'Content-Type': 'application/json'
    }
  });

  if (!openingsRes.ok) {
    throw new Error(`Supabase openings ${openingsRes.status}: ${await openingsRes.text()}`);
  }

  const openingRows = await openingsRes.json();
  const byJob = openingRows.reduce((acc, row) => {
    const id = row.job_id;
    if (!acc[id]) acc[id] = [];
    acc[id].push(row.payload || {});
    return acc;
  }, {});

  return jobs.map(j => {
    const openings = byJob[j.id] || [];
    const total = openings.reduce((sum, o) => {
      const n = Number(o?.qty);
      return sum + (Number.isFinite(n) && n > 0 ? n : 1);
    }, 0);
    const windows = openings
      .filter(o => (o?.openingType || '').toLowerCase().includes('window'))
      .reduce((sum, o) => sum + (Number(o?.qty) > 0 ? Number(o.qty) : 1), 0);
    const doors = openings
      .filter(o => {
        const t = (o?.openingType || '').toLowerCase();
        return t.includes('door') || t.includes('slider') || t.includes('bi-fold') || t.includes('bifold') || t.includes('multi-slide');
      })
      .reduce((sum, o) => sum + (Number(o?.qty) > 0 ? Number(o.qty) : 1), 0);

    return {
      id: j.id,
      savedAt: j.updated_at || new Date().toISOString(),
      job: {
        jobName: j.job_name || '',
        address: j.address || '',
        measureDate: j.measure_date || '',
        measuredBy: j.measured_by || '',
        onSiteContact: j.on_site_contact || ''
      },
      openings,
      counts: { windows, doors, total }
    };
  });
}

export function mergeMeasurements(localItems = [], remoteItems = []) {
  const byId = new Map();
  
  // Sort by savedAt ascending so that later items (newer) overwrite earlier ones in the Map
  const allItems = [...localItems, ...remoteItems].sort((a, b) => 
    new Date(a.savedAt || 0).getTime() - new Date(b.savedAt || 0).getTime()
  );

  allItems.forEach(item => {
    if (!item || !item.id) return;
    
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      return;
    }

    const existingTs = new Date(existing.savedAt || 0).getTime();
    const incomingTs = new Date(item.savedAt || 0).getTime();

    // Tie-breaker: Prefer item with more openings if timestamps are identical
    if (incomingTs > existingTs) {
      byId.set(item.id, item);
    } else if (incomingTs === existingTs) {
      const existingCount = existing.openings?.length || 0;
      const incomingCount = item.openings?.length || 0;
      if (incomingCount > existingCount) {
        byId.set(item.id, item);
      }
    }
  });

  return Array.from(byId.values()).sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
}
