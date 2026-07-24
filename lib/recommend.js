const clean = (value, max = 200) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

async function google(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message || `Google API returned ${response.status}`);
  }
  return body;
}

async function geocode(address, apiKey) {
  const match = address.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (match) {
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { address: "Current location", location: { lat, lng } };
    }
  }
  const data = await google("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.formattedAddress,places.location",
    },
    body: JSON.stringify({ textQuery: address, pageSize: 1 }),
  });
  if (!data.places?.length) throw new Error(`Could not find "${address}"`);
  return {
    address: data.places[0].formattedAddress,
    location: {
      lat: data.places[0].location.latitude,
      lng: data.places[0].location.longitude,
    },
  };
}

async function searchPlaces(query, center, apiKey) {
  const data = await google("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.regularOpeningHours,places.dineIn,places.outdoorSeating",
    },
    body: JSON.stringify({
      textQuery: query,
      pageSize: 12,
      locationBias: { circle: { center, radius: 5000 } },
    }),
  });
  return data.places || [];
}

async function routeMatrix(origins, places, travelMode, apiKey) {
  const mode = ["WALK", "DRIVE", "BICYCLE", "TRANSIT"].includes(travelMode)
    ? travelMode
    : "TRANSIT";
  return google("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "originIndex,destinationIndex,status,condition,distanceMeters,duration",
    },
    body: JSON.stringify({
      origins: origins.map(({ location }) => ({
        waypoint: {
          location: {
            latLng: { latitude: location.lat, longitude: location.lng },
          },
        },
      })),
      destinations: places.map((place) => ({
        waypoint: {
          location: {
            latLng: {
              latitude: place.location.latitude,
              longitude: place.location.longitude,
            },
          },
        },
      })),
      travelMode: mode,
    }),
  });
}

async function getWeather(center, meetingTime, apiKey) {
  const requested = new Date(meetingTime);
  const hours = Math.min(
    Math.max(1, Math.ceil((requested - new Date()) / 3600000) + 1),
    240
  );
  const url = new URL("https://weather.googleapis.com/v1/forecast/hours:lookup");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("location.latitude", center.latitude);
  url.searchParams.set("location.longitude", center.longitude);
  url.searchParams.set("hours", hours);
  url.searchParams.set("unitsSystem", "METRIC");
  url.searchParams.set("languageCode", "en");
  const forecasts = (await google(url)).forecastHours || [];
  const target = requested.getTime();
  const forecast = forecasts.reduce((closest, item) => {
    if (!closest) return item;
    return Math.abs(new Date(item.interval.startTime) - target) <
      Math.abs(new Date(closest.interval.startTime) - target)
      ? item
      : closest;
  }, null);
  if (!forecast) return null;
  const rainChance = forecast.precipitation?.probability?.percent || 0;
  const temperatureC = forecast.temperature?.degrees;
  const windKph = forecast.wind?.speed?.value || 0;
  const difficult = rainChance >= 50 || temperatureC <= 8 || windKph >= 30;
  return {
    condition: forecast.weatherCondition?.description?.text || "Forecast available",
    temperatureC,
    rainChance,
    windKph,
    icon: forecast.weatherCondition?.iconBaseUri
      ? `${forecast.weatherCondition.iconBaseUri}.svg`
      : null,
    difficult,
    advice: difficult
      ? "Weather protection and shorter exposed journeys are prioritised."
      : "Conditions allow a wider mix of indoor and outdoor options.",
  };
}

const seconds = (duration = "") =>
  Number.parseFloat(duration.replace("s", "")) || Infinity;

export async function buildRecommendations(input) {
  const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!apiKey) throw new Error("Google Maps API key is not configured");
  const participantLocations = Array.isArray(input.participants)
    ? input.participants.map((participant) => clean(participant.location)).filter(Boolean).slice(0, 10)
    : [clean(input.personA), clean(input.personB)].filter(Boolean);
  const query = clean(input.query);
  const travelMode = clean(input.travelMode, 20).toUpperCase();
  const maxMinutes = Math.min(Math.max(Number(input.maxMinutes) || 30, 5), 180);
  const meetingTime = clean(input.meetingTime, 40);
  const parsedTime = new Date(meetingTime);
  if (participantLocations.length < 2 || !query || Number.isNaN(parsedTime.valueOf())) {
    throw new Error("At least two locations, a request, and meeting time are required");
  }
  if (
    parsedTime < new Date(Date.now() - 3600000) ||
    parsedTime > new Date(Date.now() + 239 * 3600000)
  ) {
    throw new Error("Choose a meeting time within the next 9 days");
  }

  const origins = await Promise.all(
    participantLocations.map((location) => geocode(location, apiKey))
  );
  const center = {
    latitude: origins.reduce((sum, origin) => sum + origin.location.lat, 0) / origins.length,
    longitude: origins.reduce((sum, origin) => sum + origin.location.lng, 0) / origins.length,
  };
  const [places, weather] = await Promise.all([
    searchPlaces(query, center, apiKey),
    getWeather(center, parsedTime.toISOString(), apiKey),
  ]);
  if (!places.length) return { origins, weather, recommendations: [] };

  const matrix = await routeMatrix(origins, places, travelMode, apiKey);
  const journeys = new Map();
  for (const route of matrix) {
    if (route.condition !== "ROUTE_EXISTS" || route.status?.code) continue;
    journeys.set(`${route.originIndex}:${route.destinationIndex}`, {
      minutes: Math.ceil(seconds(route.duration) / 60),
      distanceKm: Number((route.distanceMeters / 1000).toFixed(1)),
    });
  }
  const outdoorTypes = ["park", "garden", "hiking_area", "picnic_ground", "plaza"];
  const recommendations = places
    .map((place, index) => {
      const participantJourneys = origins.map((_, originIndex) =>
        journeys.get(`${originIndex}:${index}`)
      );
      if (participantJourneys.some((journey) => !journey)) return null;
      const minutes = participantJourneys.map((journey) => journey.minutes);
      const longest = Math.max(...minutes);
      const difference = longest - Math.min(...minutes);
      const outdoor = (place.types || []).some((type) => outdoorTypes.includes(type));
      const weatherPenalty = weather?.difficult
        ? outdoor
          ? 18
          : place.dineIn
            ? -4
            : 0
        : 0;
      const weatherReason = weather?.difficult
        ? place.dineIn
          ? " Its dine-in option is a good match for the forecast."
          : outdoor
            ? " It is outdoor-oriented, so check the forecast before choosing it."
            : ""
        : outdoor
          ? " The forecast makes an outdoor option worth considering."
          : "";
      return {
        id: place.id,
        name: place.displayName?.text || "Unnamed place",
        address: place.formattedAddress,
        rating: place.rating,
        ratingCount: place.userRatingCount,
        priceLevel: place.priceLevel,
        mapsUrl: place.googleMapsUri,
        journeys: participantJourneys,
        longest,
        difference,
        score:
          longest * 2 +
          difference * 1.5 -
          (place.rating || 0) * 3 +
          weatherPenalty,
        explanation:
          difference <= 5
            ? `A fair option — only ${difference} minute${difference === 1 ? "" : "s"} between your journeys.${weatherReason}`
            : `Both routes work, with a ${difference}-minute journey difference.${weatherReason}`,
      };
    })
    .filter(Boolean)
    .filter((place) => place.longest <= maxMinutes)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);
  return { origins, weather, recommendations, maxMinutes, travelMode };
}
