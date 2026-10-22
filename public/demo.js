document.getElementById("update").addEventListener("click", () => {
  document.getElementById("output").textContent =
    "Received: " + document.getElementById("name").value;
});
