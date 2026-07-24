# MeetSpot MVP

A working two-person meeting-place recommender using live Google Maps Platform
data. It geocodes two starting points, searches real places, calculates journeys
for both people, filters by maximum journey time, and ranks fair options.

## Run

1. Copy `.env.example` to `.env`.
2. Put the **MeetSpot Backend** key in `.env`.
3. Install and start:

```powershell
npm install
npm start
```

Open <http://localhost:3000>.

Required enabled APIs:

- Places API (New)
- Routes API

The browser key is not needed in this first version because recommendations link
to Google Maps rather than embedding a map.
