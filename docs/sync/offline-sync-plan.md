# Offline-First + Cloud Sync Plan (Phase 1)

## Goal
- App works fully offline in field
- Data saves locally instantly
- Unsynced changes auto-upload when internet returns
- Shared online dataset across devices/users

## Data model (cloud)
- jobs
- openings
- sync_events (optional audit)

## Local model
- existing local archive/draft storage
- add `pending_changes` queue

## Change envelope
```json
{
  "id": "uuid",
  "entity": "job|opening",
  "entityId": "string",
  "op": "upsert|delete",
  "payload": {},
  "localUpdatedAt": "iso",
  "attempts": 0,
  "lastError": null
}
```

## Sync loop
1. write locally first
2. enqueue change
3. when online, flush queue serially
4. on success: dequeue
5. on fail: retry with backoff

## Conflict rule (v1)
- Last write wins by `updated_at` timestamp

## Status UX
- Synced
- Saved locally (pending sync)
- Sync failed (tap retry)

## Required env
- EXPO_PUBLIC_SUPABASE_URL
- EXPO_PUBLIC_SUPABASE_ANON_KEY

## Phase 1 deliverable
- sync service interface + queue manager
- no UI breakage to current flows
- cloud push behind feature flag until credentials are set
