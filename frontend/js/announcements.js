requireLogin();

function formatNoticeDate(value) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-ZA", {
    day: "numeric", month: "short", year: "numeric"
  }).format(date);
}

async function loadAnnouncements() {
  const container = document.getElementById("announcements");
  try {
    const response = await fetch("/api/announcements");
    if (!response.ok) throw new Error("Campus notices could not be loaded.");
    const announcements = await response.json();
    container.innerHTML = announcements.length ? announcements.map(a => `
      <article class="notice-item">
        <div class="record-heading"><h3>${a.title}</h3><time datetime="${a.date}">${formatNoticeDate(a.date)}</time></div>
        <div class="notice-meta">${a.category ? `<span>${a.category}</span>` : ""}${a.location ? `<span>${a.location}</span>` : ""}</div>
        <p>${a.message}</p>
        ${a.photoUrl ? `<a href="${a.photoUrl}" target="_blank" rel="noopener" aria-label="Open photo for ${a.title} in a new tab"><img class="report-photo-preview" src="${a.photoUrl}" alt="Photo for ${a.title}"></a>` : ""}
      </article>
    `).join("") : '<p class="empty">No campus notices have been published.</p>';
  } catch (error) {
    container.innerHTML = `<p class="empty error">${error.message}</p>`;
  }
}

loadAnnouncements();
