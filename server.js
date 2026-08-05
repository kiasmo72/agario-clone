const WebSocket = require('ws'), http = require('http'), fs = require('fs'), path = require('path');
const MAP = 3500, MAX_FOOD = 450, MAX_OBS = 15, MERGE_DELAY = 15000;
let players = {}, food = [], obstacles = [], ejectedMass = [];

const server = http.createServer((req, res) => {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
        res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/html' });
        res.end(err ? 'Errore' : data);
    });
});
const wss = new WebSocket.Server({ server });

const randPos = () => ({ x: Math.random() * MAP, y: Math.random() * MAP });
const getDist = (p1, p2) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

for (let i = 0; i < MAX_FOOD; i++) food.push({ id: i, ...randPos(), radius: 5, color: `hsl(${Math.random()*360},100%,50%)` });
for (let i = 0; i < MAX_OBS; i++) obstacles.push({ id: i, ...randPos(), radius: 60 });

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(2, 9);
    ws.send(JSON.stringify({ type: 'welcome', id, mapWidth: MAP, mapHeight: MAP }));

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if ((data.type === 'join' || data.type === 'respawn')) {
                players[id] = { id, name: data.name || "Anonimo", color: `hsl(${Math.random()*360},80%,60%)`, skin: data.skin, dead: false, cells: [{ ...randPos(), radius: 22, targetX: MAP/2, targetY: MAP/2, vx: 0, vy: 0, canMergeAfter: Date.now() }] };
                ws.send(JSON.stringify({ type: 'spawn_confirm' }));
            }
            if (data.type === 'move' && players[id] && !players[id].dead) {
                players[id].cells.forEach(c => { c.targetX = data.x; c.targetY = data.y; });
            }
            if (data.type === 'chat' && players[id]) {
                wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(JSON.stringify({ type: 'chat_broadcast', name: players[id].name, message: data.message.substring(0, 70) })));
            }
            
            // CONTROLLO TASTO C (EJECT) - SISTEMATO E CORRETTO
            if (data.type === 'eject' && players[id] && !players[id].dead) {
                players[id].cells.forEach(c => {
                    if (c.radius > 24) { // Abbassato il raggio minimo a 24 per permetterti di provarlo subito senza crescere troppo
                        let dx = c.targetX - c.x, dy = c.targetY - c.y, d = Math.sqrt(dx*dx + dy*dy) || 1;
                        // Riduce visibilmente il raggio di chi spara
                        c.radius = Math.sqrt(c.radius * c.radius - 50);
                        ejectedMass.push({ x: c.x + (dx/d)*(c.radius+20), y: c.y + (dy/d)*(c.radius+20), radius: 8, color: players[id].color, vx: (dx/d)*15, vy: (dy/d)*15 });
                    }
                });
            }
            
            if (data.type === 'split' && players[id] && !players[id].dead && players[id].cells.length < 16) {
                let p = players[id], newCells = [];
                p.cells.forEach(c => {
                    if (c.radius > 35 && p.cells.length + newCells.length < 16) {
                        let dx = c.targetX - c.x, dy = c.targetY - c.y, d = Math.sqrt(dx*dx + dy*dy) || 1;
                        c.radius /= Math.sqrt(2);
                        newCells.push({ x: c.x + (dx/d)*c.radius, y: c.y + (dy/d)*c.radius, radius: c.radius, targetX: c.targetX, targetY: c.targetY, vx: (dx/d)*25, vy: (dy/d)*25, canMergeAfter: Date.now() + MERGE_DELAY });
                        c.canMergeAfter = Date.now() + MERGE_DELAY;
                    }
                });
                p.cells = p.cells.concat(newCells);
            }
        } catch (e) {}
    });
    ws.on('close', () => delete players[id]);
});

setInterval(() => {
    ejectedMass.forEach(m => { m.x += m.vx; m.y += m.vy; m.vx *= 0.85; m.vy *= 0.85; });
    
    for (let id in players) {
        let p = players[id]; if (p.dead) continue;
        p.cells.forEach(c => {
            let dx = c.targetX - c.x, dy = c.targetY - c.y, d = Math.sqrt(dx*dx + dy*dy);
            let speed = Math.max(1.2, 7 - (c.radius * 0.04));
            if (d > 2) { c.x += (dx/d)*speed; c.y += (dy/d)*speed; }
            c.x += c.vx; c.y += c.vy; c.vx *= 0.9; c.vy *= 0.9;
            c.x = Math.max(0, Math.min(MAP, c.x)); c.y = Math.max(0, Math.min(MAP, c.y));
        });

        for (let i = 0; i < p.cells.length; i++) {
            for (let j = i + 1; j < p.cells.length; j++) {
                let c1 = p.cells[i], c2 = p.cells[j], d = getDist(c1, c2), overlap = (c1.radius + c2.radius) - d;
                if (overlap > 0) {
                    if (Date.now() > c1.canMergeAfter && Date.now() > c2.canMergeAfter) {
                        c1.radius = Math.sqrt(c1.radius**2 + c2.radius**2); p.cells.splice(j, 1); j--;
                    } else {
                        let dx = c1.x - c2.x, dy = c1.y - c2.y, dist = d || 1;
                        c1.x += (dx/dist)*overlap*0.5; c1.y += (dy/dist)*overlap*0.5;
                        c2.x -= (dx/dist)*overlap*0.5; c2.y -= (dy/dist)*overlap*0.5;
                    }
                }
            }
        }
    }

    for (let id in players) {
        let p = players[id]; if (p.dead) continue;
        p.cells.forEach((c, idx) => {
            obstacles.forEach(o => {
                if (c.radius > o.radius && getDist(c, o) < c.radius && p.cells.length < 16) {
                    p.cells.splice(idx, 1); let r = c.radius / 2;
                    [0, Math.PI/2, Math.PI, Math.PI*1.5].forEach(a => p.cells.push({ x: c.x, y: c.y, radius: r, targetX: c.targetX, targetY: c.targetY, vx: Math.cos(a)*18, vy: Math.sin(a)*18, canMergeAfter: Date.now()+MERGE_DELAY }));
                }
            });
            for (let i = food.length - 1; i >= 0; i--) if (getDist(c, food[i]) < c.radius) { c.radius = Math.sqrt(c.radius**2 + food[i].radius**2); food[i] = { ...food[i], ...randPos() }; }
            for (let i = ejectedMass.length - 1; i >= 0; i--) if (getDist(c, ejectedMass[i]) < c.radius) { c.radius = Math.sqrt(c.radius**2 + ejectedMass[i].radius**2); ejectedMass.splice(i, 1); }
        });
    }

    let ids = Object.keys(players);
    for (let i = 0; i < ids.length; i++) {
        let p1 = players[ids[i]]; if (p1.dead) continue;
        for (let j = 0; j < ids.length; j++) {
            if (i === j) continue; let p2 = players[ids[j]]; if (p2.dead) continue;
            p1.cells.forEach(c1 => {
                for (let k = p2.cells.length - 1; k >= 0; k--) {
                    if (c1.radius > p2.cells[k].radius * 1.15 && getDist(c1, p2.cells[k]) < c1.radius) {
                        c1.radius = Math.sqrt(c1.radius**2 + p2.cells[k].radius**2); p2.cells.splice(k, 1);
                    }
                }
            });
            if (p2.cells.length === 0) p2.dead = true;
        }
    }

    let lb = Object.values(players).filter(p => !p.dead).map(p => ({ name: p.name, score: Math.floor(p.cells.reduce((s, c) => s + c.radius, 0) * 10) })).sort((a, b) => b.score - a.score).slice(0, 5);
    wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(JSON.stringify({ type: 'update', players, food, obstacles, ejectedMass, leaderboard: lb })));
}, 1000 / 60);

server.listen(process.env.PORT || 3000, () => console.log("Server Pronto"));
