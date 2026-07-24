const path = require("node:path");
const express = require("express");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY;

app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(__dirname, "public")));

const clean = (value, max = 200) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

async function google(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("Google API error:", response.status, body.error?.message);
    throw new Error(body.error?.message || `Google API returned ${response.status}`);
  }
  return body;
}

async function geocode(address) {
  const data = await google("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": "places.formattedAddress,places.location",
    },
    body: JSON.stringify({ textQuery: address, pageSize: 1 }),
  });
  if (!data.places?.length) {
    throw new Error(`Could not find "${address}"`);
  }
  return {
    address: data.places[0].formattedAddress,
    location: {
      lat: data.places[0].location.latitude,
      lng: data.places[0].location.longitude,
    },
  };
}

async function searchPlaces(query, center) {
  const data = await google("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.regularOpeningHours",
    },
    body: JSON.stringify({
      textQuery: query,
      pageSize: 12,
      locationBias: {
        circle: { center, radius: 5000 },
      },
    }),
  });
  return data.places || [];
}

async function routeMatrix(origins, places, travelMode) {
  const mode = {
    WALK: "WALK",
    DRIVE: "DRIVE",
    BICYCLE: "BICYCLE",
    TRANSIT: "TRANSIT",
  }[travelMode] || "TRANSIT";

  const data = await google(
    "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,status,condition,distanceMeters,duration",
      },
      body: JSON.stringify({
        origins: origins.map(({ location }) => ({
          waypoint: { location: { latLng: {
            latitude: location.lat,
            longitude: location.lng,
          } } },
        })),
        destinations: places.map((place) => ({
          waypoint: { location: { latLng: {
            latitude: place.location.latitude,
            longitude: place.location.longitude,
          } } },
        })),
        travelMode: mode,
      }),
    }
  );
  return data;
}

function seconds(duration = "") {
  return Number.parseFloat(duration.replace("s", "")) || Infinity;
}

app.post("/api/recommend", async (request, response) => {
  if (!API_KEY) {
    return response.status(503).json({
      error: "Add GOOGLE_MAPS_SERVER_API_KEY to the .env file first.",
    });
  }

  const personA = clean(request.body.personA);
  const personB = clean(request.body.personB);
  const query = clean(request.body.query);
  const travelMode = clean(request.body.travelMode, 20).toUpperCase();
  const maxMinutes = Math.min(Math.max(Number(request.body.maxMinutes) || 30, 5), 180);

  if (!personA || !personB || !query) {
    return response.status(400).json({ error: "Both locations and a request are required." });
  }

  try {
    const origins = await Promise.all([geocode(personA), geocode(personB)]);
    const center = {
      latitude: (origins[0].location.lat + origins[1].location.lat) / 2,
      longitude: (origins[0].location.lng + origins[1].location.lng) / 2,
    };
    const places = await searchPlaces(query, center);
    if (!places.length) {
      return response.json({ origins, recommendations: [] });
    }

    const matrix = await routeMatrix(origins, places, travelMode);
    const journeys = new Map();
    for (const route of matrix) {
      if (route.condition !== "ROUTE_EXISTS" || route.status?.code) continue;
      journeys.set(`${route.originIndex}:${route.destinationIndex}`, {
        minutes: Math.ceil(seconds(route.duration) / 60),
        distanceKm: Number((route.distanceMeters / 1000).toFixed(1)),
      });
    }

    const recommendations = places
      .map((place, index) => {
        const a = journeys.get(`0:${index}`);
        const b = journeys.get(`1:${index}`);
        if (!a || !b) return null;
        const longest = Math.max(a.minutes, b.minutes);
        const difference = Math.abs(a.minutes - b.minutes);
        const rating = place.rating || 0;
        const score = longest * 2 + difference * 1.5 - rating * 3;
        return {
          id: place.id,
          name: place.displayName?.text || "Unnamed place",
          address: place.formattedAddress,
          rating: place.rating,
          ratingCount: place.userRatingCount,
          priceLevel: place.priceLevel,
          mapsUrl: place.googleMapsUri,
          openNow: place.regularOpeningHours?.openNow,
          location: place.location,
          journeys: [a, b],
          longest,
          difference,
          score,
          explanation:
            difference <= 5
              ? `A fair option — only ${difference} minute${difference === 1 ? "" : "s"} between your journeys.`
              : `Both routes work, with a ${difference}-minute journey difference.`,
        };
      })
      .filter(Boolean)
      .filter((place) => place.longest <= maxMinutes)
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);

    response.json({ origins, recommendations, maxMinutes, travelMode });
  } catch (error) {
    response.status(502).json({ error: error.message || "Google Maps request failed." });
  }
});

app.get("/api/health", (_request, response) =>
  response.json({ ok: true, apiKeyConfigured: Boolean(API_KEY) })
);

app.listen(PORT, () => {
  console.log(`MeetSpot is running at http://localhost:${PORT}`);
});
