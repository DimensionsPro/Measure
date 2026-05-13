# Scan Dataset Workflow

1) Drop photos into data/scan-photos/
2) Name files like: singlehung_grids_yes_livingroom_01.jpg
3) Run:
   python3 scripts/build-scan-dataset-manifest.py --input data/scan-photos --output data/scan-manifests/scan-dataset-manifest.csv
