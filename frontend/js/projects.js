requireLogin();
async function loadProjects() {
  const response = await fetch("/api/projects");
  const projects = await response.json();
  const container = document.getElementById("projects");
  container.innerHTML = projects.map(p => `
    <article class="card">
      <span class="badge">${p.status}</span> <span class="badge">${p.workType}</span>
      ${p.photoUrl ? `<a href="${p.photoUrl}" target="_blank" rel="noopener"><img class="report-photo-preview" src="${p.photoUrl}" alt="Illustration for ${p.name}"></a>` : ""}
      <h3>${p.name}</h3>
      <p>${p.description}</p>
      <p><b>Location:</b> ${p.location}</p>
      ${p.startDate ? `<p><b>Start:</b> ${p.startDate}</p>` : ""}
      ${p.endDate ? `<p><b>Expected end:</b> ${p.endDate}</p>` : ""}
      ${p.affectedArea ? `<p><b>Affected:</b> ${p.affectedArea}</p>` : ""}
    </article>`).join("");
}
loadProjects();
