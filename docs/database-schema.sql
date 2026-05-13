-- Lion Windows Field Measure App
-- SQLite schema v1

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  address TEXT NOT NULL,
  measure_date TEXT NOT NULL,
  measured_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  room_name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE TABLE openings (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  opening_code TEXT NOT NULL, -- e.g. W1, D2
  opening_type TEXT NOT NULL, -- window, door, slider, bifold, etc.

  width_in REAL NOT NULL,
  height_in REAL NOT NULL,
  jamb_thickness_in REAL NOT NULL,

  measurement_basis TEXT NOT NULL, -- net_frame | rough_opening
  net_to_ro_rule_note TEXT, -- e.g. Net = RO - 1/2"

  glass_type TEXT,
  tempered TEXT NOT NULL DEFAULT 'No', -- Yes/No
  fire_zone TEXT NOT NULL DEFAULT 'No', -- Yes/No

  grids TEXT NOT NULL DEFAULT 'No', -- Yes/No
  grid_type TEXT,
  grid_design TEXT,

  installation_type TEXT NOT NULL, -- nail_fin | new_construction | retrofit_block | retrofit_zbar
  existing_window_type TEXT,

  orientation_operation TEXT, -- LH, RH, XO, OX, XOX, etc.
  notes TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE opening_photos (
  id TEXT PRIMARY KEY,
  opening_id TEXT NOT NULL,
  local_uri TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (opening_id) REFERENCES openings(id) ON DELETE CASCADE
);

CREATE TABLE report_exports (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  export_type TEXT NOT NULL, -- pdf | csv
  file_uri TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX idx_rooms_job_id ON rooms(job_id);
CREATE INDEX idx_openings_job_id ON openings(job_id);
CREATE INDEX idx_openings_room_id ON openings(room_id);
CREATE INDEX idx_photos_opening_id ON opening_photos(opening_id);
