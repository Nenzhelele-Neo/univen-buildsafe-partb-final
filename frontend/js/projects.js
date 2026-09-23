requireLogin();

function formatProjectDate(value) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-ZA", {
    day: "numeric", month: "short", year: "numeric"
  }).format(date);
}

async function loadProjects() {
  const container = document.getElementById("projects");
  try {
    const response = await fetch("/api/projects");
    if (!response.ok) throw new Error("Campus work could not be loaded.");
    const projects = await response.json();
    container.innerHTML = projects.length ? projects.map(p => `
      <article class="work-record">
        <div>
          <div class="record-topline"><span class="status-badge" data-status="${p.status}">${p.status}</span><span class="work-type">${p.workType}</span></div>
          <h3>${p.name}</h3>
          <p>${p.description}</p>
          <dl class="record-meta">
            <div><dt>Location</dt><dd>${p.location}</dd></div>
            ${p.startDate ? `<div><dt>Start</dt><dd>${formatProjectDate(p.startDate)}</dd></div>` : ""}
            ${p.endDate ? `<div><dt>Expected end</dt><dd>${formatProjectDate(p.endDate)}</dd></div>` : ""}
            ${p.affectedArea ? `<div><dt>Affected area</dt><dd>${p.affectedArea}</dd></div>` : ""}
          </dl>
        </div>
        ${p.photoUrl ? `<a href="${p.photoUrl}" target="_blank" rel="noopener" aria-label="Open photo for ${p.name} in a new tab"><img class="report-photo-preview" src="${p.photoUrl}" alt="Photo for ${p.name}"></a>` : ""}
      </article>`).join("") : '<p class="empty">No campus work has been published.</p>';
  } catch (error) {
    container.innerHTML = `<p class="empty error">${error.message}</p>`;
  }
}

loadProjects();
