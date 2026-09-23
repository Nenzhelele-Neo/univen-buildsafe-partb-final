const REPORT_CATEGORIES = ["Construction", "Electrical", "Water Supply / Damage", "Road / Walkway", "Safety Hazard", "Other"];
const PROJECT_STATUSES = ["Planned", "In Progress", "Completed", "Delayed"];

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

function project(body) {
  const result = {
    name: text(body.name, 255), description: text(body.description),
    location: text(body.location, 255), status: text(body.status, 20),
    affectedArea: text(body.affectedArea, 255),
    ...dates(body.startDate, body.endDate), ...coordinates(body)
  };
  if (!result.name || !result.description || !result.location || !PROJECT_STATUSES.includes(result.status)) {
    fail(400, "Project name, description, location, and status are required.");
  }
  return result;
}

function publication(body) {
  if (!["Approved", "Rejected", "Completed"].includes(body.status)) fail(400, "Invalid report status.");
  const { startDate, endDate } = dates(body.publishedStartDate, body.publishedEndDate);
  const result = {
    status: body.status,
    publishedTitle: text(body.publishedTitle, 255),
    publishedCategory: text(body.publishedCategory, 64),
    publishedLocation: text(body.publishedLocation, 255),
    publishedDescription: text(body.publishedDescription),
    publishedAffectedArea: text(body.publishedAffectedArea, 255),
    publishedStartDate: startDate, publishedEndDate: endDate
  };
  if (body.status !== "Rejected" && (result.publishedTitle.length < 3 ||
      !REPORT_CATEGORIES.includes(result.publishedCategory) || result.publishedLocation.length < 3 || result.publishedDescription.length < 10)) {
    fail(400, "Complete the publishable title, category, location, and message.");
  }
  if (result.publishedCategory !== "Construction") {
    result.publishedAffectedArea = "";
    result.publishedStartDate = result.publishedEndDate = null;
  }
  return result;
}

module.exports = { REPORT_CATEGORIES, PROJECT_STATUSES, fail, id, text, date, dates, coordinates, project, publication };
