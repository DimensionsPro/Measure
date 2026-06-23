// Dimensions Scanner (MVP scaffold)
// Goal: accept a head-on photo with a visible DimensionsPro marker card and return best-effort fields + confidence.

export const SCAN_FIELD_SCHEMA = {
  requiredInput: [
    'photoUri',
    'scaleReference'
  ],
  outputFields: [
    'openingType',
    'operation',
    'hasGrids',
    'estimatedWidthIn',
    'estimatedHeightIn'
  ],
  confidenceThresholdDefault: 0.7
};

/**
 * DimensionSnap Core Logic
 * High-precision window classification and measurement scaling.
 */

const MARKER_TAG_BLACK_EDGE_IN = 1.2;
const SCANNER_MODEL = 'google/gemini-2.5-flash';
const SCANNER_ENV_KEY = 'EXPO_PUBLIC_OPENROUTER_KEY';
const COMMON_GUESS_PAIRS = new Set(['54x72', '72x54', '36x48', '48x36', '48x60', '60x48']);
const LOCAL_MARKER_MIN_CONFIDENCE = 0.72;
const MIN_REASONABLE_OPENING_EDGE_IN = 16;

function getImageSizeAsync(uri, Image) {
  return new Promise((resolve) => {
    if (!uri || !Image || !Image.getSize) {
      resolve({ width: 0, height: 0 });
      return;
    }
    Image.getSize(
      uri,
      (width, height) => resolve({ width: Number(width) || 0, height: Number(height) || 0 }),
      () => resolve({ width: 0, height: 0 })
    );
  });
}

/**
 * Classifies window type based on aspect ratio and visual structure.
 * Refined logic for DH, SH, Slider, Casement, Fixed.
 */
function classifyWindowType(aspect, hasHorizontalSplit, hasVerticalSplit) {
  // Ultra-Wide (LaCantina / Multi-Slide territory)
  if (aspect > 2.2) return { type: 'Multi-Slide/Bi-Fold', confidence: 0.90 };
  
  if (aspect > 1.3) return { type: 'Slider', confidence: 0.85 };
  
  if (aspect < 0.75) {
    if (hasHorizontalSplit) return { type: 'Single Hung', confidence: 0.82 };
    return { type: 'Casement', confidence: 0.78 };
  }
  
  if (aspect >= 0.75 && aspect <= 1.25) {
    if (hasHorizontalSplit) return { type: 'Double Hung', confidence: 0.80 };
    if (hasVerticalSplit) return { type: 'Mullioned Fixed', confidence: 0.75 };
    return { type: 'Picture/Fixed', confidence: 0.85 };
  }
  
  return { type: 'Other/Custom', confidence: 0.50 };
}

/**
 * DimensionSnap Pro Logic: "Blackbriar" Sprint Edition
 * AI-Driven Measurement via a current OpenRouter vision model.
 */

const OPENROUTER_API_KEY = process.env[SCANNER_ENV_KEY];

function normalizeImageUrl({ photoUri, base64Image }) {
  const raw = base64Image || photoUri || '';
  if (!raw) return '';
  if (raw.startsWith('data:image/')) return raw;
  return `data:image/jpeg;base64,${raw}`;
}

function extractJsonObject(text = '') {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Scanner did not return JSON.');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function formatScannerRequestError(status, message) {
  let parsedMessage = message;
  try {
    const parsed = JSON.parse(message);
    parsedMessage = parsed?.error?.message || parsed?.message || message;
  } catch {}

  if (status === 404 && /No endpoints found/i.test(parsedMessage)) {
    return `Scanner model is unavailable on OpenRouter. Model: ${SCANNER_MODEL}.`;
  }

  return `Scanner request failed: ${status} ${parsedMessage}`;
}

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundToQuarter(value) {
  const n = numeric(value);
  if (n === null) return null;
  return Math.round(n * 4) / 4;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function loadBrowserImage(uri) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.Image) {
      reject(new Error('Browser image loading is unavailable.'));
      return;
    }

    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = uri;
  });
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let i = 0; i < 256; i += 1) {
    weightBackground += histogram[i];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += i * histogram[i];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = i;
    }
  }

  return threshold;
}

function findDarkComponents(dark, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];
  const queue = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!dark[start] || visited[start]) continue;

      let head = 0;
      let count = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      queue.length = 0;
      queue.push(start);
      visited[start] = 1;

      while (head < queue.length) {
        const index = queue[head];
        head += 1;
        count += 1;
        const px = index % width;
        const py = Math.floor(index / width);
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);

        addNeighbor(index - 1, px > 0);
        addNeighbor(index + 1, px < width - 1);
        addNeighbor(index - width, py > 0);
        addNeighbor(index + width, py < height - 1);
      }

      if (count >= 80) {
        components.push({ minX, maxX, minY, maxY, count });
      }
    }
  }

  return components;

  function addNeighbor(index, valid) {
    if (!valid || visited[index] || !dark[index]) return;
    visited[index] = 1;
    queue.push(index);
  }
}

function scoreMarkerComponent(component, imageWidth, imageHeight, scale) {
  const rawWidth = component.maxX - component.minX + 1;
  const rawHeight = component.maxY - component.minY + 1;
  const width = rawWidth / scale;
  const height = rawHeight / scale;
  const minEdge = Math.min(width, height);
  const maxEdge = Math.max(width, height);
  const cropArea = imageWidth * imageHeight;
  const rectArea = width * height;
  const areaRatio = rectArea / cropArea;
  const aspect = width / Math.max(height, 1);
  const squareScore = clamp(1 - Math.abs(1 - aspect) / 0.28, 0, 1);
  const fillRatio = component.count / Math.max(rawWidth * rawHeight, 1);
  const fillScore = clamp(1 - Math.abs(fillRatio - 0.58) / 0.36, 0, 1);
  const sizeScore = clamp((minEdge - 28) / 90, 0, 1);
  const areaScore = areaRatio >= 0.0015 && areaRatio <= 0.32 ? 1 : 0;
  const confidence = areaScore * (squareScore * 0.46 + fillScore * 0.28 + sizeScore * 0.26);

  return {
    rect: {
      x: component.minX / scale,
      y: component.minY / scale,
      width,
      height
    },
    confidence,
    edgePx: (width + height) / 2,
    fillRatio,
    areaRatio,
    aspect
  };
}

async function detectMarkerScaleLocally(imageUrl, targetPixelSize = null) {
  if (typeof document === 'undefined') return null;

  const img = await loadBrowserImage(imageUrl);
  const naturalWidth = Number(img.naturalWidth || img.width) || Number(targetPixelSize?.width) || 0;
  const naturalHeight = Number(img.naturalHeight || img.height) || Number(targetPixelSize?.height) || 0;
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;

  const maxAnalysisEdge = 720;
  const scale = Math.min(1, maxAnalysisEdge / Math.max(naturalWidth, naturalHeight));
  const analysisWidth = Math.max(1, Math.round(naturalWidth * scale));
  const analysisHeight = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = analysisWidth;
  canvas.height = analysisHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, analysisWidth, analysisHeight);

  const image = ctx.getImageData(0, 0, analysisWidth, analysisHeight);
  const gray = new Uint8Array(analysisWidth * analysisHeight);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < image.data.length; i += 4, p += 1) {
    const value = Math.round(image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114);
    gray[p] = value;
    histogram[value] += 1;
  }

  const threshold = Math.max(36, Math.min(156, otsuThreshold(histogram, gray.length) - 8));
  const dark = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    dark[i] = gray[i] < threshold ? 1 : 0;
  }

  const components = findDarkComponents(dark, analysisWidth, analysisHeight);
  let best = null;
  for (const component of components) {
    const candidate = scoreMarkerComponent(component, naturalWidth, naturalHeight, scale);
    if (candidate.edgePx < 28) continue;
    if (candidate.aspect < 0.72 || candidate.aspect > 1.38) continue;
    if (candidate.fillRatio < 0.16 || candidate.fillRatio > 0.92) continue;
    if (!best || candidate.confidence > best.confidence) best = candidate;
  }

  if (!best || best.confidence < LOCAL_MARKER_MIN_CONFIDENCE || best.edgePx <= 0) return null;

  const widthPx = Number(targetPixelSize?.width) || naturalWidth;
  const heightPx = Number(targetPixelSize?.height) || naturalHeight;
  const pxToIn = MARKER_TAG_BLACK_EDGE_IN / best.edgePx;
  const qualityPenalty = best.edgePx < 60 ? 0.12 : 0;

  return {
    widthIn: roundToQuarter(widthPx * pxToIn),
    heightIn: roundToQuarter(heightPx * pxToIn),
    confidence: clamp(best.confidence - qualityPenalty, 0, 0.94),
    referenceWidthPx: best.rect.width,
    referenceHeightPx: best.rect.height,
    referenceDetected: true,
    markerRect: best.rect,
    markerEdgePx: best.edgePx,
    targetPixelSize: { width: widthPx, height: heightPx },
    threshold: threshold
  };
}

function isPlausibleLocalOpeningMeasurement(measurement, expectedOpeningType = 'Window') {
  const widthIn = numeric(measurement?.widthIn);
  const heightIn = numeric(measurement?.heightIn);
  if (widthIn === null || heightIn === null) return false;

  const minEdge = Math.min(widthIn, heightIn);
  const maxEdge = Math.max(widthIn, heightIn);
  const minReasonableEdge = expectedOpeningType === 'Skylight' ? 12 : MIN_REASONABLE_OPENING_EDGE_IN;

  if (minEdge < minReasonableEdge) return false;
  if (expectedOpeningType === 'Door' && maxEdge < 60) return false;
  if (maxEdge > 180) return false;

  return true;
}

function applyOpeningPlausibility(measured, expectedOpeningType = 'Window') {
  if (isPlausibleLocalOpeningMeasurement(measured, expectedOpeningType)) return measured;

  return {
    ...measured,
    confidence: Math.min(numeric(measured?.confidence) ?? 0, 0.49),
    source: measured?.source ? `${measured.source}-implausible-size` : 'implausible-size'
  };
}

function buildMeasuredFields(aiResult, knownReferenceWidthIn, knownReferenceHeightIn, targetPixelSize = null) {
  const confidence = Math.max(0, Math.min(1, numeric(aiResult.confidence) ?? 0));
  const referenceDetected = aiResult.reference_detected === true;
  const referenceWidthPx = numeric(aiResult.reference_width_px);
  const referenceHeightPx = numeric(aiResult.reference_height_px);
  const measuredTargetWidthPx = numeric(targetPixelSize?.width);
  const measuredTargetHeightPx = numeric(targetPixelSize?.height);
  const openingWidthPx = measuredTargetWidthPx || numeric(aiResult.opening_width_px);
  const openingHeightPx = measuredTargetHeightPx || numeric(aiResult.opening_height_px);
  const directWidth = numeric(aiResult.width_in);
  const directHeight = numeric(aiResult.height_in);
  const targetPixelSizeUsed = !!(measuredTargetWidthPx && measuredTargetHeightPx);
  const squareReferencePx = referenceWidthPx !== null && referenceHeightPx !== null
    ? (referenceWidthPx + referenceHeightPx) / 2
    : referenceWidthPx !== null ? referenceWidthPx : referenceHeightPx;

  if (targetPixelSizeUsed && referenceDetected && squareReferencePx !== null && squareReferencePx > 5) {
    const pxToIn = knownReferenceWidthIn / squareReferencePx;
    return {
      widthIn: roundToQuarter(openingWidthPx * pxToIn),
      heightIn: roundToQuarter(openingHeightPx * pxToIn),
      confidence,
      source: 'user-box-pixel-scale',
      referenceDetected,
      referenceWidthPx,
      referenceHeightPx,
      openingWidthPx,
      openingHeightPx,
      targetPixelSizeUsed: true
    };
  }

  const hasWidthScale = referenceDetected
    && referenceWidthPx !== null
    && openingWidthPx !== null
    && referenceWidthPx > 5
    && openingWidthPx > referenceWidthPx;

  const hasHeightScale = referenceDetected
    && referenceHeightPx !== null
    && openingHeightPx !== null
    && referenceHeightPx > 5
    && openingHeightPx > referenceHeightPx;

  if (!hasWidthScale && !hasHeightScale) {
    return {
      widthIn: null,
      heightIn: null,
      confidence: Math.min(confidence, 0.49),
      source: 'no-scale-pixel-evidence',
      referenceDetected,
      referenceWidthPx,
      referenceHeightPx,
      openingWidthPx,
      openingHeightPx
    };
  }

  const widthPxToIn = hasWidthScale ? knownReferenceWidthIn / referenceWidthPx : null;
  const heightPxToIn = hasHeightScale ? knownReferenceHeightIn / referenceHeightPx : null;
  const widthIn = widthPxToIn !== null ? roundToQuarter(openingWidthPx * widthPxToIn) : null;
  const heightIn = heightPxToIn !== null ? roundToQuarter(openingHeightPx * heightPxToIn) : null;
  const directGuessKey = directWidth !== null && directHeight !== null
    ? `${Math.round(directWidth)}x${Math.round(directHeight)}`
    : '';
  const measuredGuessKey = widthIn !== null && heightIn !== null
    ? `${Math.round(widthIn)}x${Math.round(heightIn)}`
    : '';
  const looksLikeCommonGuess = COMMON_GUESS_PAIRS.has(directGuessKey) || COMMON_GUESS_PAIRS.has(measuredGuessKey);

  return {
    widthIn,
    heightIn,
    confidence: looksLikeCommonGuess || !hasWidthScale || !hasHeightScale ? Math.min(confidence, 0.68) : confidence,
    source: hasWidthScale && hasHeightScale ? 'pixel-scale-card-edges' : 'partial-pixel-scale-card-edge',
    referenceDetected,
    referenceWidthPx,
    referenceHeightPx,
    openingWidthPx,
    openingHeightPx,
    targetPixelSizeUsed
  };
}

function buildScanBoxInstruction(scanBox = null, scanCropApplied = false) {
  if (scanCropApplied) {
    return [
      'The provided image has already been cropped from the user-adjusted scan box.',
      'Treat the cropped image as the selected target area.',
      'Measure the full window/opening section visible in this cropped image, using the DimensionsPro marker card inside the crop for scale.',
      'Use the selected crop as the intended measurement target. Do not switch to one pane, one grid cell, or only the sash that contains the marker.',
      'Ignore any partial neighboring windows, walls, trim, or bracket sections that only appear at the crop edges.'
    ].join(' ');
  }

  const hasBox = scanBox
    && Number.isFinite(scanBox.left)
    && Number.isFinite(scanBox.top)
    && Number.isFinite(scanBox.right)
    && Number.isFinite(scanBox.bottom);

  if (!hasBox) {
    return 'The user did not provide a scan box. Measure the clearest full opening or window section that contains the DimensionsPro marker card.';
  }

  const pct = (value) => `${Math.round(value * 100)}%`;
  return [
    `The user drew an adjustable scan box over the target window/opening: left ${pct(scanBox.left)}, top ${pct(scanBox.top)}, right ${pct(scanBox.right)}, bottom ${pct(scanBox.bottom)} of the displayed image.`,
    'Treat that rectangle as the selected measurement target, similar to an Adobe Scan crop box.',
    'Measure the full window/opening section inside that scan box. Ignore other windows, brackets, mullions, wall trim, and sections outside the box.',
    'If the selected box cuts through a frame edge, use the nearest visible frame/opening edge inside the box and return low confidence if uncertain.'
  ].join(' ');
}

export async function analyzeWindowPhoto({ photoUri, base64Image, expectedOpeningType = 'Window', scanBox = null, scanCropApplied = false, targetPixelSize = null }) {
  const imageUrl = normalizeImageUrl({ photoUri, base64Image });
  if (!imageUrl) {
    throw new Error('No photo data was available for scanning.');
  }

  if (scanCropApplied && targetPixelSize) {
    const localMeasurement = await detectMarkerScaleLocally(imageUrl, targetPixelSize);
    if (localMeasurement && isPlausibleLocalOpeningMeasurement(localMeasurement, expectedOpeningType)) {
      return {
        meta: {
          version: 'blackbriar-v2.1-local-marker',
          engine: 'browser-marker-detector',
          measurementSource: 'local-marker-crop-scale',
          referenceDetected: localMeasurement.referenceDetected,
          referenceWidthPx: localMeasurement.referenceWidthPx,
          referenceHeightPx: localMeasurement.referenceHeightPx,
          openingWidthPx: localMeasurement.targetPixelSize.width,
          openingHeightPx: localMeasurement.targetPixelSize.height,
          scanBox: scanBox || null,
          scanCropApplied: true,
          targetPixelSize: localMeasurement.targetPixelSize,
          targetPixelSizeUsed: true,
          markerRect: localMeasurement.markerRect,
          markerEdgePx: localMeasurement.markerEdgePx,
          threshold: localMeasurement.threshold
        },
        fields: {
          openingType: { value: expectedOpeningType, confidence: 0 },
          subtype: { value: 'Other', confidence: 0 },
          estimatedWidthIn: { value: localMeasurement.widthIn, confidence: localMeasurement.confidence },
          estimatedHeightIn: { value: localMeasurement.heightIn, confidence: localMeasurement.confidence }
        }
      };
    }
  }

  if (!OPENROUTER_API_KEY) {
    throw new Error(`Missing ${SCANNER_ENV_KEY}. Add it to .env.local and restart Expo before scanning.`);
  }

  const referenceText = 'Find the high-contrast black AprilTag square on the DimensionsPro marker card. Use the outer black square edge as exactly 1.2 inches. Do not use the full white card edge, printed text, or any window/grid edge as the reference.';
  const scanBoxText = buildScanBoxInstruction(scanBox, scanCropApplied);
  const knownReferenceWidthIn = MARKER_TAG_BLACK_EDGE_IN;
  const knownReferenceHeightIn = MARKER_TAG_BLACK_EDGE_IN;
  const openingTypeText = expectedOpeningType === 'Door'
    ? [
        'This is expected to be a door, often a patio slider or multi-slide.',
        'Measure the full door unit rectangle, not a panel.',
        'Width target: from the outer exposed left vertical door-frame/jamb edge to the outer exposed right vertical door-frame/jamb edge.',
        'Height target: from the top head-frame edge to the bottom sill/threshold edge.',
        'Use the color/material boundary where the door frame changes to surrounding stucco, wall, casing, molding, or trim.',
        'Do not measure only glass, only one sliding panel, one operable sash, screen frame, center meeting rail, decorative molding, wall trim, or stucco opening.',
        'Assume normal field photos have no guide marks. If the outer frame edges cannot be confidently separated from same-color molding, trim, wall, glare, or shadows, return low confidence and null dimensions.'
      ].join(' ')
    : expectedOpeningType === 'Skylight'
      ? 'This is expected to be a skylight. Measure the full visible skylight frame/curb, not only the glass daylight opening.'
      : [
          'This is expected to be a window.',
          'Measure the full selected window/opening section, not one pane, one grid cell, or only the sash that contains the marker card.',
          'Width target: from the selected left window/frame/opening edge to the selected right window/frame/opening edge.',
          'Height target: from the selected top window/frame/opening edge to the selected bottom window/frame/opening edge.',
          'Ignore decorative grid bars, muntins, simulated divided-lite bars, insect screen texture, glare, stickers, and locks. Do not stop height at an internal horizontal grid bar.',
          'If the selected outer edges cannot be confidently separated from grids, screen texture, glare, trim, wall, or shadows, return low confidence and null dimensions.'
        ].join(' ');

  // 1. Identify and Measure via the configured OpenRouter vision model.
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://dimensionspro.app',
        'X-Title': 'DimensionsPro'
      },
      body: JSON.stringify({
        model: SCANNER_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: [
                  `${referenceText}`,
                  `${scanBoxText}`,
                  openingTypeText,
                  'Measure from pixel ratios, not by guessing a common size.',
                  scanCropApplied
                    ? 'Estimate only these marker pixel spans from the image: reference_width_px as the black AprilTag square outer width, reference_height_px as the black AprilTag square outer height. Set opening_width_px and opening_height_px to null.'
                    : 'First estimate these pixel spans from the image: reference_width_px as the black AprilTag square outer width, reference_height_px as the black AprilTag square outer height, opening_width_px, opening_height_px.',
                  'If the reference object or target frame edges are not clearly visible, set reference_detected=false, confidence below 0.5, and dimensions to null. Do not invent dimensions when edge contrast is poor.',
                  'Do not return common default sizes such as 54x72 unless the pixel ratio supports them.',
                  'Return ONLY a valid JSON object with double-quoted keys:',
                  '{ "reference_detected": boolean, "reference_kind": string, "reference_width_px": number|null, "reference_height_px": number|null, "opening_width_px": number|null, "opening_height_px": number|null, "width_in": number|null, "height_in": number|null, "subtype": string, "confidence": number, "notes": string }'
                ].join(' ')
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl }
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(formatScannerRequestError(response.status, message));
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const aiResult = extractJsonObject(content);
    const measured = applyOpeningPlausibility(
      buildMeasuredFields(aiResult, knownReferenceWidthIn, knownReferenceHeightIn, targetPixelSize),
      expectedOpeningType
    );

    return {
      meta: {
        version: 'blackbriar-v2.0-vision',
        engine: SCANNER_MODEL,
        measurementSource: measured.source,
        referenceDetected: measured.referenceDetected,
        referenceWidthPx: measured.referenceWidthPx,
        referenceHeightPx: measured.referenceHeightPx,
        openingWidthPx: measured.openingWidthPx,
        openingHeightPx: measured.openingHeightPx,
        scanBox: scanBox || null,
        scanCropApplied: !!scanCropApplied,
        targetPixelSize: targetPixelSize || null,
        targetPixelSizeUsed: !!measured.targetPixelSizeUsed
      },
      fields: {
        openingType: { value: expectedOpeningType, confidence: 0 },
        subtype: { value: aiResult.subtype || 'Other', confidence: measured.confidence },
        estimatedWidthIn: { value: measured.widthIn, confidence: measured.confidence },
        estimatedHeightIn: { value: measured.heightIn, confidence: measured.confidence }
      }
    };
  } catch (e) {
    console.error('Vision analysis failed', e);
    throw new Error(e?.message || 'Vision link failed. Reverting to manual.');
  }
}
