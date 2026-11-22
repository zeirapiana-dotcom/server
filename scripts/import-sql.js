// Isang beses na tool para ilipat ang local (XAMPP) database sa cloud MySQL.
//
// Gamit (PowerShell, sa server folder):
//   $env:DATABASE_URL = "mysql://USER:PASSWORD@HOST:4000/easeplace_db"
//   $env:DB_SSL = "true"
//   node scripts/import-sql.js easeplace_db.sql
//
// Walang secret sa file na ito: ang DATABASE_URL ay galing sa environment variable.

const fs = require('fs');
const mysql = require('mysql2/promise');

async function main() {
    const file = process.argv[2];
    if (!file || !process.env.DATABASE_URL) {
        console.error('Usage: set DATABASE_URL (and DB_SSL=true), then run: node scripts/import-sql.js <file.sql>');
        process.exit(1);
    }

    const url = new URL(process.env.DATABASE_URL);
    const dbName = url.pathname.replace('/', '');

    // kumonekta muna nang walang database para magawa ito kung wala pa
    const conn = await mysql.createConnection({
        host: url.hostname,
        port: Number(url.port) || 3306,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        multipleStatements: true,
        ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
    });

    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
    await conn.query(`USE \`${dbName}\``);

    const sql = fs.readFileSync(file, 'utf8');
    await conn.query(sql);

    const [tables] = await conn.query('SHOW TABLES');
    console.log('Import finished. Tables:', tables.map(t => Object.values(t)[0]).join(', '));
    await conn.end();
}

main().catch(err => {
    console.error('Import failed:', err.message);
    process.exit(1);
});