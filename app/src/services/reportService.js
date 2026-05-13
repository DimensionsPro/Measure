export function buildCsvFromOpenings(job, openings) {
  const columns = [
    { label: 'Line #', get: (_o, idx) => idx + 1, required: true },
    { label: 'Room', get: o => o.room, required: true },
    { label: 'Opening ID', get: o => o.openingCode, required: true },
    { label: 'Qty', get: o => o.qty || 1, required: true },
    { label: 'Opening Type', get: o => o.openingType, required: true },
    { label: 'Subtype', get: o => o.subtype, required: true },
    { label: 'Width (in)', get: o => o.width, required: true },
    { label: 'Height (in)', get: o => o.height, required: true },
    { label: 'Jamb Thickness (in)', get: o => o.jamb },
    { label: 'Measurement Basis', get: o => o.basis },
    { label: 'Glass Type', get: o => o.glassType },
    { label: 'Tempered (Y/N)', get: o => o.tempered, fmt: v => yn(v) },
    { label: 'Fire Zone (Y/N)', get: o => o.fireZone, fmt: v => yn(v) },
    { label: 'Falling Hazard (Y/N)', get: o => o.fallingHazard, fmt: v => yn(v) },
    { label: 'Egress (Y/N)', get: o => o.egress, fmt: v => yn(v) },
    { label: 'Grids (Y/N)', get: o => o.grids, fmt: v => yn(v) },
    { label: 'Grid Type', get: o => yn(o.grids) === 'Y' ? o.gridType : 'N/A' },
    { label: 'Grid Design', get: o => yn(o.grids) === 'Y' ? o.gridDesign : 'N/A' },
    { label: 'Installation Type', get: o => o.installType },
    { label: 'Existing Type', get: o => o.existingType },
    { label: 'Orientation/Operation', get: o => o.operation },
    { label: 'General Notes', get: o => o.notes }
  ];

  const hasValue = (v) => {
    if (v === null || v === undefined) return false;
    const s = String(v).trim();
    return s !== '' && s !== '-';
  };

  const activeColumns = columns.filter(col => {
    if (col.required) return true;
    return openings.some(o => hasValue(col.get(o)));
  });

  const header = activeColumns.map(c => c.label);
  const rows = openings.map((o, idx) =>
    activeColumns.map(c => {
      const raw = c.get(o, idx);
      return c.fmt ? c.fmt(raw) : raw;
    })
  );

  const general = [
    ['Job Name', job.jobName || ''],
    ['Address', job.address || ''],
    ['Measure Date', job.measureDate || ''],
    ['Job Site Contact', job.onSiteContact || ''],
    ['Measured By', job.measuredBy || ''],
    [],
    header
  ];

  return [...general, ...rows].map(r => r.map(csvEsc).join(',')).join('\n');
}

export function buildHtmlReport(job, openings) {
  const rows = openings.map((o, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${safe(o.room)}</td>
      <td>${safe(o.openingCode)}</td>
      <td>${safe(o.qty || 1)}</td>
      <td>${safe(o.openingType)}</td>
      <td>${safe(o.subtype)}</td>
      <td>${safe(o.width)}</td>
      <td>${safe(o.height)}</td>
      <td>${safe(o.jamb)}</td>
      <td>${safe(o.basis)}</td>
      <td>${safe(o.glassType)}</td>
      <td>${safe(yn(o.tempered))}</td>
      <td>${safe(yn(o.fireZone))}</td>
      <td>${safe(yn(o.fallingHazard))}</td>
      <td>${safe(yn(o.egress))}</td>
      <td>${safe(yn(o.grids))}</td>
      <td>${safe(yn(o.grids) === 'Y' ? o.gridType : 'N/A')}</td>
      <td>${safe(yn(o.grids) === 'Y' ? o.gridDesign : 'N/A')}</td>
      <td>${safe(o.installType)}</td>
      <td>${safe(o.existingType)}</td>
      <td>${safe(o.operation)}</td>
      <td>${safe(o.notes)}</td>
      <td>${(o.photoDataUri || o.photoUri) ? `<img src="${safeAttr(o.photoDataUri || o.photoUri)}" style="width:72px;height:72px;object-fit:cover;border:1px solid #ddd;border-radius:4px;"/>` : 'Missing'}</td>
    </tr>
  `).join('');

  return `
  <html><head><style>
    @page { size: A4 landscape; margin: 1in; }
    body{font-family:Arial,sans-serif;padding:0;margin:0}
    h1{margin:0 0 6px 0}
    .meta{margin:0 0 12px 0;color:#333}
    table{width:100%;border-collapse:collapse;font-size:11px;page-break-inside:auto}
    thead{display:table-header-group}
    tr{page-break-inside:avoid;page-break-after:auto}
    th,td{border:1px solid #ddd;padding:6px;vertical-align:top}
    th{background:#f3f4f6;text-align:left}
  </style></head><body>
    <h1>${safe(job.jobName)} - Field Measurements</h1>
    <p class="meta"><strong>Job:</strong> ${safe(job.jobName)}<br/>
    <strong>Address:</strong> ${safe(job.address)}<br/>
    <strong>Date:</strong> ${safe(job.measureDate)}<br/>
    <strong>Job Site Contact:</strong> ${safe(job.onSiteContact)}<br/>
    <strong>Measured by:</strong> ${safe(job.measuredBy)}</p>
    <table>
      <thead><tr>
        <th>Line #</th><th>Room</th><th>ID</th><th>Qty</th><th>Type</th><th>Subtype</th><th>W</th><th>H</th><th>Jamb</th><th>Basis</th>
        <th>Glass</th><th>Temp</th><th>Fire</th><th>Fall Hazard</th><th>Egress</th><th>Grids</th><th>Grid Type</th><th>Grid Design</th>
        <th>Install</th><th>Existing</th><th>Orientation</th><th>Notes</th><th>Photo</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </body></html>`;
}

function yn(v){ return (v||'').toLowerCase().startsWith('y') ? 'Y':'N'; }
function safe(v){ return (v ?? '').toString().replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function safeAttr(v){ return (v ?? '').toString().replace(/"/g, '&quot;'); }
function csvEsc(v){
  const s=(v??'').toString();
  if(/[",\n]/.test(s)) return '"'+s.replace(/"/g,'""')+'"';
  return s;
}
