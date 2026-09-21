const reportForm = document.getElementById("reportForm");
const reportMessage = document.getElementById("message");
const campusLocationSelect = document.getElementById("reportCampusLocation");
const latitudeInput = document.getElementById("latitude");
const longitudeInput = document.getElementById("longitude");
const locationStatus = document.getElementById("reportLocationStatus");
let campusLocations = [];

function campusLocationOptions(locations) {
  campusLocationSelect.innerHTML = '<option value="">Choose a known campus location</option>' +
    locations.map(location => `<option value="${location.id}">${location.name}</option>`).join("");
}

fetch("/api/campus-locations")
  .then(response => response.json())
  .then(locations => {
    campusLocations = locations;
    campusLocationOptions(locations);
  })
  .catch(() => {
    locationStatus.textContent = "Known locations are unavailable, but you can still pick an exact point.";
  });

campusLocationSelect.addEventListener("change", () => {
  const selected = campusLocations.find(location => String(location.id) === campusLocationSelect.value);
  if (!selected) return;
  document.getElementById("location").value = selected.name;
  latitudeInput.value = selected.latitude;
  longitudeInput.value = selected.longitude;
  locationStatus.textContent = `Location set to ${selected.name}`;
});

document.getElementById("pickReportLocation").addEventListener("click", () => {
  BuildSafeLocationPicker.open({
    locations: campusLocations,
    latitude: latitudeInput.value,
    longitude: longitudeInput.value,
    onConfirm(selection) {
      latitudeInput.value = selection.latitude;
      longitudeInput.value = selection.longitude;
      campusLocationSelect.value = "";
      const nearestName = selection.nearest?.name;
      if (!document.getElementById("location").value.trim() && nearestName) {
        document.getElementById("location").value = nearestName;
      }
      locationStatus.textContent = nearestName
        ? `Exact map location pinned near ${nearestName}`
        : "Exact campus location selected.";
    }
  });
});

reportForm.addEventListener("submit", async event => {
  event.preventDefault();
  const category = document.getElementById("category").value;
  const name = document.getElementById("name").value.trim();
  const location = document.getElementById("location").value.trim();
  const description = document.getElementById("description").value.trim();
  const photo = document.getElementById("photo").files[0];

  if (!category || name.length < 2 || location.length < 3 || description.length < 20) {
    reportMessage.textContent = "Please complete all fields and provide a detailed description.";
    reportMessage.className = "error";
    return;
  }

  if (photo && (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || photo.size > 5 * 1024 * 1024)) {
    reportMessage.textContent = "Choose a JPEG, PNG, or WebP image no larger than 5 MB.";
    reportMessage.className = "error";
    return;
  }

  const formData = new FormData();
  formData.append("category", category);
  formData.append("name", name);
  formData.append("location", location);
  formData.append("description", description);
  if (latitudeInput.value && longitudeInput.value) {
    formData.append("latitude", latitudeInput.value);
    formData.append("longitude", longitudeInput.value);
  }
  if (photo) formData.append("photo", photo);

  try {
    const response = await fetch("/api/reports", { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "Could not submit report.");

    reportMessage.textContent = "Report submitted successfully and is awaiting admin review.";
    reportMessage.className = "success";
    reportForm.reset();
    latitudeInput.value = "";
    longitudeInput.value = "";
    locationStatus.textContent = "Adding a map point is optional.";
  } catch (error) {
    reportMessage.textContent = error.message;
    reportMessage.className = "error";
  }
});
