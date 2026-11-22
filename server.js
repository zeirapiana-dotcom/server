const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const PORT = process.env.PORT || 8080;

const app = express();

// ===================== DATABASE =====================
// Production (Render): ilagay ang DATABASE_URL (mysql://user:password@host:port/database) at DB_SSL=true
// Local (XAMPP): kung walang DATABASE_URL, gagamitin ang localhost / root / easeplace_db
function dbConfig() {
    const base = {
        dateStrings: true, // DATE ay babalik bilang "2026-06-01" (hindi nagbabago ang araw dahil sa timezone)
        enableKeepAlive: true,
    };

    if (process.env.DATABASE_URL) {
        const url = new URL(process.env.DATABASE_URL);
        return {
            ...base,
            host: url.hostname,
            port: Number(url.port) || 3306,
            user: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
            database: url.pathname.replace('/', ''),
            ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
        };
    }

    return { ...base, host: 'localhost', user: 'root', password: '', database: 'easeplace_db' };
}

const db = mysql.createPool(dbConfig());

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

// ===================== FIREBASE ADMIN =====================
// Local: gamitin ang serviceAccountKey.json (huwag i-commit!)
// Deployed (Render): gamitin ang environment variable na FIREBASE_SERVICE_ACCOUNT
function loadServiceAccount() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        sa.private_key = sa.private_key.replace(/\\n/g, '\n');
        return sa;
    }
    return require('./serviceAccountKey.json');
}

initializeApp({ credential: cert(loadServiceAccount()) });
const firestore = getFirestore();

// Patunayan ang Firebase ID token at kunin ang role ng user mula sa Firestore
async function verifyToken(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ message: 'Missing token. Please sign in.' });
    }

    try {
        const decoded = await getAuth().verifyIdToken(token);
        const snap = await firestore.collection('users').doc(decoded.uid).get();
        req.user = {
            uid: decoded.uid,
            email: decoded.email,
            role: snap.exists ? (snap.data().role || 'boarder') : 'boarder',
        };
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid or expired token.' });
    }
}

// Payagan lang ang mga tinukoy na role
function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'You do not have permission to do this.' });
        }
        next();
    };
}

// CLIENT_ORIGIN: mga address ng frontend na pinapayagan (pinaghihiwalay ng kuwit).
// Kung walang laman (local development), bukas sa lahat.
const allowedOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);

app.use(express.json());
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined));

// ipakita sa terminal ang bawat request
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`, req.body);
    next();
});

// Simpleng mensahe sa root URL
app.get('/', (req, res) => {
    res.json({ name: 'EasePlace API', health: '/api/health' });
});

// HEALTH CHECK (public, para sa Render at sa deliverables)
app.get('/api/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'error', database: 'disconnected' });
    }
});

// Lahat ng rooms at reservations ay kailangan ng login
app.use('/api/rooms', verifyToken);
app.use('/api/reservations', verifyToken);

// ======================= ROOMS =======================

// READ: lahat ng rooms (?all=1 para kasama ang deleted, para sa admin lang)
app.get('/api/rooms', async (req, res) => {
    try {
        const includeDeleted = req.query.all === '1' && req.user.role === 'admin';
        const sql = includeDeleted
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

// CREATE (admin lang)
app.post('/api/rooms', requireRole('admin'), async (req, res) => {
    try {
        const { room_name, room_type, price, capacity, status, amenities } = req.body;

        if (!room_name || !room_type || price === undefined || price === '' || !capacity) {
            return res.status(400).json({ message: 'Please complete all required fields.' });
        }
        if (Number(price) < 0 || Number(capacity) < 1) {
            return res.status(400).json({ message: 'Price must be 0 or more and capacity at least 1.' });
        }

        // iwasan ang dalawang aktibong room na pareho ang pangalan
        const [dup] = await db.query('SELECT room_id FROM rooms WHERE room_name = ? AND deleted = 0', [room_name]);
        if (dup.length > 0) {
            return res.status(409).json({ message: 'A room with this name already exists.' });
        }

        const [result] = await db.query(
            'INSERT INTO rooms (room_name, room_type, price, capacity, status, amenities, deleted) VALUES (?, ?, ?, ?, ?, ?, 0)',
            [room_name, room_type, price, capacity, status || 'Available', amenities || '']
        );
        res.status(201).json({ message: 'Room added', id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE (admin lang, kasama ang deleted para sa Restore)
app.put('/api/rooms/:id', requireRole('admin'), async (req, res) => {
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

// DELETE = soft delete (admin lang), para pwedeng i-restore
app.delete('/api/rooms/:id', requireRole('admin'), async (req, res) => {
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

// ===================== RESERVATIONS =====================

const RES_STATUSES = ['pending', 'confirmed', 'cancelled'];

// READ: admin = lahat | boarder = sarili lang (galing sa token, hindi sa request)
app.get('/api/reservations', async (req, res) => {
    try {
        const [rows] = req.user.role === 'admin'
            ? await db.query('SELECT * FROM reservations ORDER BY reservation_id')
            : await db.query('SELECT * FROM reservations WHERE username = ? ORDER BY reservation_id', [req.user.email]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE: bagong reservation (pending). Ang username ay galing sa token.
app.post('/api/reservations', async (req, res) => {
    try {
        const { room_id, guest_name, contact, move_in, months, notes } = req.body;

        if (!room_id || !guest_name || !contact || !move_in || !months) {
            return res.status(400).json({ message: 'Please complete all required fields.' });
        }
        if (Number(months) < 1 || Number(months) > 24) {
            return res.status(400).json({ message: 'Duration must be between 1 and 24 months.' });
        }

        // dapat umiiral at available pa ang room
        const [rooms] = await db.query('SELECT status, deleted FROM rooms WHERE room_id = ?', [room_id]);
        if (rooms.length === 0 || rooms[0].deleted) {
            return res.status(404).json({ message: 'Room not found.' });
        }
        if (String(rooms[0].status).toLowerCase() !== 'available') {
            return res.status(409).json({ message: 'This room is no longer available.' });
        }

        const [result] = await db.query(
            'INSERT INTO reservations (room_id, guest_name, contact, move_in, months, notes, username) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [room_id, guest_name, contact, move_in, months, notes || '', req.user.email]
        );
        res.status(201).json({ message: 'Reservation submitted', id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPDATE: palitan ang status at i-sync ang room status
// admin: puwedeng confirm o cancel | boarder: sarili niyang pending lang, at cancel lang
app.put('/api/reservations/:id/status', async (req, res) => {
    const { status } = req.body;
    if (!RES_STATUSES.includes(status)) {
        return res.status(400).json({ message: 'Invalid status.' });
    }

    const isAdmin = req.user.role === 'admin';
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT room_id, status, username FROM reservations WHERE reservation_id = ? FOR UPDATE',
            [req.params.id]
        );
        if (rows.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Reservation not found.' });
        }

        const { room_id, status: oldStatus, username } = rows[0];

        if (!isAdmin) {
            if (username !== req.user.email || status !== 'cancelled' || oldStatus !== 'pending') {
                await conn.rollback();
                return res.status(403).json({ message: 'You can only cancel your own pending reservation.' });
            }
        }

        if (oldStatus === 'cancelled') {
            await conn.rollback();
            return res.status(409).json({ message: 'This reservation is already cancelled.' });
        }

        await conn.query('UPDATE reservations SET status = ? WHERE reservation_id = ?', [status, req.params.id]);

        if (status === 'confirmed') {
            await conn.query("UPDATE rooms SET status = 'Occupied' WHERE room_id = ?", [room_id]);
        } else if (status === 'cancelled' && oldStatus === 'confirmed') {
            await conn.query("UPDATE rooms SET status = 'Available' WHERE room_id = ?", [room_id]);
        }

        await conn.commit();
        res.json({ message: 'Reservation updated' });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

// ===================== ERROR HANDLERS =====================

// hindi kilalang API endpoint
app.use('/api', (req, res) => {
    res.status(404).json({ message: 'Endpoint not found' });
});

// huling error handler (halimbawa: sirang JSON sa request body)
app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});