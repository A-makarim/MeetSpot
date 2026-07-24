const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const express = require("express");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.GOOGLE_MAPS_SERVER_API_KEY;
const dataDirectory = path.join(__dirname, "data");
fs.mkdirSync(dataDirectory, { recursive: true });
const db = new DatabaseSync(path.join(dataDirectory, "meetspot.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    organizer_name TEXT NOT NULL,
    organizer_location TEXT NOT NULL,
    guest_name TEXT,
    guest_location TEXT,
    query TEXT NOT NULL,
    travel_mode TEXT NOT NULL,
    max_minutes INTEGER NOT NULL,
    meeting_time TEXT NOT NULL,
    results_json TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )
`);

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
  const coordinateMatch = address.match(
    /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/
  );
  if (coordinateMatch) {
    const lat = Number(coordinateMatch[1]);
    const lng = Number(coordinateMatch[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { address: "Current location", location: { lat, lng } };
    }
  }
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
        "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.regularOpeningHours,places.dineIn,places.outdoorSeating",
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

async function getWeather(center, meetingTime) {
  const requested = new Date(meetingTime);
  const now = new Date();
  const hoursAhead = Math.max(1, Math.ceil((requested - now) / 3600000) + 1);
  const forecastHours = Math.min(hoursAhead, 240);
  const url = new URL("https://weather.googleapis.com/v1/forecast/hours:lookup");
  url.searchParams.set("key", API_KEY);
  url.searchParams.set("location.latitude", center.latitude);
  url.searchParams.set("location.longitude", center.longitude);
  url.searchParams.set("hours", forecastHours);
  url.searchParams.set("unitsSystem", "METRIC");
  url.searchParams.set("languageCode", "en");
  const data = await google(url);
  const forecasts = data.forecastHours || [];
  const target = requested.getTime();
  const forecast = forecasts.reduce((closest, item) => {
    if (!closest) return item;
    const itemGap = Math.abs(new Date(item.interval.startTime).getTime() - target);
    const closestGap = Math.abs(new Date(closest.interval.startTime).getTime() - target);
    return itemGap < closestGap ? item : closest;
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

function seconds(duration = "") {
  return Number.parseFloat(duration.replace("s", "")) || Infinity;
}

async function buildRecommendations(input) {
  const personA = clean(input.personA);
  const personB = clean(input.personB);
  const query = clean(input.query);
  const travelMode = clean(input.travelMode, 20).toUpperCase();
  const maxMinutes = Math.min(Math.max(Number(input.maxMinutes) || 30, 5), 180);
  const meetingTime = clean(input.meetingTime, 40);

  if (!personA || !personB || !query || !meetingTime) {
    const error = new Error("Locations, request, and meeting time are required.");
    error.status = 400;
    throw error;
  }
  const parsedMeetingTime = new Date(meetingTime);
  const maximumForecastTime = Date.now() + 239 * 60 * 60 * 1000;
  if (
    Number.isNaN(parsedMeetingTime.valueOf()) ||
    parsedMeetingTime.getTime() < Date.now() - 60 * 60 * 1000 ||
    parsedMeetingTime.getTime() > maximumForecastTime
  ) {
    const error = new Error("Choose a meeting time within the next 9 days.");
    error.status = 400;
    throw error;
  }

  const origins = await Promise.all([geocode(personA), geocode(personB)]);
    const center = {
      latitude: (origins[0].location.lat + origins[1].location.lat) / 2,
      longitude: (origins[0].location.lng + origins[1].location.lng) / 2,
    };
    const [places, weather] = await Promise.all([
      searchPlaces(query, center),
      getWeather(center, parsedMeetingTime.toISOString()),
    ]);
    if (!places.length) {
      return { origins, weather, recommendations: [] };
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
        const types = place.types || [];
        const outdoorOriented = types.some((type) =>
          ["park", "garden", "hiking_area", "picnic_ground", "plaza"].includes(type)
        );
        const weatherPenalty = weather?.difficult
          ? outdoorOriented
            ? 18
            : place.dineIn
              ? -4
              : 0
          : 0;
        const score = longest * 2 + difference * 1.5 - rating * 3 + weatherPenalty;
        const weatherReason = weather?.difficult
          ? place.dineIn
            ? " Its dine-in option is a good match for the forecast."
            : outdoorOriented
              ? " It is outdoor-oriented, so check the forecast before choosing it."
              : ""
          : outdoorOriented
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
          openNow: place.regularOpeningHours?.openNow,
          location: place.location,
          journeys: [a, b],
          longest,
          difference,
          score,
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

app.post("/api/recommend", async (request, response) => {
  if (!API_KEY) {
    return response.status(503).json({
      error: "Add GOOGLE_MAPS_SERVER_API_KEY to the .env file first.",
    });
  }
  try {
    response.json(await buildRecommendations(request.body));
  } catch (error) {
    response.status(error.status || 502).json({
      error: error.message || "Google Maps request failed.",
    });
  }
});

app.post("/api/meetings", (request, response) => {
  const organizerName = clean(request.body.organizerName, 50);
  const organizerLocation = clean(request.body.organizerLocation);
  const query = clean(request.body.query);
  const travelMode = clean(request.body.travelMode, 20).toUpperCase();
  const maxMinutes = Math.min(Math.max(Number(request.body.maxMinutes) || 30, 5), 180);
  const meetingTime = clean(request.body.meetingTime, 40);
  if (!organizerName || !organizerLocation || !query || !meetingTime) {
    return response.status(400).json({ error: "Name, location, request, and time are required." });
  }
  const parsedTime = new Date(meetingTime);
  if (Number.isNaN(parsedTime.valueOf()) || parsedTime < new Date()) {
    return response.status(400).json({ error: "Choose a future meeting time." });
  }
  const id = crypto.randomBytes(9).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(Math.max(parsedTime.getTime() + 86400000, now.getTime() + 86400000));
  db.prepare(
    `INSERT INTO meetings
     (id, organizer_name, organizer_location, query, travel_mode, max_minutes,
      meeting_time, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, organizerName, organizerLocation, query, travelMode, maxMinutes,
    parsedTime.toISOString(), now.toISOString(), expiresAt.toISOString()
  );
  response.status(201).json({ id, url: `${request.protocol}://${request.get("host")}/m/${id}` });
});

app.get("/api/meetings/:id", (request, response) => {
  const meeting = db.prepare(
    `SELECT id, organizer_name AS organizerName, guest_name AS guestName,
            query, travel_mode AS travelMode, max_minutes AS maxMinutes,
            meeting_time AS meetingTime, results_json AS resultsJson, expires_at AS expiresAt
     FROM meetings WHERE id = ?`
  ).get(request.params.id);
  if (!meeting || new Date(meeting.expiresAt) < new Date()) {
    return response.status(404).json({ error: "Meeting not found or expired." });
  }
  response.json({
    id: meeting.id,
    organizerName: meeting.organizerName,
    guestName: meeting.guestName,
    query: meeting.query,
    travelMode: meeting.travelMode,
    maxMinutes: meeting.maxMinutes,
    meetingTime: meeting.meetingTime,
    status: meeting.resultsJson ? "ready" : meeting.guestName ? "calculating" : "waiting",
    results: meeting.resultsJson ? JSON.parse(meeting.resultsJson) : null,
  });
});

app.post("/api/meetings/:id/join", async (request, response) => {
  const guestName = clean(request.body.guestName, 50);
  const guestLocation = clean(request.body.guestLocation);
  if (!guestName || !guestLocation) {
    return response.status(400).json({ error: "Your name and location are required." });
  }
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(request.params.id);
  if (!meeting || new Date(meeting.expires_at) < new Date()) {
    return response.status(404).json({ error: "Meeting not found or expired." });
  }
  try {
    const results = await buildRecommendations({
      personA: meeting.organizer_location,
      personB: guestLocation,
      query: meeting.query,
      travelMode: meeting.travel_mode,
      maxMinutes: meeting.max_minutes,
      meetingTime: meeting.meeting_time,
    });
    const sharedResults = { ...results };
    delete sharedResults.origins;
    db.prepare(
      "UPDATE meetings SET guest_name = ?, guest_location = ?, results_json = ? WHERE id = ?"
    ).run(guestName, guestLocation, JSON.stringify(sharedResults), meeting.id);
    response.json({ status: "ready", results: sharedResults });
  } catch (error) {
    response.status(error.status || 502).json({ error: error.message || "Recommendation failed." });
  }
});

app.get("/api/health", (_request, response) =>
  response.json({ ok: true, apiKeyConfigured: Boolean(API_KEY) })
);

app.get("/m/:id", (_request, response) =>
  response.sendFile(path.join(__dirname, "public", "index.html"))
);

app.listen(PORT, () => {
  console.log(`MeetSpot is running at http://localhost:${PORT}`);
});
