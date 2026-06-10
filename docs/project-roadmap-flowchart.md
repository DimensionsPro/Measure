# DimensionsPro Project Roadmap

## Goal

Build a web/phone-based contractor tool that measures windows and doors from photos, creates verified measurements, generates estimates, produces a scope of work, and helps close the job during the first customer meeting.

## Flow Chart

```mermaid
flowchart TD
    A["Current State"] --> B["Stabilize Testing Ground"]
    B --> B1["Use testing branch by default"]
    B --> B2["Use TEST web link for previews"]
    B --> B3["Keep main branch as official/stable"]

    B --> C["Fix Cloud Data Reliability"]
    C --> C1["Confirm Supabase source of truth"]
    C --> C2["Make saved projects load from Supabase"]
    C --> C3["Add visible sync status and manual refresh"]
    C --> C4["Protect against local-only project loss"]

    C --> D["Make Scale-Assisted Scanner Work Reliably"]
    D --> D1["Credit card / 1-inch marker required for now"]
    D --> D2["Improve photo capture instructions"]
    D --> D3["Send valid image data to vision scanner"]
    D --> D4["Return width, height, type, confidence"]
    D --> D5["Require contractor confirmation before saving"]

    D --> E["Measurement Verification UI"]
    E --> E1["Show detected dimensions clearly"]
    E --> E2["Allow manual correction"]
    E --> E3["Store AI value vs confirmed value"]
    E --> E4["Flag low-confidence scans"]

    E --> F["Window and Door Product Catalog"]
    F --> F1["Vinyl / Aluminum / Fiberglass"]
    F --> F2["Window types: SH, DH, slider, picture, casement"]
    F --> F3["Door types: patio slider, swinging, multi-slide, bi-fold"]
    F --> F4["Glass, grids, tempered, fire zone, hardware options"]

    F --> G["Estimate Engine"]
    G --> G1["Material pricing rules"]
    G --> G2["Labor pricing rules"]
    G --> G3["Options and upcharges"]
    G --> G4["Markup, tax, discounts"]
    G --> G5["Good / better / best quote options"]

    G --> H["Scope of Work Generator"]
    H --> H1["Customer-facing scope"]
    H --> H2["Installer notes"]
    H --> H3["Assumptions and exclusions"]
    H --> H4["PDF / CSV quote-ready export"]

    H --> I["Field Close Workflow"]
    I --> I1["Review measured openings"]
    I --> I2["Generate quote on-site"]
    I --> I3["Present price and scope"]
    I --> I4["Customer approval / signature later"]

    I --> J["Improve AI Over Time"]
    J --> J1["Save photos and confirmed measurements"]
    J --> J2["Build training/evaluation dataset"]
    J --> J3["Measure scanner accuracy"]
    J --> J4["Eventually test no-scale measurement"]
```

## Recommended Order

1. Cloud reliability first
   Make sure projects save/load correctly from Supabase on the TEST web app. If saved jobs disappear or only live in browser storage, everything else becomes shaky.

2. Scanner reliability second
   Keep the credit card or 1-inch marker requirement. The goal is not no-scale yet. The goal is: photo in, measurement suggestion out, contractor confirms.

3. Verification screen third
   Never let AI measurements silently become final. Show the result, confidence, and allow correction.

4. Pricing/catalog fourth
   Once measurements are dependable, add the dealer product rules: material, type, glass, grids, install type, labor.

5. Estimate and scope fifth
   Turn confirmed openings into a customer-ready quote and scope of work.

6. Close-on-site workflow last
   Make the app feel like a sales tool: measure, review, estimate, present, close.

## Next Milestone

Projects reliably save/load in Supabase, then DimensionSnap produces verified scale-assisted measurements on the TEST web app.
