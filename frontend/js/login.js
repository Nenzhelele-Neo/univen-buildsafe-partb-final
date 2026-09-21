document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const error = document.getElementById("error");
  error.textContent = "";
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        email: document.getElementById("email").value,
        password: document.getElementById("password").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    localStorage.setItem("user", JSON.stringify(data));
    location.href = "dashboard.html";
  } catch (err) {
    error.textContent = err.message;
  }
});
