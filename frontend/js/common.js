function requireLogin() {
  const user = JSON.parse(localStorage.getItem("user") || "null");
  if (!user) location.href = "login.html";
  return user;
}
function logout() {
  localStorage.removeItem("user");
  location.href = "login.html";
}
document.querySelectorAll("#logout").forEach(btn => btn.addEventListener("click", logout));
