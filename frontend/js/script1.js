function handleCredentialResponse(response) {
  console.log("Google response:", response);
  console.log("TOKEN:", token);
  const token = response.credential;

  if (!token) {
    alert("Không nhận được token từ Google");
    return;
  }

  fetch("/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token })
  })
  .then(async (res) => {
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || "Login failed");
    }

    return data;
  })
  .then(data => {
    console.log("LOGIN OK:", data);

    // lưu token + user
    sessionStorage.setItem("token", data.token);
    sessionStorage.setItem("user", JSON.stringify(data.user));

    document.getElementById("successMessage").style.display = "block";

    setTimeout(() => {
      window.location.href = "/";
    }, 800);
  })
  .catch(err => {
    console.error("Login error:", err);
    alert(err.message);
  });
}
