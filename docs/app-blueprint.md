# Lion Windows Field Measure App — Blueprint v1

## Goal
Capture complete field measurements on-site and generate a quote-ready report with minimal office cleanup.

## Primary Workflow
1. Create Job (Address, Job Name, Date auto-filled)
2. Add Rooms
3. Add Openings per room (window/door/slider/bifold/etc.)
4. Capture photos + structured measurements
5. Validate required fields
6. Export quote-ready report (PDF + CSV)

## Data Model (high level)
- Job
- Room
- Opening
- OpeningPhoto
- ReportExport

## Opening Form Fields (v1)
- Opening ID (auto)
- Opening Type
- Address (inherits from job)
- Job Name (inherits from job)
- Date (default today, editable)
- Room
- Photo(s)
- Measurement W x H (inches)
- Jamb Thickness (inches)
- Measurement Basis: Net Frame | Rough Opening
- Auto helper: Net = RO - 1/2"
- Glass Type
- Tempered: Yes/No
- Fire Zone: Yes/No
- Grids: Yes/No
- Grid Type (if Grids=Yes)
- Grid Design (if Grids=Yes)
- Installation Type:
  - Nail Fin
  - New Construction
  - Retrofit Block
  - Retrofit Z-Bar
- Existing Window Type
- Orientation / Handing / Operation
  - Door examples: LH, RH, LH inswing, RH outswing
  - Slider/window examples: XO, OX, XOX, OXO, Fixed, Casement-L, Casement-R, Awning
- General Notes

## Validation Rules
- W and H required and numeric
- Jamb thickness required
- Measurement basis required
- Installation type required
- If Grids=Yes => Grid Type + Grid Design required
- If Door selected => orientation options shown as handing list
- If Slider/Window selected => orientation options shown as operation patterns

## Quote-Ready Report Output
### Section A: Job Summary
- Job Name
- Address
- Date measured
- Measured by

### Section B: Opening Schedule Table
Columns:
1. Room
2. Opening ID
3. Opening Type
4. W
5. H
6. Jamb
7. Basis (Net/RO)
8. Derived RO or Net note
9. Glass Type
10. Tempered
11. Fire Zone
12. Grids
13. Grid Type/Design
14. Install Type
15. Existing Type
16. Orientation/Operation
17. Notes
18. Photo Count

### Section C: Installer/Estimator Notes
- Grouped notes by room

### Section D: Photo Index
- Opening ID + thumbnail + caption

## Export Formats
- CSV: opening schedule rows for estimating import
- PDF: client/internal readable packet

## Suggested v1 Tech
- React Native (Expo)
- SQLite local db
- Local file storage for photos
- PDF generation via print-to-PDF template

## v1 Focus
- Reliability + speed in field
- Data completeness
- Quote-friendly exports with minimal manual cleanup
