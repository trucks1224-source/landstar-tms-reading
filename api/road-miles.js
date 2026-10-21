const metersPerMile = 1609.344;

function normalizeLocation(location) {
  if (!location || typeof location !== 'object') return null;

  const city = String(location.city || '').trim();
  const state = String(location.state || '').trim();
  const zip = String(location.zip || '').trim();
  if (!city || !state || city.length > 100 || state.length > 50 || zip.length > 12
    || /[\u0000-\u001f]/.test(city + state + zip)) return null;

  return [city, state, zip].filter(Boolean).join(', ');
}

export async function processRoadMilesRequest(request, apiKey, fetchImpl = fetch) {
  if (request.method !== 'POST') {
    return { status: 405, body: { error: 'Use POST to request road miles.' } };
  }
  if (!apiKey) {
    return {
      status: 503,
      body: { error: 'Google Routes is not configured. Add GOOGLE_MAPS_API_KEY to the server environment.' }
    };
  }

  let body = request.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return { status: 400, body: { error: 'The road-miles request must contain valid JSON.' } };
    }
  }

  const origin = normalizeLocation(body?.origin);
  const destination = normalizeLocation(body?.destination);
  if (!origin || !destination) {
    return {
      status: 400,
      body: { error: 'Enter a valid origin and destination city and state before requesting road miles.' }
    };
  }

  try {
    const response = await fetchImpl('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters'
      },
      body: JSON.stringify({
        origin: { address: origin },
        destination: { address: destination },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE'
      })
    });
    const result = await response.json();
    if (!response.ok) {
      return {
        status: 502,
        body: { error: result?.error?.message || 'Google Routes could not calculate this route.' }
      };
    }

    const distanceMeters = result?.routes?.[0]?.distanceMeters;
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
      return { status: 422, body: { error: 'Google Routes did not return a road route for these locations.' } };
    }

    return { status: 200, body: { miles: Math.round(distanceMeters / metersPerMile) } };
  } catch (error) {
    console.error('Google road-mile lookup failed:', error);
    return { status: 502, body: { error: 'Could not reach Google Routes. Check the connection and try again.' } };
  }
}

export default async function handler(req, res) {
  const result = await processRoadMilesRequest(req, process.env.GOOGLE_MAPS_API_KEY);
  return res.status(result.status).json(result.body);
}
