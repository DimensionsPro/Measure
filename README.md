# Field Measure App (Lion Windows)

MVP scaffold for iPhone/Android field measuring with quote-ready exports.

## Current status
- Single-screen working prototype (job + openings)
- Required field checks
- Operation/handing selections (LH/RH/XO/OX/etc.)
- Quote-ready CSV builder
- HTML report builder (for PDF export wiring)

## Run locally
```bash
cd field-measure-app
npm install
npx expo start
```

## DimensionSnap marker-card testing
1. Copy `.env.local.example` to `.env.local`.
2. Add your OpenRouter key:
```bash
EXPO_PUBLIC_OPENROUTER_KEY=your_key_here
```
3. Restart Expo after changing `.env.local`.
4. Print the DimensionsPro marker/bracket card at 100% actual size.
5. For window glass tests, place the marker card flat inside the bracket section you want measured, with the full card visible.
6. Open the Expo URL on your phone and run DimensionSnap -> Scan Photo.

The current scanner uses the marker card's AprilTag square as the scale reference, lets the user choose a bracket layout, and measures the bracket section that contains the tapped card.

## Next build steps
1. Split into screens (Job, Room List, Opening Form, Review)
2. Add SQLite persistence
3. Add photo capture and attach per opening
4. Wire CSV save + share
5. Wire PDF export using `expo-print` + `expo-sharing`
6. Add estimator summary section

## Data docs
- `docs/app-blueprint.md`
- `docs/database-schema.sql`
- `templates/quote-ready-export-columns.csv`
