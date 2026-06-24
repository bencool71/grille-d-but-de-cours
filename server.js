const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialiser la base de données SQLite
const db = new sqlite3.Database('./grilles.db');

// Créer les tables
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS grilles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sessionCode TEXT NOT NULL,
            name TEXT NOT NULL,
            class TEXT NOT NULL,
            subject TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            matosStylo BOOLEAN DEFAULT FALSE,
            matosFeuilles BOOLEAN DEFAULT FALSE,
            matosCalculatrice BOOLEAN DEFAULT FALSE,
            matosClasseur BOOLEAN DEFAULT FALSE,
            matosCoursPrecedent BOOLEAN DEFAULT FALSE,
            matosScore INTEGER DEFAULT 0,
            matosValidated BOOLEAN,
            sourireScore INTEGER DEFAULT 0,
            sourireValidated BOOLEAN,
            chauudScore INTEGER DEFAULT 0,
            chauudValidated BOOLEAN,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// **Créer une session**
app.post('/api/sessions', (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code requis' });

    db.run('INSERT INTO sessions (code) VALUES (?)', [code], function(err) {
        if (err) return res.status(400).json({ error: 'Code déjà utilisé' });
        res.json({ code });
    });
});

// **Soumettre une grille**
app.post('/api/grilles', (req, res) => {
    const { sessionCode, name, class: studentClass, subject, date, time, matos, scores } = req.body;

    if (!sessionCode || !name || !studentClass || !subject || !date || !time) {
        return res.status(400).json({ error: 'Données manquantes' });
    }

    db.run(`
        INSERT INTO grilles (
            sessionCode, name, class, subject, date, time,
            matosStylo, matosFeuilles, matosCalculatrice, matosClasseur, matosCoursPrecedent,
            matosScore, sourireScore, chauudScore
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        sessionCode, name, studentClass, subject, date, time,
        matos.stylo, matos.feuilles, matos.calculatrice, matos.classeur, matos.coursPrecedent,
        scores.matosScore, scores.sourireScore, scores.chauudScore
    ], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// **Récupérer les grilles d'une session**
app.get('/api/sessions/:code/grilles', (req, res) => {
    const { code } = req.params;

    db.all(`
        SELECT * FROM grilles
        WHERE sessionCode = ?
        ORDER BY name, date DESC, time DESC
    `, [code], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// **Valider une partie d'une grille**
app.put('/api/grilles/:id/validate', (req, res) => {
    const { id } = req.params;
    const { part, validated } = req.body; // part: 'matos'|'sourire'|'chauud', validated: true|false

    if (!part || validated === undefined) {
        return res.status(400).json({ error: 'Données manquantes' });
    }

    const field = `${part}Validated`;
    db.run(`UPDATE grilles SET ${field} = ? WHERE id = ?`, [validated, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// **Exporter en CSV**
app.get('/api/sessions/:code/export', (req, res) => {
    const { code } = req.params;

    db.all(`
        SELECT * FROM grilles
        WHERE sessionCode = ?
        ORDER BY class, name, date DESC, time DESC
    `, [code], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        let csv = 'Classe;Nom;Matière;Date;Heure;Stylo;Feuilles;Calculatrice;Classeur;Cours précédent;Matos (10);Sourire (10);Chauuuud (10);Total effectif (30);Matos;Sourire;Chauuuud\n';

        // Calculer les totaux par élève
        const studentTotals = {};
        rows.forEach(row => {
            const effectiveTotal = (row.matosValidated !== false ? row.matosScore : 0) +
                                   (row.sourireValidated !== false ? row.sourireScore : 0) +
                                   (row.chauudValidated !== false ? row.chauudScore : 0);
            if (!studentTotals[row.name]) {
                studentTotals[row.name] = { total: 0, count: 0 };
            }
            studentTotals[row.name].total += effectiveTotal;
            studentTotals[row.name].count++;
        });

        rows.forEach(row => {
            const effectiveTotal = (row.matosValidated !== false ? row.matosScore : 0) +
                                   (row.sourireValidated !== false ? row.sourireScore : 0) +
                                   (row.chauudValidated !== false ? row.chauudScore : 0);

            const studentTotal = studentTotals[row.name].total;
            const maxPossible = studentTotals[row.name].count * 30;

            csv += `"${row.class}";"${row.name}";"${studentTotal}/${maxPossible}";"${row.subject}";"${row.date}";"${row.time}";` +
                  `"${row.matosStylo ? 'Oui' : 'Non'}";"${row.matosFeuilles ? 'Oui' : 'Non'}";"${row.matosCalculatrice ? 'Oui' : 'Non'}";` +
                  `"${row.matosClasseur ? 'Oui' : 'Non'}";"${row.matosCoursPrecedent ? 'Oui' : 'Non'}";` +
                  `${row.matosScore};${row.sourireScore};${row.chauudScore};${effectiveTotal};` +
                  `${row.matosValidated === true ? 'Validé' : row.matosValidated === false ? 'Refusé' : 'En attente'};` +
                  `${row.sourireValidated === true ? 'Validé' : row.sourireValidated === false ? 'Refusé' : 'En attente'};` +
                  `${row.chauudValidated === true ? 'Validé' : row.chauudValidated === false ? 'Refusé' : 'En attente'}\n`;
        });

        // Ajouter la moyenne
        const allEffectiveTotals = rows.map(row =>
            (row.matosValidated !== false ? row.matosScore : 0) +
            (row.sourireValidated !== false ? row.sourireScore : 0) +
            (row.chauudValidated !== false ? row.chauudScore : 0)
        );
        const average = allEffectiveTotals.length > 0 ?
            (allEffectiveTotals.reduce((a, b) => a + b, 0) / allEffectiveTotals.length).toFixed(2) : 0;
        csv += `\nMoyenne générale;;;;"${average}"/30;;;;;;;;;\n`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="grilles_${code}_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);
    });
});

// **Servir le frontend**
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});