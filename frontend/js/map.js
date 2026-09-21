requireLogin();

const map = L.map("map").setView([-22.9764, 30.4430], 16);
const projectLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

map.setMinZoom(15);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

function markerColor(status) {
  if (status === "Completed") return "green";
  if (status === "Planned") return "gold";
  return "red";
}

function setRouteStatus(message, type = "") {
  const status = document.getElementById("routeStatus");
  status.textContent = message;
  status.className = `route-status ${type}`.trim();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Unable to load routing data.");
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new Error("Routing API returned an invalid response.");
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

async function loadProjectMarkers() {
  const projects = await fetchJson("/api/projects");
  projectLayer.clearLayers();
  projects.forEach(project => {
    if (project.latitude == null || project.longitude == null) return;
    const latitude = Number(project.latitude);
    const longitude = Number(project.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const icon = L.divIcon({
      className: "custom-marker",
      html: `<div style="background:${markerColor(project.status)};width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 1px 5px #000"></div>`,
      iconSize: [18, 18]
    });
    L.marker([latitude, longitude], { icon }).addTo(projectLayer).bindPopup(`
      <b>${project.name}</b><br>
      Status: ${project.status}<br>
      Location: ${project.location}
      ${project.affectedArea ? `<br>Affected: ${project.affectedArea}` : ""}
      ${project.endDate ? `<br>Expected completion: ${project.endDate}` : ""}
    `);
  });
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
    await Promise.all([loadCampusLocations(), loadProjectMarkers()]);
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
