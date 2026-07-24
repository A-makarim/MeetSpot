const form = document.querySelector("#search-form");
const planner = document.querySelector(".planner");
const hero = document.querySelector(".hero");
const joinPanel = document.querySelector("#join-panel");
const statusBox = document.querySelector("#status");
const results = document.querySelector("#results");
const cards = document.querySelector("#cards");
const summary = document.querySelector("#route-summary");
const weatherBox = document.querySelector("#weather");
const meetingInput = document.querySelector("#meeting-time");

const defaultMeetingTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
defaultMeetingTime.setMinutes(
  Math.ceil(defaultMeetingTime.getMinutes() / 15) * 15,
  0,
  0
);
meetingInput.value = new Date(
  defaultMeetingTime.getTime() - defaultMeetingTime.getTimezoneOffset() * 60000
).toISOString().slice(0, 16);

function escapeHtml(value = "") {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]
  );
}

function setStatus(message, type = "") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

function renderResults(data, participantNames = ["A", "B"]) {
  if (!data.recommendations?.length) {
    setStatus("No places fit the journey limit. Try a broader request or longer time.");
    return;
  }
  statusBox.classList.add("hidden");
  summary.textContent = "Private locations · shared journey comparison";
  weatherBox.innerHTML = data.weather
    ? `
      ${data.weather.icon ? `<img src="${escapeHtml(data.weather.icon)}" alt="" />` : ""}
      <div>
        <strong>${escapeHtml(data.weather.condition)} · ${Math.round(data.weather.temperatureC)}°C · ${data.weather.rainChance}% rain</strong>
        <span>${escapeHtml(data.weather.advice)}</span>
      </div>
    `
    : "<div><strong>Weather unavailable</strong></div>";
  cards.innerHTML = data.recommendations
    .map(
      (place, index) => `
      <article class="card">
        <div class="rank">${index + 1}</div>
        <div>
          <h3>${escapeHtml(place.name)} ${
            place.rating
              ? `<span class="rating">★ ${place.rating} (${place.ratingCount || 0})</span>`
              : ""
          }</h3>
          <p class="address">${escapeHtml(place.address)}</p>
          <div class="journeys">
            <span class="journey"><b>${escapeHtml(participantNames[0])}</b> ${place.journeys[0].minutes} min · ${place.journeys[0].distanceKm} km</span>
            <span class="journey"><b>${escapeHtml(participantNames[1])}</b> ${place.journeys[1].minutes} min · ${place.journeys[1].distanceKm} km</span>
          </div>
          <p class="why">${escapeHtml(place.explanation)}</p>
        </div>
        <a class="maps-link" href="${escapeHtml(place.mapsUrl)}" target="_blank" rel="noopener">View in Maps ↗</a>
      </article>
    `
    )
    .join("");
  results.classList.remove("hidden");
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function useCurrentLocation(targetId, button) {
  if (!navigator.geolocation) {
    setStatus("Location is not supported by this browser.");
    return;
  }
  const original = button.textContent;
  button.textContent = "Finding your location…";
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      document.querySelector(`#${targetId}`).value =
        `${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`;
      button.textContent = "✓ Current location added";
    },
    (error) => {
      button.textContent = original;
      setStatus(
        error.code === 1
          ? "Location permission was denied. Enter an address instead."
          : "Could not get your location. Enter an address instead."
      );
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

document.querySelectorAll("[data-location-target]").forEach((button) => {
  button.addEventListener("click", () =>
    useCurrentLocation(button.dataset.locationTarget, button)
  );
});

function formPayload() {
  return {
    personA: document.querySelector("#person-a").value,
    personB: document.querySelector("#person-b").value,
    query: document.querySelector("#query").value,
    meetingTime: new Date(meetingInput.value).toISOString(),
    travelMode: document.querySelector("#travel-mode").value,
    maxMinutes: document.querySelector("#max-minutes").value,
  };
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  results.classList.add("hidden");
  setStatus("Searching real places and comparing both journeys…", "loading");
  const payload = formPayload();
  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The search failed.");
    renderResults(data);
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector("#create-meeting").addEventListener("click", async () => {
  const payload = formPayload();
  const organizerName = document.querySelector("#organizer-name").value.trim();
  if (!organizerName || !payload.personA || !payload.query || !meetingInput.value) {
    setStatus("Add your name, your location, the request, and meeting time first.");
    return;
  }
  setStatus("Creating your private invitation…", "loading");
  try {
    const response = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizerName,
        organizerLocation: payload.personA,
        query: payload.query,
        meetingTime: payload.meetingTime,
        travelMode: payload.travelMode,
        maxMinutes: payload.maxMinutes,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create the meeting.");
    const invite = document.querySelector("#invite-link");
    invite.innerHTML = `
      <strong>Invite ready.</strong> Send this private link:<br />
      <a href="${escapeHtml(data.url)}">${escapeHtml(data.url)}</a>
      <button id="copy-invite" type="button">Copy link</button>
    `;
    invite.classList.remove("hidden");
    document.querySelector("#copy-invite").addEventListener("click", async () => {
      await navigator.clipboard.writeText(data.url);
      document.querySelector("#copy-invite").textContent = "Copied ✓";
    });
    statusBox.classList.add("hidden");
  } catch (error) {
    setStatus(error.message);
  }
});

async function loadInvitation(meetingId) {
  hero.classList.add("hidden");
  planner.classList.add("hidden");
  joinPanel.classList.remove("hidden");
  setStatus("Loading invitation…", "loading");
  try {
    const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}`);
    const meeting = await response.json();
    if (!response.ok) throw new Error(meeting.error || "Meeting unavailable.");
    document.querySelector("#host-name").textContent = meeting.organizerName;
    document.querySelector("#meeting-description").textContent =
      `${meeting.query} · ${new Date(meeting.meetingTime).toLocaleString()} · maximum ${meeting.maxMinutes} minutes`;
    statusBox.classList.add("hidden");
    if (meeting.results) {
      joinPanel.classList.add("hidden");
      renderResults(meeting.results, [meeting.organizerName, meeting.guestName]);
      return;
    }
    document.querySelector("#join-meeting").addEventListener("click", async () => {
      const guestName = document.querySelector("#guest-name").value.trim();
      const guestLocation = document.querySelector("#guest-location").value.trim();
      if (!guestName || !guestLocation) {
        setStatus("Add your name and location.");
        return;
      }
      setStatus("Finding the fairest meeting spots…", "loading");
      const joinResponse = await fetch(
        `/api/meetings/${encodeURIComponent(meetingId)}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ guestName, guestLocation }),
        }
      );
      const joined = await joinResponse.json();
      if (!joinResponse.ok) {
        setStatus(joined.error || "Could not join the meeting.");
        return;
      }
      joinPanel.classList.add("hidden");
      renderResults(joined.results, [meeting.organizerName, guestName]);
    });
  } catch (error) {
    setStatus(error.message);
  }
}

const invitationMatch = window.location.pathname.match(/^\/m\/([A-Za-z0-9_-]+)$/);
if (invitationMatch) loadInvitation(invitationMatch[1]);
