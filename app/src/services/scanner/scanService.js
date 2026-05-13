// Dimensions Scanner (MVP scaffold)
// Goal: accept a head-on photo with 1" square sticker and return best-effort fields + confidence.

export const SCAN_FIELD_SCHEMA = {
  requiredInput: [
    'photoUri',
    'hasOneInchSquareSticker'
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

function getImageSizeAsync(uri) {
  return new Promise((resolve) => {
    if (!uri || typeof Image === 'undefined' || !Image.getSize) {
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

// NOTE: This is intentionally conservative.
// True physical dimensions require marker detection + perspective correction.
export async function analyzeWindowPhoto({ photoUri, hasOneInchSquareSticker = true, Image }) {
  const size = await getImageSizeAsync(photoUri, Image);
  const aspect = size.height > 0 ? size.width / size.height : 1;

  const openingType = aspect >= 1 ? 'Window' : 'Door';
  const openingTypeConfidence = aspect >= 1 ? 0.76 : 0.71;

  const hasGrids = false;
  const hasGridsConfidence = 0.55; // below threshold by default in scaffold

  // Placeholder estimates until sticker detection pipeline is added.
  // We return low confidence so UI asks for review.
  const estimatedWidthIn = Math.round((aspect >= 1 ? 48 : 36) * 100) / 100;
  const estimatedHeightIn = Math.round((aspect >= 1 ? 48 : 80) * 100) / 100;
  const dimensionConfidence = hasOneInchSquareSticker ? 0.45 : 0.2;

  return {
    meta: {
      version: 'scanner-mvp-0.1',
      markerExpected: '1in_square_sticker',
      imageWidthPx: size.width,
      imageHeightPx: size.height,
      aspectRatio: aspect
    },
    fields: {
      openingType: { value: openingType, confidence: openingTypeConfidence },
      operation: { value: openingType === 'Door' ? 'Swing' : 'Single Hung', confidence: 0.41 },
      hasGrids: { value: hasGrids, confidence: hasGridsConfidence },
      estimatedWidthIn: { value: estimatedWidthIn, confidence: dimensionConfidence },
      estimatedHeightIn: { value: estimatedHeightIn, confidence: dimensionConfidence }
    }
  };
}
