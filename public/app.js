const form = document.querySelector("#search-form");
const statusBox = document.querySelector("#status");
const results = document.querySelector("#results");
const cards = document.querySelector("#cards");
const summary = document.querySelector("#route-summary");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

function setStatus(message, type = "") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  results.classList.add("hidden");
  setStatus("Searching real places and comparing both journeys…", "loading");
  const payload = {
    personA: document.querySelector("#person-a").value,
    personB: document.querySelector("#person-b").value,
    query: document.querySelector("#query").value,
    travelMode: document.querySelector("#travel-mode").value,
    maxMinutes: document.querySelector("#max-minutes").value,
  };

  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The search failed.");
    if (!data.recommendations.length) {
      setStatus(`No places fit the ${payload.maxMinutes}-minute limit. Try a longer journey time or a broader request.`);
      return;
    }

    statusBox.classList.add("hidden");
    summary.textContent = `${data.origins[0].address} ↔ ${data.origins[1].address}`;
    cards.innerHTML = data.recommendations.map((place, index) => `
      <article class="card">
        <div class="rank">${index + 1}</div>
        <div>
          <h3>${escapeHtml(place.name)} ${place.rating ? `<span class="rating">★ ${place.rating} (${place.ratingCount || 0})</span>` : ""}</h3>
          <p class="address">${escapeHtml(place.address)}</p>
          <div class="journeys">
            <span class="journey"><b>A</b> ${place.journeys[0].minutes} min · ${place.journeys[0].distanceKm} km</span>
            <span class="journey"><b>B</b> ${place.journeys[1].minutes} min · ${place.journeys[1].distanceKm} km</span>
          </div>
          <p class="why">${escapeHtml(place.explanation)}</p>
        </div>
        <a class="maps-link" href="${escapeHtml(place.mapsUrl)}" target="_blank" rel="noopener">View in Maps ↗</a>
      </article>
    `).join("");
    results.classList.remove("hidden");
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStatus(error.message);
  }
});
