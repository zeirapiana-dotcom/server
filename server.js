const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const PORT = process.env.PORT || 8080;

const app = express();

const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'easeplace_db'
});

async function checkDb() {
    try {
        const conn = await db.getConnection();
        console.log('Database Connected');
        conn.release();
    } catch (err) {
        console.error('Database connection failed:', err.message);
    }
}
checkDb();

app.use(express.json());
app.use(cors());

// ipakita sa terminal ang bawat request
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`, req.body);
    next();
});

// READ: lahat ng rooms (?all=1 para kasama ang deleted, para sa admin)
app.get('/api/rooms', async (req, res) => {
    try {
        const sql = req.query.all === '1'
            ? 'SELECT * FROM rooms'
            : 'SELECT * FROM rooms WHERE deleted = 0';
        const [rooms] = await db.query(sql);
        res.json(rooms);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// READ one
app.get('/api/rooms/:id', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM rooms WHERE room_id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Room not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE
app.post('/api/rooms', async (req, res) => {
    try {
        const { room_name, room_type, price, capacity, status, amenities } = req.body;
        const [result] = await db.query(
            'INSERT INTO rooms (room_name, room_type, price, capacity, status, amenities) VALUES (?, ?, ?, ?, ?, ?)',
            [room_name, room_type, price, capacity, status, amenities]
        );
        res.status(201).json({ message: 'Room added', id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE (kasama ang deleted para sa Restore)
app.put('/api/rooms/:id', async (req, res) => {
    try {
        const { room_name, room_type, price, capacity, status, amenities, deleted } = req.body;
        const [result] = await db.query(
            'UPDATE rooms SET room_name = ?, room_type = ?, price = ?, capacity = ?, status = ?, amenities = ?, deleted = ? WHERE room_id = ?',
            [room_name, room_type, price, capacity, status, amenities, deleted ? 1 : 0, req.params.id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Room not found' });
        }
        res.json({ message: 'Room updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE = soft delete (deleted = 1), para pwedeng i-restore
app.delete('/api/rooms/:id', async (req, res) => {
    try {
        const [result] = await db.query('UPDATE rooms SET deleted = 1 WHERE room_id = ?', [req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Room not found' });
        }
        res.json({ message: 'Room deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});