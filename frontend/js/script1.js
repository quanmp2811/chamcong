function handleCredentialResponse(response) {
  console.log("FULL RESPONSE:", response);

  if (!response || !response.credential) {
    alert("Google login chưa hoàn tất hoặc bị huỷ");
    return;
  }

  const token = response.credential;
  console.log("TOKEN:", token);

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

    sessionStorage.setItem("token", data.token);
    sessionStorage.setItem("user", JSON.stringify(data.user));

    window.location.href = "/";
  })
  .catch(err => {
    console.error("Login error:", err);
    alert(err.message);
  });
}
