// Dimensions Scanner (MVP scaffold)
// Goal: accept a head-on photo with 1" square sticker and return best-effort fields + confidence.

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

const REFERENCE_MARKER_IN = 3.375; // Primary: Credit Card (3.375")
const CREDIT_CARD_WIDTH_IN = 3.375;
const STICKER_ONE_INCH = 1.0;

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
 * AI-Driven Measurement via Gemini 2.0 Vision.
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

export async function analyzeWindowPhoto({ photoUri, base64Image, useCreditCard = true }) {
  const imageUrl = normalizeImageUrl({ photoUri, base64Image });
  if (!imageUrl) {
    throw new Error('No photo data was available for scanning.');
  }

  if (!OPENROUTER_API_KEY) {
    throw new Error('Missing EXPO_PUBLIC_OPENROUTER_KEY. Add it to your environment before scanning.');
  }

  const referenceText = useCreditCard
    ? 'Detect the standard credit card in this image and use it as a 3.375-inch horizontal scale reference.'
    : 'Detect the 1-inch square sticker/marker in this image and use it as the scale reference.';

  // 1. Identify and Measure via Gemini 2.0 Flash (Fast + Vision Capable)
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
        model: 'google/gemini-2.0-flash-001',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${referenceText} Measure the Net Frame width and height of the window. Return ONLY a valid JSON object with double-quoted keys: { "width_in": number, "height_in": number, "subtype": string, "confidence": number }.`
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
      throw new Error(`Scanner request failed: ${response.status} ${message}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const aiResult = extractJsonObject(content);
    const confidence = Number(aiResult.confidence);

    return {
      meta: {
        version: 'blackbriar-v2.0-vision',
        engine: 'gemini-2.0-flash'
      },
      fields: {
        openingType: { value: 'Window', confidence: 1.0 },
        subtype: { value: aiResult.subtype || 'Other', confidence },
        estimatedWidthIn: { value: Number(aiResult.width_in), confidence },
        estimatedHeightIn: { value: Number(aiResult.height_in), confidence }
      }
    };
  } catch (e) {
    console.error('Vision analysis failed', e);
    throw new Error(e?.message || 'Vision link failed. Reverting to manual.');
  }
}
