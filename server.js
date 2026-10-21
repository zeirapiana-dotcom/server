const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080

app.use(cors());
app.use(express.json());

let reservations = [];

// GET: view everything at http://localhost:8080/api/reservations
app.get("/api/reservations", (req, res) => {
  res.json(reservations);
});

// POST: add an item
app.post("/api/reservations", (req, res) => {
  const newItem = {
    ...req.body,
    id: req.body.id ?? Date.now(),
  };

  reservations.push(newItem);

  console.log("Added:", newItem);
  console.log("All reservations:", reservations);

  res.status(201).json(newItem);
});

// PUT: save a room from the admin dashboard (adds it if it isn't in the array yet)
app.put("/api/reservations/:id", (req, res) => {
  const id = req.params.id;
  const index = reservations.findIndex((r) => String(r.id) === String(id));

  const room = {
    ...req.body,
    id: isNaN(Number(id)) ? id : Number(id),
  };

  if (index === -1) {
    reservations.push(room);
  } else {
    reservations[index] = { ...reservations[index], ...room };
  }

  console.log("Updated item:", room);
  console.log("All reservations:", reservations);

  res.json(room);
});

// DELETE: remove an item (it disappears from the array and the terminal log)
app.delete("/api/reservations/:id", (req, res) => {
  reservations = reservations.filter((r) => String(r.id) !== String(req.params.id));

  console.log("Deleted id:", req.params.id);
  console.log("All reservations:", reservations);

  res.json({ message: "Deleted" });
});

app.listen(PORT, () => {
  console.log(`Server running at 8080`);
});