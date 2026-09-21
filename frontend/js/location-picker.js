(function () {
  const CAMPUS_CENTER = [-22.9764, 30.4430];
  const CAMPUS_BOUNDS_PADDING = 0.35;
  const NEARBY_LOCATION_METERS = 350;
  let map;
  let marker;
  let pendingLocation;
  let confirmSelection;
  let campusLocations = [];

  const overlay = document.createElement("div");
  overlay.className = "location-picker-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="location-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="locationPickerTitle">
      <div class="location-picker-heading">
        <div><p class="tag">CAMPUS MAP</p><h2 id="locationPickerTitle">Pick Exact Point</h2></div>
        <button id="locationPickerClose" class="route-panel-close" type="button">Close</button>
      </div>
      <p class="location-picker-help">Click the map to place or move the location marker.</p>
      <div id="locationPickerMap" class="location-picker-map"></div>
      <p id="locationPickerStatus" class="location-selection-status" aria-live="polite">Select a point on the map.</p>
      <div class="route-actions">
        <button id="usePickedLocation" class="btn" type="button" disabled>Use This Location</button>
        <button id="cancelPickedLocation" class="btn secondary" type="button">Cancel</button>
      </div>
    </section>`;
  document.body.appendChild(overlay);

  const status = overlay.querySelector("#locationPickerStatus");
  const useButton = overlay.querySelector("#usePickedLocation");

  function campusBounds(locations) {
    const coordinates = locations
      .map(location => [Number(location.latitude), Number(location.longitude)])
      .filter(coordinate => coordinate.every(Number.isFinite));
    const bounds = coordinates.length
      ? L.latLngBounds(coordinates)
      : L.latLngBounds([CAMPUS_CENTER[0] - 0.006, CAMPUS_CENTER[1] - 0.006], [CAMPUS_CENTER[0] + 0.006, CAMPUS_CENTER[1] + 0.006]);
    return bounds.pad(CAMPUS_BOUNDS_PADDING);
  }

  function nearestCampusLocation(latitude, longitude) {
    if (!campusLocations.length) return null;
    const nearest = campusLocations.reduce((currentNearest, location) => {
      const latDistance = (Number(location.latitude) - latitude) * 111320;
      const lngDistance = (Number(location.longitude) - longitude) * 111320 * Math.cos(latitude * Math.PI / 180);
      const distance = Math.hypot(latDistance, lngDistance);
      return !currentNearest || distance < currentNearest.distance ? { ...location, distance } : currentNearest;
    }, null);
    return nearest && nearest.distance <= NEARBY_LOCATION_METERS ? nearest : null;
  }

  function updateMarker(latitude, longitude) {
    pendingLocation = { latitude, longitude };
    if (marker) marker.setLatLng([latitude, longitude]);
    else marker = L.marker([latitude, longitude]).addTo(map);
    const nearest = nearestCampusLocation(latitude, longitude);
    pendingLocation.nearest = nearest;
    status.textContent = nearest ? `Location pinned near ${nearest.name}` : "Exact campus location selected.";
    useButton.disabled = false;
  }

  function ensureMap() {
    if (map) return;
    map = L.map("locationPickerMap", { minZoom: 15, maxBoundsViscosity: 1 }).setView(CAMPUS_CENTER, 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);
    map.on("click", event => updateMarker(event.latlng.lat, event.latlng.lng));
  }

  function close() {
    overlay.hidden = true;
    pendingLocation = null;
    confirmSelection = null;
  }

  overlay.querySelector("#locationPickerClose").addEventListener("click", close);
  overlay.querySelector("#cancelPickedLocation").addEventListener("click", close);
  useButton.addEventListener("click", () => {
    if (!pendingLocation || !confirmSelection) return;
    confirmSelection(pendingLocation);
    close();
  });

  window.BuildSafeLocationPicker = {
    open(options) {
      campusLocations = Array.isArray(options.locations) ? options.locations : [];
      confirmSelection = options.onConfirm;
      overlay.hidden = false;
      ensureMap();
      const bounds = campusBounds(campusLocations);
      map.setMaxBounds(bounds);
      if (marker) {
        map.removeLayer(marker);
        marker = null;
      }
      pendingLocation = null;
      useButton.disabled = true;
      status.textContent = "Select a point on the map.";

      const latitude = Number(options.latitude);
      const longitude = Number(options.longitude);
      const hasExistingLocation = options.latitude !== "" && options.latitude != null &&
        options.longitude !== "" && options.longitude != null &&
        Number.isFinite(latitude) && Number.isFinite(longitude);
      const existingLocationIsOnCampus = hasExistingLocation && bounds.contains([latitude, longitude]);
      const center = existingLocationIsOnCampus ? [latitude, longitude] : CAMPUS_CENTER;
      map.setView(center, existingLocationIsOnCampus ? 18 : 16);
      if (existingLocationIsOnCampus) updateMarker(latitude, longitude);
      else if (hasExistingLocation) status.textContent = "Existing map point is outside the campus area. Select a new campus point.";
      setTimeout(() => map.invalidateSize(), 0);
    },

    isWithinCampus(latitude, longitude, locations) {
      const lat = Number(latitude);
      const lng = Number(longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) && campusBounds(Array.isArray(locations) ? locations : []).contains([lat, lng]);
    }
  };
})();
