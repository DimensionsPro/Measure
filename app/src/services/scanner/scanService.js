// Dimensions Scanner (MVP scaffold)
// Goal: accept a head-on photo with a visible credit card and return best-effort fields + confidence.

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

const CREDIT_CARD_WIDTH_IN = 3.375;
const SCANNER_MODEL = 'google/gemini-2.5-flash';
const COMMON_GUESS_PAIRS = new Set(['54x72', '72x54', '36x48', '48x36', '48x60', '60x48']);

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

const OPENROUTER_API_KEY = process.env.EXPO_PUBLIC_OPENROUTER_KEY;

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

function buildMeasuredFields(aiResult, knownReferenceWidthIn) {
  const confidence = Math.max(0, Math.min(1, numeric(aiResult.confidence) ?? 0));
  const referenceDetected = aiResult.reference_detected === true;
  const referenceWidthPx = numeric(aiResult.reference_width_px);
  const openingWidthPx = numeric(aiResult.opening_width_px);
  const openingHeightPx = numeric(aiResult.opening_height_px);
  const directWidth = numeric(aiResult.width_in);
  const directHeight = numeric(aiResult.height_in);

  const hasPixelScale = referenceDetected
    && referenceWidthPx !== null
    && openingWidthPx !== null
    && openingHeightPx !== null
    && referenceWidthPx > 5
    && openingWidthPx > referenceWidthPx
    && openingHeightPx > referenceWidthPx;

  if (!hasPixelScale) {
    return {
      widthIn: null,
      heightIn: null,
      confidence: Math.min(confidence, 0.49),
      source: 'no-scale-pixel-evidence',
      referenceDetected,
      referenceWidthPx,
      openingWidthPx,
      openingHeightPx
    };
  }

  const pxToIn = knownReferenceWidthIn / referenceWidthPx;
  const widthIn = roundToQuarter(openingWidthPx * pxToIn);
  const heightIn = roundToQuarter(openingHeightPx * pxToIn);
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
    confidence: looksLikeCommonGuess ? Math.min(confidence, 0.68) : confidence,
    source: 'pixel-scale-ratio',
    referenceDetected,
    referenceWidthPx,
    openingWidthPx,
    openingHeightPx
  };
}

export async function analyzeWindowPhoto({ photoUri, base64Image, expectedOpeningType = 'Window' }) {
  const imageUrl = normalizeImageUrl({ photoUri, base64Image });
  if (!imageUrl) {
    throw new Error('No photo data was available for scanning.');
  }

  if (!OPENROUTER_API_KEY) {
    throw new Error('Missing EXPO_PUBLIC_OPENROUTER_KEY. Add it to your environment before scanning.');
  }

  const referenceText = 'Find the standard credit card or credit-card-sized marker. Use its long edge as exactly 3.375 inches.';
  const knownReferenceWidthIn = CREDIT_CARD_WIDTH_IN;
  const openingTypeText = expectedOpeningType === 'Door'
    ? [
        'This is expected to be a door, often a patio slider or multi-slide.',
        'Measure the full door unit rectangle, not a panel.',
        'Width target: from the outer exposed left vertical door-frame/jamb edge to the outer exposed right vertical door-frame/jamb edge.',
        'Height target: from the top head-frame edge to the bottom sill/threshold edge.',
        'Use the color/material boundary where the door frame changes to surrounding stucco, wall, casing, molding, or trim.',
        'Do not measure only glass, only one sliding panel, one operable sash, screen frame, center meeting rail, decorative molding, wall trim, or stucco opening.',
        'If blue/light-blue guide lines are drawn on the photo, treat those guide lines as the intended measurement edges.'
      ].join(' ')
    : expectedOpeningType === 'Skylight'
      ? 'This is expected to be a skylight. Measure the full visible skylight frame/curb, not only the glass daylight opening.'
      : [
          'This is expected to be a window.',
          'Measure the full visible window unit/frame rectangle from outer frame edge to outer frame edge.',
          'Use the color/material boundary where the window frame changes to surrounding wall, casing, molding, or trim.',
          'Do not measure only glass, one sash, daylight opening, decorative molding, wall trim, or stucco opening.',
          'If blue/light-blue guide lines are drawn on the photo, treat those guide lines as the intended measurement edges.'
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
                  openingTypeText,
                  'Measure the target unit frame from the photo using pixel ratios, not by guessing a common size.',
                  'First estimate these pixel spans from the image: reference_width_px, opening_width_px, opening_height_px.',
                  'If the reference object or opening edges are not clearly visible, set reference_detected=false, confidence below 0.5, and dimensions to null.',
                  'Do not return common default sizes such as 54x72 unless the pixel ratio supports them.',
                  'Return ONLY a valid JSON object with double-quoted keys:',
                  '{ "reference_detected": boolean, "reference_kind": string, "reference_width_px": number|null, "opening_width_px": number|null, "opening_height_px": number|null, "width_in": number|null, "height_in": number|null, "subtype": string, "confidence": number, "notes": string }'
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
    const measured = buildMeasuredFields(aiResult, knownReferenceWidthIn);

    return {
      meta: {
        version: 'blackbriar-v2.0-vision',
        engine: SCANNER_MODEL,
        measurementSource: measured.source,
        referenceDetected: measured.referenceDetected,
        referenceWidthPx: measured.referenceWidthPx,
        openingWidthPx: measured.openingWidthPx,
        openingHeightPx: measured.openingHeightPx
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
