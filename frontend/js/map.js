requireLogin();

const map = L.map("map").setView([-22.9764, 30.4430], 16);
const mapItemLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

map.setMinZoom(15);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

function markerIcon(color) {
  return L.divIcon({
    className: "custom-marker",
    html: `<div class="map-marker-dot" style="background-color:${color}"></div>`,
    iconSize: [18, 18]
  });
}

function validCoordinates(item) {
  if (item.latitude == null || item.longitude == null || item.latitude === "" || item.longitude === "") return null;
  const latitude = Number(item.latitude), longitude = Number(item.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : null;
}

function isCampusCoordinate(coordinates, locations) {
  if (!coordinates || !locations.length) return false;
  const latitudes = locations.map(location => Number(location.latitude)).filter(Number.isFinite);
  const longitudes = locations.map(location => Number(location.longitude)).filter(Number.isFinite);
  if (!latitudes.length || !longitudes.length) return false;
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes), maxLng = Math.max(...longitudes);
  const latPadding = (maxLat - minLat || 0.012) * 0.35;
  const lngPadding = (maxLng - minLng || 0.012) * 0.35;
  return coordinates[0] >= minLat - latPadding && coordinates[0] <= maxLat + latPadding &&
    coordinates[1] >= minLng - lngPadding && coordinates[1] <= maxLng + lngPadding;
}

function safePhotoUrl(photoUrl) {
  if (!photoUrl) return null;
  try {
    const url = new URL(photoUrl, window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function addPopupField(popup, label, value) {
  if (value == null || String(value).trim() === "") return;
  const line = document.createElement("p");
  const heading = document.createElement("strong");
  heading.textContent = `${label}: `;
  line.append(heading, document.createTextNode(String(value)));
  popup.appendChild(line);
}

function markerPopup(item, kind) {
  const popup = document.createElement("div");
  popup.className = "map-item-popup";
  const photoUrl = safePhotoUrl(item.photoUrl);
  if (photoUrl) {
    const link = document.createElement("a");
    link.href = photoUrl;
    link.target = "_blank";
    link.rel = "noopener";
    const image = document.createElement("img");
    image.className = "map-popup-photo";
    image.src = photoUrl;
    image.alt = `Photo for ${item.name || item.title || "map item"}`;
    image.addEventListener("error", () => link.remove());
    link.appendChild(image);
    popup.appendChild(link);
  }
  const title = document.createElement("h3");
  title.textContent = item.name || item.title || "Campus update";
  popup.appendChild(title);
  if (kind === "notice") {
    addPopupField(popup, "Category", item.category || item.type || "Campus update");
    addPopupField(popup, "Location", item.location);
    addPopupField(popup, "Message", item.message);
    addPopupField(popup, "Date", item.date);
  } else {
    addPopupField(popup, "Work type", item.workType);
    addPopupField(popup, "Status", item.status);
    addPopupField(popup, "Location", item.location);
    addPopupField(popup, "Description", item.description);
    addPopupField(popup, "Affected area", item.affectedArea);
    addPopupField(popup, "Start date", item.startDate);
    addPopupField(popup, "Expected end date", item.endDate);
  }
  return popup;
}

function setRouteStatus(message, type = "") {
  const status = document.getElementById("routeStatus");
  status.textContent = message;
  status.className = `route-status ${type}`.trim();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Unable to load map data.");
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("Map API returned an invalid response.");
  return response.json();
}

function addLocationOptions(select, locations) {
  select.replaceChildren(new Option("Select location", ""));
  locations.forEach(location => select.add(new Option(location.name, String(location.id))));
}

async function loadCampusLocations() {
  const locations = await fetchJson("/api/campus-locations");
  if (!Array.isArray(locations) || !locations.length) throw new Error("No campus locations are available.");
  addLocationOptions(document.getElementById("fromLoc"), locations);
  addLocationOptions(document.getElementById("toLoc"), locations);
  return locations;
}

let campusLocations = [];
let mapRefreshPromise = null;

function refreshMapData() {
  if (!campusLocations.length) return Promise.resolve();
  if (mapRefreshPromise) return mapRefreshPromise;
  mapRefreshPromise = Promise.all([fetchJson("/api/projects"), fetchJson("/api/announcements")])
    .then(([projects, announcements]) => {
      mapItemLayer.clearLayers();
      projects.forEach(project => {
        if (!["Planned", "In Progress"].includes(project.status) || !["Construction", "Maintenance"].includes(project.workType)) return;
        const coordinates = validCoordinates(project);
        if (!isCampusCoordinate(coordinates, campusLocations)) return;
        const color = project.workType === "Maintenance" ? "#e87518" : "#d92d20";
        L.marker(coordinates, { icon: markerIcon(color) }).addTo(mapItemLayer).bindPopup(markerPopup(project, project.workType));
      });
      announcements.forEach(announcement => {
        if (!Boolean(Number(announcement.showOnMap))) return;
        const coordinates = validCoordinates(announcement);
        if (!isCampusCoordinate(coordinates, campusLocations)) return;
        L.marker(coordinates, { icon: markerIcon("#1473b8") }).addTo(mapItemLayer).bindPopup(markerPopup(announcement, "notice"));
      });
    })
    .finally(() => { mapRefreshPromise = null; });
  return mapRefreshPromise;
}

function clearRoute() {
  routeLayer.clearLayers();
  setRouteStatus("");
}

function drawRoute(result) {
  clearRoute();
  const coordinates = result.pathCoordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    setRouteStatus("The route has no drawable path geometry.", "error");
    return;
  }

  const line = L.polyline(coordinates, {
    className: "safe-route-line",
    color: result.adjusted ? "#1473b8" : "#17854b",
    weight: 6,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(routeLayer);
  L.circleMarker(coordinates[0], { radius: 7, color: "#101828", fillColor: "#fff", fillOpacity: 1, weight: 3 }).addTo(routeLayer);
  L.circleMarker(coordinates[coordinates.length - 1], { radius: 7, color: "#1473b8", fillColor: "#1473b8", fillOpacity: 1, weight: 3 }).addTo(routeLayer);
  map.fitBounds(line.getBounds(), { padding: [45, 45] });
  const message = result.adjusted
    ? `${result.message} ${result.totalDistanceMeters} m, about ${result.totalEstimatedMinutes} min.`
    : `Safe route found - ${result.totalDistanceMeters} m, about ${result.totalEstimatedMinutes} min.`;
  setRouteStatus(message, result.adjusted ? "adjusted" : "success");
}

async function findRoute() {
  const start = document.getElementById("fromLoc").value;
  const destination = document.getElementById("toLoc").value;
  const mode = document.querySelector('input[name="routeMode"]:checked').value;

  if (!start || !destination) {
    setRouteStatus("Please select both From and Destination locations.", "error");
    return;
  }
  if (start === destination) {
    setRouteStatus("From and Destination must be different locations.", "error");
    return;
  }

  setRouteStatus("Finding the safest available route...");
  try {
    const query = new URLSearchParams({ start, destination, mode });
    const result = await fetchJson(`/api/safe-route?${query}`);
    if (!result.found) {
      clearRoute();
      setRouteStatus(result.message || "No safe route is currently available.", "error");
      return;
    }
    drawRoute(result);
  } catch (error) {
    clearRoute();
    setRouteStatus(error.message, "error");
  }
}

document.getElementById("routeForm").addEventListener("submit", event => {
  event.preventDefault();
  findRoute();
});

document.getElementById("clearRouteBtn").addEventListener("click", clearRoute);

const routeForm = document.getElementById("routeForm");
const openRoutePanelButton = document.getElementById("openRoutePanel");

function setRoutePanelOpen(open, focusField = false) {
  routeForm.hidden = !open;
  openRoutePanelButton.hidden = open;
  openRoutePanelButton.setAttribute("aria-expanded", String(open));
  if (open && focusField) document.getElementById("fromLoc").focus();
}

openRoutePanelButton.addEventListener("click", () => setRoutePanelOpen(true, true));
document.getElementById("closeRoutePanel").addEventListener("click", () => setRoutePanelOpen(false));

async function initializeMap() {
  try {
    campusLocations = await loadCampusLocations();
    await refreshMapData();
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    const to = params.get("to");
    const mode = params.get("mode");
    setRoutePanelOpen(params.get("route") === "open" || Boolean(from && to));
    if (from) document.getElementById("fromLoc").value = from;
    if (to) document.getElementById("toLoc").value = to;
    if (["walking", "vehicle"].includes(mode)) {
      document.querySelector(`input[name="routeMode"][value="${mode}"]`).checked = true;
    }
    if (from && to) await findRoute();
  } catch (error) {
    setRouteStatus(error.message, "error");
  }
}

initializeMap();
window.addEventListener("focus", () => refreshMapData().catch(error => console.error("Map refresh failed:", error.message)));
setInterval(() => refreshMapData().catch(error => console.error("Map refresh failed:", error.message)), 30000);
