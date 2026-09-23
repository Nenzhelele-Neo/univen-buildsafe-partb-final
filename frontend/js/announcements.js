requireLogin();
async function loadAnnouncements() {
  const response = await fetch("/api/announcements");
  const announcements = await response.json();
  document.getElementById("announcements").innerHTML = announcements.map(a => `
    <article class="notice">${a.photoUrl ? `<a href="${a.photoUrl}" target="_blank" rel="noopener"><img class="report-photo-preview" src="${a.photoUrl}" alt="Illustration for ${a.title}"></a>` : ""}<h3>${a.title}</h3>${a.category ? `<p><b>Category:</b> ${a.category}</p>` : ""}${a.location ? `<p><b>Location:</b> ${a.location}</p>` : ""}<p>${a.message}</p><small>Published: ${a.date}</small></article>
  `).join("");
}
loadAnnouncements();
