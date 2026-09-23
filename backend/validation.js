const REPORT_CATEGORIES = ["Construction", "Maintenance", "Electrical", "Water Supply / Damage", "Road / Walkway", "Safety Hazard", "Other"];
const NOTICE_CATEGORIES = ["General Campus Update", ...REPORT_CATEGORIES];
const PROJECT_STATUSES = ["Planned", "In Progress", "Completed", "Delayed"];
const WORK_TYPES = ["Construction", "Maintenance"];

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function id(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(400, "Invalid record ID.");
  return number;
}

function text(value, maximum = 65535) {
  const result = String(value ?? "").trim();
  if (result.length > maximum) fail(400, `Text must be ${maximum} characters or fewer.`);
  return result;
}

function date(value) {
  if (value === "" || value == null) return null;
  const result = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result < "1000-01-01" ||
      !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) {
    fail(400, "Dates must be valid calendar dates in YYYY-MM-DD format.");
  }
  return result;
}

function dates(start, end) {
  const startDate = date(start), endDate = date(end);
  if (startDate && endDate && endDate < startDate) fail(400, "Expected end date cannot be before the start date.");
  return { startDate, endDate };
}

function coordinates(body) {
  const latitude = body.latitude === "" || body.latitude == null ? null : Number(body.latitude);
  const longitude = body.longitude === "" || body.longitude == null ? null : Number(body.longitude);
  if ((latitude === null) !== (longitude === null) || (latitude !== null &&
      (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180))) {
    fail(400, "The selected map location is invalid. Please choose it again.");
  }
  return { latitude, longitude };
}

function boolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if ([true, 1, "1", "true", "on"].includes(value)) return true;
  if ([false, 0, "0", "false", "off"].includes(value)) return false;
  fail(400, "Invalid map visibility setting.");
}

function isCampusPoint(latitude, longitude, locations) {
  const lat = Number(latitude), lng = Number(longitude);
  const points = Array.isArray(locations) ? locations.map(location => [Number(location.latitude), Number(location.longitude)])
    .filter(point => point.every(Number.isFinite)) : [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !points.length) return false;
  const latitudes = points.map(point => point[0]), longitudes = points.map(point => point[1]);
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes), maxLng = Math.max(...longitudes);
  const latPadding = (maxLat - minLat || 0.012) * 0.35;
  const lngPadding = (maxLng - minLng || 0.012) * 0.35;
  return lat >= minLat - latPadding && lat <= maxLat + latPadding &&
    lng >= minLng - lngPadding && lng <= maxLng + lngPadding;
}

function project(body) {
  const result = {
    name: text(body.name, 255), description: text(body.description),
    location: text(body.location, 255), status: text(body.status, 20),
    workType: text(body.workType, 20) || "Construction",
    affectedArea: text(body.affectedArea, 255),
    ...dates(body.startDate, body.endDate), ...coordinates(body)
  };
  if (!result.name || !result.description || !result.location || !PROJECT_STATUSES.includes(result.status) ||
      !WORK_TYPES.includes(result.workType)) {
    fail(400, "Campus work name, description, location, work type, and status are required.");
  }
  return result;
}

function announcement(body) {
  const result = {
    title: text(body.title, 255),
    category: text(body.category, 64) || null,
    location: text(body.location, 255) || null,
    message: text(body.message),
    photoUrl: text(body.photoUrl, 512) || null,
    ...coordinates(body)
  };
  result.showOnMap = boolean(body.showOnMap, result.latitude !== null);
  if (!result.title || !result.message) fail(400, "Announcement title and message are required.");
  if (result.showOnMap && result.latitude === null) fail(400, "Choose a campus map point for this notice.");
  return result;
}

function publication(body, original = {}) {
  if (!["Approved", "Rejected", "Completed"].includes(body.status)) fail(400, "Invalid report status.");
  const { startDate, endDate } = dates(body.publishedStartDate, body.publishedEndDate);
  const publishedType = text(body.publishedType, 20) || (body.publishedCategory === "Construction" ? "project" : "announcement");
  const coordinateInput = {
    latitude: Object.hasOwn(body, "publishedLatitude") ? body.publishedLatitude : original.latitude,
    longitude: Object.hasOwn(body, "publishedLongitude") ? body.publishedLongitude : original.longitude
  };
  const publishedCoordinates = coordinates(coordinateInput);
  const result = {
    status: body.status,
    publishedType,
    publishedTitle: text(body.publishedTitle, 255),
    publishedCategory: text(body.publishedCategory, 64) || null,
    publishedWorkType: text(body.publishedWorkType, 20) || "Construction",
    publishedStatus: text(body.publishedStatus, 20) || (body.status === "Completed" ? "Completed" : "In Progress"),
    publishedLocation: text(body.publishedLocation, 255),
    publishedDescription: text(body.publishedDescription),
    publishedAffectedArea: text(body.publishedAffectedArea, 255),
    publishedStartDate: startDate, publishedEndDate: endDate,
    publishedLatitude: publishedCoordinates.latitude,
    publishedLongitude: publishedCoordinates.longitude,
    publishedShowOnMap: boolean(body.publishedShowOnMap, publishedCoordinates.latitude !== null)
  };
  if (body.status === "Rejected") return result;
  if (!["project", "announcement"].includes(result.publishedType) || result.publishedTitle.length < 3 ||
      result.publishedLocation.length < 3 || result.publishedDescription.length < 10) {
    fail(400, "Complete the publication type, title, location, and description.");
  }
  if (result.publishedType === "project") {
    if (!WORK_TYPES.includes(result.publishedWorkType) || !PROJECT_STATUSES.includes(result.publishedStatus) ||
        result.publishedLatitude === null) fail(400, "Campus work requires a work type, status, and campus map point.");
    result.publishedCategory = null;
    result.publishedShowOnMap = null;
  } else {
    if (!NOTICE_CATEGORIES.includes(result.publishedCategory)) fail(400, "Choose a valid notice category.");
    if (result.publishedShowOnMap && result.publishedLatitude === null) fail(400, "Choose a campus map point for this notice.");
    result.publishedWorkType = result.publishedStatus = null;
    result.publishedAffectedArea = "";
    result.publishedStartDate = result.publishedEndDate = null;
  }
  return result;
}

module.exports = { REPORT_CATEGORIES, NOTICE_CATEGORIES, PROJECT_STATUSES, WORK_TYPES, fail, id, text, date, dates, coordinates, boolean, isCampusPoint, project, announcement, publication };
