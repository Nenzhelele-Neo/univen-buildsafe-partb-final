const user = requireLogin();
document.getElementById("welcome").textContent = `Welcome, ${user.name}`;
if (user.role === "admin") document.getElementById("adminLink").hidden = false;

async function loadDashboard() {
  const [pRes, aRes, rRes] = await Promise.all([
    fetch("/api/projects"), fetch("/api/announcements"), fetch("/api/reports")
  ]);
  const projects = await pRes.json();
  const announcements = await aRes.json();
  const reports = await rRes.json();

  document.getElementById("totalProjects").textContent = projects.length;
  document.getElementById("activeProjects").textContent = projects.filter(p => p.status === "In Progress").length;
  document.getElementById("plannedProjects").textContent = projects.filter(p => p.status === "Planned").length;
  document.getElementById("reportCount").textContent = reports.filter(report => report.status === "Approved").length;

  document.getElementById("projectCards").innerHTML = projects.slice(0,3).map(p => `
    <article class="card">
      <span class="badge">${p.status}</span> <span class="badge">${p.workType}</span>
      <h3>${p.name}</h3><p>${p.description}</p>
      <small>📍 ${p.location}</small>
    </article>`).join("");

  document.getElementById("notices").innerHTML = announcements.slice(0,3).map(a => `
    <article class="notice"><h3>${a.title}</h3>${a.category ? `<p><b>Category:</b> ${a.category}</p>` : ""}${a.location ? `<p><b>Location:</b> ${a.location}</p>` : ""}<p>${a.message}</p><small>${a.date}</small></article>
  `).join("");
}
loadDashboard();
