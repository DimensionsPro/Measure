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
