function handleCredentialResponse(response) {
  const token = response.credential;

  fetch("http://localhost:3000/api/auth/google", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token })
  })
  .then(res => res.json())
  .then(user => {
    console.log("USER:", user);

    // 🔥 LƯU USER
    sessionStorage.setItem("user", JSON.stringify(user));

    // hiển thị success
    document.getElementById("successMessage").style.display = "block";

    // chuyển trang
    setTimeout(() => {
      window.location.href = "index.html";
    }, 1000);
  })
  .catch(err => {
    alert("Lỗi đăng nhập");
    console.error(err);
  });
}