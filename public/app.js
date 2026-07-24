import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const firebaseApp = initializeApp({
  apiKey: "AIzaSyCKaLW7BHJVj7VUvi1MbrkjmB3rwcuADEQ",
  authDomain: "uk-stud-ai-hack26lhr-5702.firebaseapp.com",
  projectId: "uk-stud-ai-hack26lhr-5702",
  storageBucket: "uk-stud-ai-hack26lhr-5702.firebasestorage.app",
  messagingSenderId: "234754526011",
  appId: "1:234754526011:web:d7ba91c97a7bb78dd7451e",
});
const auth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
const googleProvider = new GoogleAuthProvider();
let currentUser = null;

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
const groupMeetingInput = document.querySelector("#group-meeting-time");
const profilePanel = document.querySelector("#profile-panel");
const authButton = document.querySelector("#auth-button");

const defaultMeetingTime = new Date(Date.now() + 2 * 60 * 60 * 1000);
defaultMeetingTime.setMinutes(
  Math.ceil(defaultMeetingTime.getMinutes() / 15) * 15,
  0,
  0
);
meetingInput.value = new Date(
  defaultMeetingTime.getTime() - defaultMeetingTime.getTimezoneOffset() * 60000
).toISOString().slice(0, 16);
groupMeetingInput.value = meetingInput.value;

const profileFields = [
  "dietary",
  "accessibility",
  "cuisines",
  "activities",
  "budget",
  "atmosphere",
];

function showProfile() {
  showPage("profile");
  profilePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showPage(page) {
  document.querySelectorAll(".page-view").forEach((view) => {
    view.classList.toggle("hidden", view.dataset.page !== page);
  });
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === page);
  });
}

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.tab === "profile" && !currentUser) {
      authButton.click();
      return;
    }
    showPage(button.dataset.tab);
  });
});

function renderTimelineSummary(timeline) {
  const container = document.querySelector("#timeline-places");
  if (!timeline) {
    container.classList.add("hidden");
    return;
  }
  document.querySelector("#timeline-status").textContent =
    `✓ Stored: ${timeline.visitCount} visits and ${timeline.activityCount} activities. Raw JSON was not uploaded.`;
  const places = timeline.topPlaces || [];
  container.innerHTML = places.length
    ? `<strong>Places found in your Timeline</strong><div class="place-chips">${places
        .map((place) => `<span>${escapeHtml(place.value)} <b>×${place.count}</b></span>`)
        .join("")}</div>`
    : "<strong>Timeline stored, but this export did not contain readable place names.</strong>";
  container.classList.remove("hidden");
}

async function loadProfile(user) {
  const snapshot = await getDoc(doc(firestore, "users", user.uid));
  if (!snapshot.exists()) {
    showProfile();
    return;
  }
  const profile = snapshot.data().preferences || {};
  profileFields.forEach((field) => {
    if (profile[field] != null) document.querySelector(`#${field}`).value = profile[field];
  });
  const timeline = snapshot.data().timelineSummary;
  if (timeline) renderTimelineSummary(timeline);
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    authButton.textContent = "Sign in with Google";
    profilePanel.classList.add("hidden");
    return;
  }
  authButton.textContent = `${user.displayName?.split(" ")[0] || "My"} profile`;
  try {
    await loadProfile(user);
  } catch (error) {
    setStatus(`Profile could not load: ${error.message}`);
  }
});

authButton.addEventListener("click", async () => {
  if (currentUser) {
    showProfile();
    return;
  }
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    setStatus(`Google sign-in failed: ${error.message}`);
  }
});

document.querySelector("#close-profile").addEventListener("click", () => {
  showPage("find");
});

document.querySelector("#sign-out").addEventListener("click", async () => {
  await signOut(auth);
});

document.querySelector("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) return;
  const preferences = Object.fromEntries(
    profileFields.map((field) => [field, document.querySelector(`#${field}`).value.trim()])
  );
  try {
    await setDoc(
      doc(firestore, "users", currentUser.uid),
      {
        email: currentUser.email,
        displayName: currentUser.displayName,
        photoURL: currentUser.photoURL,
        preferences,
        profileCompleted: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    setStatus("Your preferences are saved.");
    showPage("find");
  } catch (error) {
    setStatus(`Preferences could not be saved: ${error.message}`);
  }
});

function processTimeline(document) {
  const timelineObjects = Array.isArray(document.timelineObjects)
    ? document.timelineObjects
    : [];
  const semanticSegments = Array.isArray(document.semanticSegments)
    ? document.semanticSegments
    : [];
  const locations = Array.isArray(document.locations) ? document.locations : [];
  const placeNames = new Map();
  const activityTypes = new Map();
  let visitCount = 0;
  let activityCount = 0;

  for (const item of timelineObjects) {
    if (item.placeVisit) {
      visitCount += 1;
      const name =
        item.placeVisit.location?.name || item.placeVisit.location?.address;
      if (name) placeNames.set(name, (placeNames.get(name) || 0) + 1);
    }
    if (item.activitySegment) {
      activityCount += 1;
      const type = item.activitySegment.activityType;
      if (type) activityTypes.set(type, (activityTypes.get(type) || 0) + 1);
    }
  }
  for (const segment of semanticSegments) {
    const visit = segment.visit || segment.placeVisit;
    const activity = segment.activity || segment.activitySegment;
    if (visit) {
      visitCount += 1;
      const name =
        visit.topCandidate?.placeId ||
        visit.topCandidate?.semanticType ||
        visit.location?.name;
      if (name) placeNames.set(name, (placeNames.get(name) || 0) + 1);
    }
    if (activity) {
      activityCount += 1;
      const type = activity.topCandidate?.type || activity.activityType;
      if (type) activityTypes.set(type, (activityTypes.get(type) || 0) + 1);
    }
  }
  const top = (map, limit) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));
  return {
    visitCount,
    activityCount,
    rawLocationRecordCount: locations.length,
    topPlaces: top(placeNames, 12),
    activityTypes: top(activityTypes, 10),
    processedAt: new Date().toISOString(),
    rawFileStored: false,
  };
}

document.querySelector("#timeline-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  const timelineStatus = document.querySelector("#timeline-status");
  if (!file || !currentUser) return;
  if (file.size > 100 * 1024 * 1024) {
    timelineStatus.textContent = "Choose a JSON export smaller than 100 MB.";
    return;
  }
  timelineStatus.textContent = "Processing locally…";
  try {
    const timelineDocument = JSON.parse(await file.text());
    const timelineSummary = processTimeline(timelineDocument);
    if (
      !timelineSummary.visitCount &&
      !timelineSummary.activityCount &&
      !timelineSummary.rawLocationRecordCount
    ) {
      throw new Error("No supported Timeline records were found");
    }
    await setDoc(
      doc(firestore, "users", currentUser.uid),
      { timelineSummary, updatedAt: serverTimestamp() },
      { merge: true }
    );
    timelineStatus.textContent =
      `Done: ${timelineSummary.visitCount} visits and ${timelineSummary.activityCount} activities summarised. Raw JSON was not uploaded.`;
    renderTimelineSummary(timelineSummary);
    event.target.value = "";
  } catch (error) {
    timelineStatus.textContent = `Timeline processing failed: ${error.message}`;
  }
});

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
          <div class="journeys">${place.journeys
            .map(
              (journey, journeyIndex) =>
                `<span class="journey"><b>${escapeHtml(participantNames[journeyIndex] || `Person ${journeyIndex + 1}`)}</b> ${journey.minutes} min · ${journey.distanceKm} km</span>`
            )
            .join("")}</div>
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
  const organizerName = document.querySelector("#organizer-name").value.trim();
  const organizerLocation = document.querySelector("#group-location").value.trim();
  const preference = document.querySelector("#group-preference").value.trim();
  const meetingTime = groupMeetingInput.value
    ? new Date(groupMeetingInput.value).toISOString()
    : "";
  const travelMode = document.querySelector("#group-travel-mode").value;
  const maxMinutes = Number(document.querySelector("#group-max-minutes").value);
  const expectedParticipants = Number(document.querySelector("#group-size").value);
  if (!organizerName || !organizerLocation || !preference || !meetingTime) {
    setStatus("Add your name, your location, the request, and meeting time first.");
    return;
  }
  if (!currentUser) {
    setStatus("Sign in with Google first so the group room can be saved.");
    currentUser = (await signInWithPopup(auth, googleProvider)).user;
  }
  setStatus("Creating your group room…", "loading");
  try {
    const room = await addDoc(collection(firestore, "meetings"), {
      organizerUid: currentUser.uid,
      organizerName,
      meetingTime,
      travelMode,
      maxMinutes,
      expectedParticipants,
      participants: [{
        uid: currentUser.uid,
        name: organizerName,
        location: organizerLocation,
        preference,
      }],
      createdAt: serverTimestamp(),
    });
    const url = `${window.location.origin}/?room=${encodeURIComponent(room.id)}`;
    const invite = document.querySelector("#invite-link");
    invite.innerHTML = `
      <strong>Group room ready.</strong> Send the same link to everyone:<br />
      <a href="${escapeHtml(url)}">${escapeHtml(url)}</a>
      <div class="invite-actions">
        <button id="copy-invite" type="button">Copy link</button>
        <a class="open-room" href="${escapeHtml(url)}">Open room</a>
      </div>
    `;
    invite.classList.remove("hidden");
    document.querySelector("#copy-invite").addEventListener("click", async () => {
      await navigator.clipboard.writeText(url);
      document.querySelector("#copy-invite").textContent = "Copied ✓";
    });
    statusBox.classList.add("hidden");
  } catch (error) {
    setStatus(
      error.code === "permission-denied"
        ? "Group rooms need the updated Firestore meeting rules. Open Firebase → Firestore → Rules and publish the rules provided below."
        : error.message
    );
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

async function loadGroupRoom(roomId) {
  hero.classList.add("hidden");
  planner.classList.add("hidden");
  document.querySelector(".page-tabs").classList.add("hidden");
  joinPanel.classList.remove("hidden");
  setStatus("Loading group room…", "loading");

  const roomRef = doc(firestore, "meetings", roomId);
  let latestRoom = null;
  const openRoom = () => {
    onSnapshot(
      roomRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setStatus("This meeting room does not exist.");
          return;
        }
        latestRoom = snapshot.data();
        const participants = latestRoom.participants || [];
        const expected = Number(latestRoom.expectedParticipants) || 2;
        const alreadyJoined = participants.some((person) => person.uid === currentUser?.uid);
        joinPanel.querySelectorAll(":scope > label").forEach((label) => {
          label.classList.toggle("hidden", alreadyJoined);
        });
        document.querySelector("#join-meeting").classList.toggle("hidden", alreadyJoined);
        document.querySelector("#host-name").textContent = latestRoom.organizerName;
        document.querySelector("#meeting-description").textContent =
          `${participants.length} of ${expected} joined · ${new Date(latestRoom.meetingTime).toLocaleString()} · maximum ${latestRoom.maxMinutes} minutes`;
        document.querySelector("#room-members").innerHTML = `
          <strong>${participants.length >= expected ? "Everyone is here" : `Waiting for ${expected - participants.length} more`}</strong>
          ${participants.map((person) => `<p><b>${escapeHtml(person.name)}</b> — ${escapeHtml(person.preference)}</p>`).join("")}
        `;
        statusBox.classList.add("hidden");
        if (latestRoom.results) {
          renderResults(latestRoom.results, participants.map((person) => person.name));
        }
      },
      (error) => setStatus(`Room could not load: ${error.message}`)
    );
  };

  if (currentUser) openRoom();
  else {
    setStatus("Sign in with Google to join this private group room.");
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) return;
      unsubscribe();
      openRoom();
    });
  }

  document.querySelector("#join-meeting").addEventListener("click", async () => {
    if (!currentUser) {
      await signInWithPopup(auth, googleProvider);
      return;
    }
    const guestName = document.querySelector("#guest-name").value.trim();
    const guestLocation = document.querySelector("#guest-location").value.trim();
    const guestPreference = document.querySelector("#guest-preference").value.trim();
    if (!guestName || !guestLocation || !guestPreference) {
      setStatus("Add your name, location, and what you would like to do.");
      return;
    }
    setStatus("Adding your vote and comparing the whole group…", "loading");
    try {
      const participant = {
        uid: currentUser.uid,
        name: guestName,
        location: guestLocation,
        preference: guestPreference,
      };
      const existingParticipants = latestRoom?.participants || [];
      if (existingParticipants.some((person) => person.uid === currentUser.uid)) {
        throw new Error("You have already joined this room.");
      }
      const expected = Number(latestRoom?.expectedParticipants) || 2;
      if (existingParticipants.length >= expected) {
        throw new Error("This room already has everyone it was created for.");
      }
      await updateDoc(roomRef, { participants: arrayUnion(participant) });
      const participants = [...existingParticipants, participant];
      if (participants.length < expected) {
        setStatus(`You joined. Waiting for ${expected - participants.length} more participant${expected - participants.length === 1 ? "" : "s"}…`);
        return;
      }
      const combinedPreference = [...new Set(participants.map((person) => person.preference))]
        .join(" or ");
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participants,
          query: combinedPreference,
          meetingTime: latestRoom.meetingTime,
          travelMode: latestRoom.travelMode,
          maxMinutes: latestRoom.maxMinutes,
        }),
      });
      const resultsData = await response.json();
      if (!response.ok) throw new Error(resultsData.error || "Recommendation failed");
      await updateDoc(roomRef, { results: resultsData, selectedQuery: combinedPreference });
      renderResults(resultsData, participants.map((person) => person.name));
    } catch (error) {
      setStatus(error.message);
    }
  });
}

const invitationMatch = window.location.pathname.match(/^\/m\/([A-Za-z0-9_-]+)$/);
if (invitationMatch) loadInvitation(invitationMatch[1]);
const roomMatch = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]+)$/);
const roomQuery = new URLSearchParams(window.location.search).get("room");
if (roomMatch) loadGroupRoom(roomMatch[1]);
else if (roomQuery && /^[A-Za-z0-9_-]+$/.test(roomQuery)) loadGroupRoom(roomQuery);
