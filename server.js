const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MAP_WIDTH = 2500; 
const MAP_HEIGHT = 2500;
const MAX_FOOD = 300;
const MERGE_DELAY = 15000; 

const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                return res.end('Errore nel caricamento di index.html');
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    }
});

const wss = new WebSocket.Server({ server });

let players = {};
let food = [];

function spawnFood() {
    return {
        id: Math.random().toString(36).substring(2, 9),
        x: Math.random() * MAP_WIDTH,
        y: Math.random() * MAP_HEIGHT,
        radius: 5,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`
    };
}

for (let i = 0; i < MAX_FOOD; i++) {
    food.push(spawnFood());
}

function createPlayerData(id, name) {
    return {
        id: id,
        name: name || "Anonimo-" + Math.floor(100 + Math.random() * 900),
        color: `hsl(${Math.random() * 360}, 80%, 60%)`,
        dead: false,
        cells: [{
            x: Math.random() * MAP_WIDTH,
            y: Math.random() * MAP_HEIGHT,
            radius: 22,
            targetX: MAP_WIDTH / 2,
            targetY: MAP_HEIGHT / 2,
            vx: 0, 
            vy: 0, 
            canMergeAfter: Date.now()
        }]
    };
}

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(2, 9);

    ws.send(JSON.stringify({ 
        type: 'welcome', 
        id: id,
        mapWidth: MAP_WIDTH,
        mapHeight: MAP_HEIGHT
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'join' || data.type === 'respawn') {
                players[id] = createPlayerData(id, data.name);
                ws.send(JSON.stringify({ type: 'spawn_confirm' }));
            }
            
            if (data.type === 'move' && players[id] && !players[id].dead) {
                players[id].cells.forEach(cell => {
                    cell.targetX = data.x;
                    cell.targetY = data.y;
                });
            }

            if (data.type === 'split' && players[id] && !players[id].dead) {
                let p = players[id];
                if (p.cells.length >= 16) return;

                let newCells = [];
                p.cells.forEach(cell => {
                    if (cell.radius > 35 && p.cells.length + newCells.length < 16) {
                        let dx = cell.targetX - cell.x;
                        let dy = cell.targetY - cell.y;
                        let dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist === 0) dist = 1;

                        let dirX = dx / dist;
                        let dirY = dy / dist;

                        let newRadius = cell.radius / Math.sqrt(2);
                        cell.radius = newRadius;

                        let mergeTime = Date.now() + MERGE_DELAY;
                        cell.canMergeAfter = mergeTime;

                        newCells.push({
                            x: cell.x + dirX * newRadius,
                            y: cell.y + dirY * newRadius,
                            radius: newRadius,
                            targetX: cell.targetX,
                            targetY: cell.targetY,
                            vx: dirX * 25, 
                            vy: dirY * 25,
                            canMergeAfter: mergeTime
                        });
                    }
                });
                p.cells = p.cells.concat(newCells);
            }
        } catch (e) {
            console.error(e);
        }
    });

    ws.on('close', () => { delete players[id]; });
});

setInterval(() => {
    let now = Date.now();

    for (let id in players) {
        let p = players[id];
        if (p.dead) continue;

        p.cells.forEach(cell => {
            let dx = cell.targetX - cell.x;
            let dy = cell.targetY - cell.y;
            let distance = Math.sqrt(dx * dx + dy * dy);

            let speed = Math.max(1.2, 7 - (cell.radius * 0.04));

            if (distance > 2) {
                cell.x += (dx / distance) * speed;
                cell.y += (dy / distance) * speed;
            }

            cell.x += cell.vx;
            cell.y += cell.vy;
            cell.vx *= 0.90; 
            cell.vy *= 0.90;

            if (cell.x < 0) cell.x = 0; if (cell.x > MAP_WIDTH) cell.x = MAP_WIDTH;
            if (cell.y < 0) cell.y = 0; if (cell.y > MAP_HEIGHT) cell.y = MAP_HEIGHT;
        });

        for (let i = 0; i < p.cells.length; i++) {
            for (let j = i + 1; j < p.cells.length; j++) {
                let c1 = p.cells[i];
                let c2 = p.cells[j];

                let dx = c1.x - c2.x;
                let dy = c1.y - c2.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                let overlap = (c1.radius + c2.radius) - dist;

                if (overlap > 0) {
                    if (now > c1.canMergeAfter && now > c2.canMergeAfter) {
                        c1.radius = Math.sqrt(c1.radius * c1.radius + c2.radius * c2.radius);
                        p.cells.splice(j, 1);
                        j--;
                    } else {
                        if (dist === 0) dist = 1;
                        c1.x += (dx / dist) * overlap * 0.5;
                        c1.y += (dy / dist) * overlap * 0.5;
                        c2.x -= (dx / dist) * overlap * 0.5;
                        c2.y -= (dy / dist) * overlap * 0.5;
                    }
                }
            }
        }
    }

    for (let id in players) {
        let p = players[id];
        if (p.dead) continue;

        p.cells.forEach(cell => {
            for (let i = food.length - 1; i >= 0; i--) {
                let f = food[i];
                let dx = cell.x - f.x;
                let dy = cell.y - f.y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < cell.radius) {
                    food.splice(i, 1);
                    cell.radius = Math.sqrt(cell.radius * cell.radius + f.radius * f.radius);
                    food.push(spawnFood());
                }
            }
        });
    }

    let playerIds = Object.keys(players);
    for (let i = 0; i < playerIds.length; i++) {
        let p1 = players[playerIds[i]];
        if (p1.dead) continue;

        for (let j = 0; j < playerIds.length; j++) {
            if (i === j) continue;
            let p2 = players[playerIds[j]];
            if (p2.dead) continue;

            p1.cells.forEach(c1 => {
                for (let k = p2.cells.length - 1; k >= 0; k--) {
                    let c2 = p2.cells[k];
                    let dx = c1.x - c2.x;
                    let dy = c1.y - c2.y;
                    let distance = Math.sqrt(dx * dx + dy * dy);

                    if (c1.radius > c2.radius * 1.15 && distance < c1.radius) {
                        c1.radius = Math.sqrt(c1.radius * c1.radius + c2.radius * c2.radius);
                        p2.cells.splice(k, 1); 
                    }
                }
            });

            if (p2.cells.length === 0) {
                p2.dead = true;
            }
        }
    }

    let leaderboard = Object.values(players)
        .filter(p => !p.dead)
        .map(p => {
            let totalRadius = p.cells.reduce((sum, c) => sum + c.radius, 0);
            return {
                name: p.name,
                score: Math.floor(totalRadius * 10)
            };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

    const gameState = JSON.stringify({ 
        type: 'update', 
        players: players,
        food: food,
        leaderboard: leaderboard
    });

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(gameState);
        }
    });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server pronto sulla porta ${PORT}`);
});
