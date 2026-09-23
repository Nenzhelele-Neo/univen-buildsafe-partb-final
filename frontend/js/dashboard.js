const user = requireLogin();
document.getElementById("welcome").textContent = `Welcome, ${user.name}`;
if (user.role === "admin") document.getElementById("adminLink").hidden = false;

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-ZA", {
    day: "numeric", month: "short", year: "numeric"
  }).format(date);
}

async function loadDashboard() {
  const projectCards = document.getElementById("projectCards");
  const noticeFeed = document.getElementById("notices");

  try {
    const [pRes, aRes, rRes] = await Promise.all([
      fetch("/api/projects"), fetch("/api/announcements"), fetch("/api/reports")
    ]);
    if (![pRes, aRes, rRes].every(response => response.ok)) throw new Error("Dashboard data is currently unavailable.");

    const projects = await pRes.json();
    const announcements = await aRes.json();
    const reports = await rRes.json();

    document.getElementById("totalProjects").textContent = projects.length;
    document.getElementById("activeProjects").textContent = projects.filter(p => p.status === "In Progress").length;
    document.getElementById("plannedProjects").textContent = projects.filter(p => p.status === "Planned").length;
    document.getElementById("reportCount").textContent = reports.filter(report => report.status === "Approved").length;

    projectCards.innerHTML = projects.length ? projects.slice(0, 3).map(p => `
      <article class="work-record">
        <div>
          <div class="record-topline"><span class="status-badge" data-status="${p.status}">${p.status}</span><span class="work-type">${p.workType}</span></div>
          <h3>${p.name}</h3>
          <p>${p.description}</p>
          <dl class="record-meta">
            <div><dt>Location</dt><dd>${p.location}</dd></div>
            ${p.startDate ? `<div><dt>Start</dt><dd>${formatDate(p.startDate)}</dd></div>` : ""}
            ${p.endDate ? `<div><dt>Expected end</dt><dd>${formatDate(p.endDate)}</dd></div>` : ""}
          </dl>
        </div>
        ${p.photoUrl ? `<img class="report-photo-preview" src="${p.photoUrl}" alt="Photo for ${p.name}">` : ""}
      </article>`).join("") : '<p class="empty">No campus work has been published.</p>';

    noticeFeed.innerHTML = announcements.length ? announcements.slice(0, 3).map(a => `
      <article class="notice-item">
        <div class="record-heading"><h3>${a.title}</h3><time datetime="${a.date}">${formatDate(a.date)}</time></div>
        <div class="notice-meta">${a.category ? `<span>${a.category}</span>` : ""}${a.location ? `<span>${a.location}</span>` : ""}</div>
        <p>${a.message}</p>
        ${a.photoUrl ? `<img class="report-photo-preview" src="${a.photoUrl}" alt="Photo for ${a.title}">` : ""}
      </article>
    `).join("") : '<p class="empty">No campus notices have been published.</p>';
  } catch (error) {
    projectCards.innerHTML = `<p class="empty error">${error.message}</p>`;
    noticeFeed.innerHTML = '<p class="empty error">Notices could not be loaded.</p>';
  }
}

loadDashboard();
