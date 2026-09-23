const user = requireLogin();
if (user.role !== "admin") {
  alert("Admin access only.");
  location.href = "dashboard.html";
}

const reportCategories = ["Construction", "Maintenance", "Electrical", "Water Supply / Damage", "Road / Walkway", "Safety Hazard", "Other"];
const noticeCategories = ["General Campus Update", ...reportCategories];
const projectStatuses = ["Planned", "In Progress", "Completed", "Delayed"];
let editingReportId = null;
let editingProjectId = null;
let activeAdminForm = null;
const projectForm = document.getElementById("projectForm");
const announcementForm = document.getElementById("announcementForm");
const projectCampusLocation = document.getElementById("projectCampusLocation");
const projectLatitude = document.getElementById("latitude");
const projectLongitude = document.getElementById("longitude");
const projectLocationStatus = document.getElementById("projectLocationStatus");
const noticeCampusLocation = document.getElementById("noticeCampusLocation");
const noticeLatitude = document.getElementById("noticeLatitude");
const noticeLongitude = document.getElementById("noticeLongitude");
const noticeLocationStatus = document.getElementById("noticeLocationStatus");
const noticeShowOnMap = document.getElementById("noticeShowOnMap");
let campusLocations = [];

function knownLocationForCoordinates(latitude, longitude) {
  if (latitude === "" || longitude === "" || latitude == null || longitude == null) return null;
  return campusLocations.find(location =>
    Math.abs(Number(location.latitude) - Number(latitude)) < 0.000001 &&
    Math.abs(Number(location.longitude) - Number(longitude)) < 0.000001
  ) || null;
}

function campusLocationOptions(selectedId = "") {
  return '<option value="">Choose a known campus location</option>' + campusLocations.map(location =>
    `<option value="${location.id}" ${String(location.id) === String(selectedId) ? "selected" : ""}>${location.name}</option>`
  ).join("");
}

function locationConfirmation(latitude, longitude) {
  if (!BuildSafeLocationPicker.isWithinCampus(latitude, longitude, campusLocations)) {
    return "Existing map point is outside the campus area. Select a new campus point.";
  }
  const knownLocation = knownLocationForCoordinates(latitude, longitude);
  return knownLocation ? `Location set to ${knownLocation.name}` : "Exact campus location selected.";
}

function hasValidCampusPoint(latitude, longitude) {
  return BuildSafeLocationPicker.isWithinCampus(latitude, longitude, campusLocations);
}

function applyCampusLocation(select, latitudeInput, longitudeInput, locationInput, statusElement) {
  const selected = campusLocations.find(location => String(location.id) === select.value);
  if (!selected) return;
  latitudeInput.value = selected.latitude;
  longitudeInput.value = selected.longitude;
  locationInput.value = selected.name;
  statusElement.textContent = `Location set to ${selected.name}`;
}

function openLocationPicker(latitudeInput, longitudeInput, locationInput, select, statusElement) {
  BuildSafeLocationPicker.open({
    locations: campusLocations,
    latitude: latitudeInput.value,
    longitude: longitudeInput.value,
    onConfirm(selection) {
      latitudeInput.value = selection.latitude;
      longitudeInput.value = selection.longitude;
      select.value = "";
      if (!locationInput.value.trim() && selection.nearest) locationInput.value = selection.nearest.name;
      statusElement.textContent = selection.nearest
        ? `Exact map location pinned near ${selection.nearest.name}`
        : "Exact campus location selected.";
    }
  });
}

function setActiveAdminForm(formName) {
  activeAdminForm = formName;
  projectForm.style.display = activeAdminForm === "project" ? "flex" : "none";
  announcementForm.style.display = activeAdminForm === "notice" ? "flex" : "none";
}

document.getElementById("showProjectForm").addEventListener("click", () => {
  document.getElementById("projectMessage").textContent = "";
  setActiveAdminForm("project");
});

document.getElementById("showNoticeForm").addEventListener("click", () => {
  document.getElementById("announcementMessageResult").textContent = "";
  setActiveAdminForm("notice");
});

document.getElementById("cancelProjectForm").addEventListener("click", () => {
  projectForm.reset();
  projectLatitude.value = "";
  projectLongitude.value = "";
  projectLocationStatus.textContent = "No map point selected.";
  document.getElementById("projectMessage").textContent = "";
  setActiveAdminForm(null);
});

document.getElementById("cancelNoticeForm").addEventListener("click", () => {
  announcementForm.reset();
  noticeLatitude.value = "";
  noticeLongitude.value = "";
  noticeLocationStatus.textContent = "No map point selected. This notice will not appear on the map.";
  updateDirectNoticeMapFields();
  document.getElementById("announcementMessageResult").textContent = "";
  setActiveAdminForm(null);
});

projectCampusLocation.addEventListener("change", () => applyCampusLocation(
  projectCampusLocation,
  projectLatitude,
  projectLongitude,
  document.getElementById("location"),
  projectLocationStatus
));

document.getElementById("pickProjectLocation").addEventListener("click", () => openLocationPicker(
  projectLatitude,
  projectLongitude,
  document.getElementById("location"),
  projectCampusLocation,
  projectLocationStatus
));

noticeCampusLocation.addEventListener("change", () => applyCampusLocation(
  noticeCampusLocation,
  noticeLatitude,
  noticeLongitude,
  document.getElementById("noticeLocation"),
  noticeLocationStatus
));

document.getElementById("pickNoticeLocation").addEventListener("click", () => openLocationPicker(
  noticeLatitude,
  noticeLongitude,
  document.getElementById("noticeLocation"),
  noticeCampusLocation,
  noticeLocationStatus
));

function updateDirectNoticeMapFields() {
  document.getElementById("noticeMapFields").hidden = !noticeShowOnMap.checked;
  noticeLocationStatus.textContent = noticeShowOnMap.checked
    ? hasValidCampusPoint(noticeLatitude.value, noticeLongitude.value)
      ? locationConfirmation(noticeLatitude.value, noticeLongitude.value)
      : "Choose a campus location or pick an exact point."
    : "Map visibility disabled for this notice.";
}

noticeShowOnMap.addEventListener("change", updateDirectNoticeMapFields);

projectForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (!hasValidCampusPoint(projectLatitude.value, projectLongitude.value)) {
    const message = document.getElementById("projectMessage");
    message.textContent = "Choose a campus location or pick an exact point on the map.";
    message.className = "error";
    return;
  }
  const data = {
    workType: document.getElementById("workType").value,
    name: document.getElementById("name").value.trim(),
    description: document.getElementById("description").value.trim(),
    location: document.getElementById("location").value.trim(),
    status: document.getElementById("status").value,
    startDate: document.getElementById("startDate").value,
    endDate: document.getElementById("endDate").value,
    affectedArea: document.getElementById("affectedArea").value.trim(),
    latitude: projectLatitude.value,
    longitude: projectLongitude.value
  };
  const response = await fetch("/api/projects", {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)
  });
  const result = await response.json().catch(() => ({}));
  document.getElementById("projectMessage").textContent = response.ok ? "Campus work added." : result.message || "Could not add campus work.";
  if (response.ok) {
    e.target.reset();
    projectLatitude.value = "";
    projectLongitude.value = "";
    projectLocationStatus.textContent = "No map point selected.";
    setActiveAdminForm(null);
    loadAdmin();
  }
});

announcementForm.addEventListener("submit", async e => {
  e.preventDefault();
  if (noticeShowOnMap.checked && !hasValidCampusPoint(noticeLatitude.value, noticeLongitude.value)) {
    document.getElementById("announcementMessageResult").textContent = "Choose a campus location or pick an exact point for this map-visible notice.";
    return;
  }
  const response = await fetch("/api/announcements", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      title: document.getElementById("title").value.trim(),
      category: document.getElementById("noticeCategory").value,
      location: document.getElementById("noticeLocation").value.trim(),
      message: document.getElementById("announcementMessage").value.trim(),
      showOnMap: noticeShowOnMap.checked,
      latitude: noticeLatitude.value,
      longitude: noticeLongitude.value
    })
  });
  const result = await response.json().catch(() => ({}));
  document.getElementById("announcementMessageResult").textContent = response.ok ? "Notice published." : result.message || "Could not publish notice.";
  if (response.ok) {
    e.target.reset();
    noticeLatitude.value = "";
    noticeLongitude.value = "";
    noticeLocationStatus.textContent = "No map point selected. This notice will not appear on the map.";
    updateDirectNoticeMapFields();
    setActiveAdminForm(null);
  }
});

async function loadAdmin() {
  const [pRes, rRes, aRes, lRes] = await Promise.all([
    fetch("/api/projects"),
    fetch("/api/reports"),
    fetch("/api/announcements"),
    fetch("/api/campus-locations")
  ]);
  const projects = await pRes.json(), reports = await rRes.json(), announcements = await aRes.json();
  campusLocations = await lRes.json();
  projectCampusLocation.innerHTML = campusLocationOptions();
  noticeCampusLocation.innerHTML = campusLocationOptions();

  document.getElementById("adminProjects").innerHTML = projects.map(p => `
    <article class="card">
      <span class="badge">${p.status}</span> <span class="badge">${p.workType}</span>
      ${!hasValidCampusPoint(p.latitude, p.longitude) ? '<span class="badge map-warning">Map location required</span>' : ""}<h3>${p.name}</h3>
      <p>${p.location}</p>
      ${p.sourceReportId ? '<small>Managed from Student Reports.</small>' : ""}

      ${p.id != editingProjectId ? `
        <div style="margin-top: 12px;">
          <button class="btn" onclick="editProject(${p.id})">Edit</button>
          <button class="btn danger" onclick="deleteProject(${p.id}, ${p.sourceReportId || "null"})">Delete</button>
        </div>
      ` : `
        <div class="form-card" style="margin-top: 12px;">
          <label for="project-edit-work-type-${p.id}">Work Type</label>
          <select id="project-edit-work-type-${p.id}"><option>Construction</option><option>Maintenance</option></select>
          <label for="project-edit-name-${p.id}">Project name</label>
          <input id="project-edit-name-${p.id}" maxlength="150">
          <label for="project-edit-description-${p.id}">Description</label>
          <textarea id="project-edit-description-${p.id}" rows="4" maxlength="500"></textarea>
          <label for="project-edit-location-${p.id}">Location</label>
          <input id="project-edit-location-${p.id}" maxlength="150">
          <label for="project-edit-status-${p.id}">Status</label>
          <select id="project-edit-status-${p.id}">
            ${projectStatuses.map(status => `<option>${status}</option>`).join("")}
          </select>
          <label for="project-edit-start-date-${p.id}">Start date (optional)</label>
          <input id="project-edit-start-date-${p.id}" type="date">
          <label for="project-edit-end-date-${p.id}">End date (optional)</label>
          <input id="project-edit-end-date-${p.id}" type="date">
          <label for="project-edit-affected-area-${p.id}">Affected area</label>
          <input id="project-edit-affected-area-${p.id}" maxlength="200">
          <label for="project-edit-campus-location-${p.id}">Campus location</label>
          <select id="project-edit-campus-location-${p.id}" onchange="applyKnownProjectLocation(${p.id})">${campusLocationOptions(knownLocationForCoordinates(p.latitude, p.longitude)?.id)}</select>
          <button class="btn secondary" type="button" onclick="pickExactProjectLocation(${p.id})">Pick Exact Point</button>
          <p id="project-edit-location-status-${p.id}" class="location-selection-status">${p.latitude != null && p.longitude != null ? locationConfirmation(p.latitude, p.longitude) : "No map point selected."}</p>
          <input id="project-edit-latitude-${p.id}" type="hidden">
          <input id="project-edit-longitude-${p.id}" type="hidden">
          <p id="project-edit-message-${p.id}" class="error"></p>
          <button class="btn" onclick="saveProject(${p.id})">Save Changes</button>
          <button class="btn secondary" onclick="cancelProjectEdit()">Cancel</button>
        </div>
      `}
    </article>`).join("");

  const editingProject = projects.find(project => project.id == editingProjectId);
  if (editingProject) {
    document.getElementById(`project-edit-name-${editingProject.id}`).value = editingProject.name || "";
    document.getElementById(`project-edit-work-type-${editingProject.id}`).value = editingProject.workType || "Construction";
    document.getElementById(`project-edit-description-${editingProject.id}`).value = editingProject.description || "";
    document.getElementById(`project-edit-location-${editingProject.id}`).value = editingProject.location || "";
    document.getElementById(`project-edit-status-${editingProject.id}`).value = editingProject.status || "Planned";
    document.getElementById(`project-edit-start-date-${editingProject.id}`).value = editingProject.startDate || "";
    document.getElementById(`project-edit-end-date-${editingProject.id}`).value = editingProject.endDate || "";
    document.getElementById(`project-edit-affected-area-${editingProject.id}`).value = editingProject.affectedArea || "";
    document.getElementById(`project-edit-latitude-${editingProject.id}`).value = editingProject.latitude ?? "";
    document.getElementById(`project-edit-longitude-${editingProject.id}`).value = editingProject.longitude ?? "";
  }

  document.getElementById("reports").innerHTML = reports.length ? reports.map(r => `
    <article class="notice report-item">
      <h3>Original submission: ${r.location}</h3>
      <p><b>Original category:</b> ${r.category || "Not recorded"}</p>
      <p>${r.description}</p>
      ${r.photoUrl ? `<a href="${r.photoUrl}" target="_blank" rel="noopener"><img class="report-photo-preview" src="${r.photoUrl}" alt="Photo submitted with this report"></a>` : ""}

      <small>By ${r.name} on ${r.date} — ${r.status}</small>

      ${r.status !== "Pending" && r.id != editingReportId ? `
        <div style="margin-top: 12px;">
          <button class="btn" onclick="editReport(${r.id})">Edit</button>
          <button class="btn danger" onclick="deleteReport(${r.id})">Delete</button>
          ${r.status === "Approved" && r.publishedType === "project" ? `<button class="btn" onclick="markReportComplete(${r.id})">Mark Complete</button>` : ""}
        </div>
      ` : ""}

      ${r.status === "Pending" || r.id == editingReportId ? `
      <div id="report-editor-${r.id}" class="form-card" style="margin-top: 12px;">
        <h3>Publication</h3>
        <label for="report-publication-type-${r.id}">Publish as</label>
        <select id="report-publication-type-${r.id}" onchange="updatePublicationFields(${r.id})">
          <option value="project">Campus Work</option>
          <option value="announcement">Campus Notice</option>
        </select>
        <label for="report-title-${r.id}">Published title</label>
        <input id="report-title-${r.id}" maxlength="150">
        <label for="report-location-${r.id}">Published location</label>
        <input id="report-location-${r.id}" maxlength="150">
        <label id="report-description-label-${r.id}" for="report-description-${r.id}">Published description</label>
        <textarea id="report-description-${r.id}" rows="4" maxlength="500"></textarea>

        <div id="work-fields-${r.id}">
          <label for="report-work-type-${r.id}">Work Type</label>
          <select id="report-work-type-${r.id}"><option>Construction</option><option>Maintenance</option></select>
          <label for="report-work-status-${r.id}">Status</label>
          <select id="report-work-status-${r.id}">${projectStatuses.map(status => `<option>${status}</option>`).join("")}</select>
          <label for="report-affected-area-${r.id}">Affected area</label>
          <input id="report-affected-area-${r.id}" maxlength="200">
          <label for="report-start-date-${r.id}">Start date (optional)</label>
          <input id="report-start-date-${r.id}" type="date">
          <label for="report-end-date-${r.id}">Expected end date (optional)</label>
          <input id="report-end-date-${r.id}" type="date">
        </div>

        <div id="notice-fields-${r.id}">
          <label for="report-notice-category-${r.id}">Notice category</label>
          <select id="report-notice-category-${r.id}">${noticeCategories.map(category => `<option>${category}</option>`).join("")}</select>
          <label class="map-visibility-control"><input id="report-show-on-map-${r.id}" type="checkbox" onchange="updatePublicationFields(${r.id})"> Show on campus map</label>
        </div>

        <div id="report-map-fields-${r.id}">
          <label for="report-campus-location-${r.id}">Campus location</label>
          <select id="report-campus-location-${r.id}" onchange="applyKnownReportLocation(${r.id})">${campusLocationOptions()}</select>
          <button class="btn secondary" type="button" onclick="pickExactReportLocation(${r.id})">Pick Exact Point</button>
          <p id="report-location-status-${r.id}" class="location-selection-status">No map point selected.</p>
        </div>
        <input id="report-latitude-${r.id}" type="hidden">
        <input id="report-longitude-${r.id}" type="hidden">

        <p id="report-edit-message-${r.id}" class="error"></p>

        ${r.status === "Pending" ? `
          <button class="btn"
            onclick="updateReportStatus(${r.id}, 'Approved')">
            Approve &amp; Publish
          </button>

          <button class="btn danger"
            onclick="updateReportStatus(${r.id}, 'Rejected')">
            Reject
          </button>
        ` : ""}
        ${r.status === "Approved" ? `<button class="btn" onclick="updateReportStatus(${r.id}, 'Approved')">Save Published Changes</button>` : ""}
        ${r.status === "Rejected" ? `
          <button class="btn" onclick="updateReportStatus(${r.id}, 'Rejected')">Save Changes</button>
          <button class="btn" onclick="updateReportStatus(${r.id}, 'Approved')">Approve &amp; Publish</button>
        ` : ""}
        ${r.status === "Completed" ? `<button class="btn" onclick="updateReportStatus(${r.id}, 'Completed')">Save Published Changes</button>` : ""}
        ${r.status !== "Pending" ? `<button class="btn secondary" onclick="cancelReportEdit(${r.id})">Cancel</button>` : ""}
      </div>
      ` : ""}
    </article>
  `).join("") : '<div class="empty">No student reports yet.</div>';

  reports.filter(r => r.status === "Pending" || r.id == editingReportId).forEach(r => {
    const publishedItem = projects.find(item => item.sourceReportId == r.id) ||
      announcements.find(item => item.sourceReportId == r.id) ||
      announcements.find(item => item.id == r.publishedNoticeId);

    const defaultType = r.publishedType || (["Construction", "Maintenance"].includes(r.category) ? "project" : "announcement");
    const latitude = r.publishedLatitude ?? publishedItem?.latitude ?? r.latitude ?? "";
    const longitude = r.publishedLongitude ?? publishedItem?.longitude ?? r.longitude ?? "";
    const hasValidOriginalPoint = hasValidCampusPoint(latitude, longitude);
    const showOnMap = r.publishedShowOnMap != null ? Boolean(Number(r.publishedShowOnMap)) :
      publishedItem?.showOnMap != null ? Boolean(Number(publishedItem.showOnMap)) : hasValidOriginalPoint;
    document.getElementById(`report-publication-type-${r.id}`).value = defaultType;
    document.getElementById(`report-title-${r.id}`).value = r.publishedTitle || publishedItem?.name || publishedItem?.title || `Safety Report: ${r.location}`;
    document.getElementById(`report-location-${r.id}`).value = r.publishedLocation || publishedItem?.location || r.location;
    document.getElementById(`report-description-${r.id}`).value = r.publishedDescription || publishedItem?.description || publishedItem?.message || r.description;
    document.getElementById(`report-work-type-${r.id}`).value = r.publishedWorkType || publishedItem?.workType || (r.category === "Maintenance" ? "Maintenance" : "Construction");
    document.getElementById(`report-work-status-${r.id}`).value = r.publishedStatus || publishedItem?.status || "In Progress";
    document.getElementById(`report-notice-category-${r.id}`).value = r.publishedCategory || publishedItem?.category || (noticeCategories.includes(r.category) ? r.category : "Other");
    document.getElementById(`report-affected-area-${r.id}`).value = r.publishedAffectedArea || publishedItem?.affectedArea || "";
    document.getElementById(`report-start-date-${r.id}`).value = r.publishedStartDate || publishedItem?.startDate || "";
    document.getElementById(`report-end-date-${r.id}`).value = r.publishedEndDate || publishedItem?.endDate || "";
    document.getElementById(`report-latitude-${r.id}`).value = latitude;
    document.getElementById(`report-longitude-${r.id}`).value = longitude;
    document.getElementById(`report-show-on-map-${r.id}`).checked = showOnMap;
    document.getElementById(`report-campus-location-${r.id}`).value = knownLocationForCoordinates(latitude, longitude)?.id || "";
    document.getElementById(`report-location-status-${r.id}`).textContent = latitude !== "" && longitude !== ""
      ? locationConfirmation(latitude, longitude) : "No map point selected.";
    updatePublicationFields(r.id);
  });
}

async function editProject(id) {
  editingProjectId = id;
  await loadAdmin();
}

async function cancelProjectEdit() {
  editingProjectId = null;
  await loadAdmin();
}

function applyKnownProjectLocation(id) {
  applyCampusLocation(
    document.getElementById(`project-edit-campus-location-${id}`),
    document.getElementById(`project-edit-latitude-${id}`),
    document.getElementById(`project-edit-longitude-${id}`),
    document.getElementById(`project-edit-location-${id}`),
    document.getElementById(`project-edit-location-status-${id}`)
  );
}

function pickExactProjectLocation(id) {
  openLocationPicker(
    document.getElementById(`project-edit-latitude-${id}`),
    document.getElementById(`project-edit-longitude-${id}`),
    document.getElementById(`project-edit-location-${id}`),
    document.getElementById(`project-edit-campus-location-${id}`),
    document.getElementById(`project-edit-location-status-${id}`)
  );
}

async function saveProject(id) {
  const data = {
    workType: document.getElementById(`project-edit-work-type-${id}`).value,
    name: document.getElementById(`project-edit-name-${id}`).value.trim(),
    description: document.getElementById(`project-edit-description-${id}`).value.trim(),
    location: document.getElementById(`project-edit-location-${id}`).value.trim(),
    status: document.getElementById(`project-edit-status-${id}`).value,
    startDate: document.getElementById(`project-edit-start-date-${id}`).value,
    endDate: document.getElementById(`project-edit-end-date-${id}`).value,
    affectedArea: document.getElementById(`project-edit-affected-area-${id}`).value.trim(),
    latitude: document.getElementById(`project-edit-latitude-${id}`).value,
    longitude: document.getElementById(`project-edit-longitude-${id}`).value
  };
  const message = document.getElementById(`project-edit-message-${id}`);
  const missingFields = [];
  if (!data.name) missingFields.push("project name");
  if (!data.description) missingFields.push("description");
  if (!data.location) missingFields.push("location");
  if (!data.status) missingFields.push("status");
  if (!hasValidCampusPoint(data.latitude, data.longitude)) missingFields.push("valid campus map point");

  if (missingFields.length) {
    message.textContent = `Please complete: ${missingFields.join(", ")}.`;
    return;
  }

  const response = await fetch("/api/projects/" + id, {
    method: "PUT",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const result = await response.json();
    message.textContent = result.message || "Could not update project.";
    return;
  }

  editingProjectId = null;
  await loadAdmin();
}

function updatePublicationFields(id) {
  const isWork = document.getElementById(`report-publication-type-${id}`).value === "project";
  const showOnMap = document.getElementById(`report-show-on-map-${id}`).checked;
  document.getElementById(`work-fields-${id}`).hidden = !isWork;
  document.getElementById(`notice-fields-${id}`).hidden = isWork;
  document.getElementById(`report-map-fields-${id}`).hidden = !isWork && !showOnMap;
  document.getElementById(`report-description-label-${id}`).textContent = isWork ? "Published description" : "Message";
}

function applyKnownReportLocation(id) {
  applyCampusLocation(
    document.getElementById(`report-campus-location-${id}`),
    document.getElementById(`report-latitude-${id}`),
    document.getElementById(`report-longitude-${id}`),
    document.getElementById(`report-location-${id}`),
    document.getElementById(`report-location-status-${id}`)
  );
}

function pickExactReportLocation(id) {
  openLocationPicker(
    document.getElementById(`report-latitude-${id}`),
    document.getElementById(`report-longitude-${id}`),
    document.getElementById(`report-location-${id}`),
    document.getElementById(`report-campus-location-${id}`),
    document.getElementById(`report-location-status-${id}`)
  );
}

async function editReport(id) {
  editingReportId = id;
  await loadAdmin();
}

async function cancelReportEdit() {
  editingReportId = null;
  await loadAdmin();
}

function reportReviewData(id, status) {
  const publishedType = document.getElementById(`report-publication-type-${id}`).value;
  const data = {
    status,
    publishedType,
    publishedTitle: document.getElementById(`report-title-${id}`).value.trim(),
    publishedCategory: document.getElementById(`report-notice-category-${id}`).value,
    publishedWorkType: document.getElementById(`report-work-type-${id}`).value,
    publishedStatus: document.getElementById(`report-work-status-${id}`).value,
    publishedLocation: document.getElementById(`report-location-${id}`).value.trim(),
    publishedDescription: document.getElementById(`report-description-${id}`).value.trim(),
    publishedAffectedArea: document.getElementById(`report-affected-area-${id}`).value.trim(),
    publishedStartDate: document.getElementById(`report-start-date-${id}`).value,
    publishedEndDate: document.getElementById(`report-end-date-${id}`).value,
    publishedLatitude: document.getElementById(`report-latitude-${id}`).value,
    publishedLongitude: document.getElementById(`report-longitude-${id}`).value,
    publishedShowOnMap: document.getElementById(`report-show-on-map-${id}`).checked
  };

  if (publishedType !== "project") {
    data.publishedAffectedArea = "";
    data.publishedStartDate = "";
    data.publishedEndDate = "";
  }

  return data;
}

async function updateReportStatus(id, status) {
  const data = reportReviewData(id, status);
  const editMessage = document.getElementById(`report-edit-message-${id}`);
  editMessage.textContent = "";

  if (status === "Approved" || status === "Completed") {
    const missingFields = [];
    if (data.publishedTitle.length < 3) missingFields.push("title");
    if (data.publishedLocation.length < 3) missingFields.push("location");
    if (data.publishedDescription.length < 10) missingFields.push("message / description");
    if (data.publishedType === "announcement" && !data.publishedCategory) missingFields.push("notice category");
    if ((data.publishedType === "project" || data.publishedShowOnMap) &&
        !hasValidCampusPoint(data.publishedLatitude, data.publishedLongitude)) missingFields.push("valid campus map point");

    if (missingFields.length) {
      editMessage.textContent = `Please complete: ${missingFields.join(", ")}.`;
      return;
    }

    if (data.publishedStartDate && data.publishedEndDate && data.publishedEndDate < data.publishedStartDate) {
      editMessage.textContent = "Expected end date cannot be before the start date.";
      return;
    }
  }

  const response = await fetch("/api/reports/" + id + "/status", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const data = await response.json();
    editMessage.textContent = data.message || "Could not update report.";
    return;
  }

  editingReportId = null;
  await loadAdmin();
}

async function markReportComplete(id) {
  if (!confirm("Mark this report as complete?")) return;

  const response = await fetch("/api/reports/" + id + "/status", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status: "Completed" })
  });

  if (!response.ok) {
    const data = await response.json();
    alert(data.message || "Could not mark report complete.");
    return;
  }

  editingReportId = null;
  await loadAdmin();
}

async function deleteReport(id) {
  if (!confirm("Delete this report and any linked published item?")) return;

  const response = await fetch("/api/reports/" + id, {method:"DELETE"});
  if (!response.ok) {
    const data = await response.json();
    alert(data.message || "Could not delete report.");
    return;
  }

  if (editingReportId == id) editingReportId = null;
  loadAdmin();
}

async function deleteProject(id, sourceReportId) {
  const message = sourceReportId
    ? "This campus work item was created from a student report.\nDeleting it will also remove the linked report. Continue?"
    : "Delete this campus work item?";
  if (!confirm(message)) return;

  const response = await fetch("/api/projects/" + id, {method:"DELETE"});
  if (!response.ok) {
    const data = await response.json();
    alert(data.message || "Could not delete project.");
    return;
  }

  if (editingProjectId == id) editingProjectId = null;
  loadAdmin();
}
setActiveAdminForm(null);
updateDirectNoticeMapFields();
loadAdmin();
