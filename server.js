const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const rooms = new Map();
const ACTIONS = new Set(["charge", "guard", "pa", "e", "blink", "blinkpa", "genki"]);

function code() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
function cleanName(v) {
  return String(v || "전사").trim().slice(0, 10) || "전사";
}
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, character: p.character, ki: p.ki,
      alive: p.alive, ready: !!p.choice, spectator: p.spectator
    })),
    choices: room.phase === "reveal" || room.phase === "finished" ? room.lastSummary : null,
    winnerId: room.winnerId
  };
}
function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}
function makeRoom(host) {
  let id = code();
  while (rooms.has(id)) id = code();
  const room = {
    code: id, hostId: host.id, phase: "lobby", round: 0,
    players: new Map(), lastSummary: null, winnerId: null
  };
  room.players.set(host.id, {
    id: host.id, name: host.name, character: host.character,
    ki: 1, alive: true, choice: null, spectator: false
  });
  rooms.set(id, room);
  host.join(id);
  return room;
}
function findRoom(socket) {
  for (const room of rooms.values()) if (room.players.has(socket.id)) return room;
  return null;
}
function targetValid(room, actor, targetId) {
  return targetId && targetId !== actor.id && room.players.has(targetId) && room.players.get(targetId).alive;
}
function resolveRound(room) {
  const alive = [...room.players.values()].filter(p => p.alive && !p.spectator);
  const genkiUsers = alive.filter(p => p.choice?.action === "genki" && p.ki >= 5);

  // Genki Dama is an unavoidable room-wide elimination of every opponent.
  if (genkiUsers.length) {
    const caster = genkiUsers[0];
    for (const p of alive) {
      if (p.id !== caster.id) p.alive = false;
    }
    caster.alive = true;
    room.winnerId = caster.id;
    room.phase = "finished";
    room.lastSummary = {
      round: room.round,
      lines: [`${caster.name}의 원기옥 발동! 모든 상대가 탈락했습니다.`],
      genki: caster.id,
      players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, action: p.choice?.action, targetId: p.choice?.targetId, alive: p.alive, ki: p.ki }))
    };
    return;
  }

  const actions = new Map(alive.map(p => [p.id, p.choice?.action || "guard"]));
  const targeted = new Map(alive.map(p => [p.id, []]));
  for (const p of alive) {
    const c = p.choice;
    if (!c) continue;
    if (["pa", "e", "blinkpa"].includes(c.action) && targetValid(room, p, c.targetId)) {
      targeted.get(c.targetId).push({ from: p.id, action: c.action });
    }
  }

  const out = new Set();
  for (const p of alive) {
    const incoming = targeted.get(p.id) || [];
    for (const hit of incoming) {
      const own = actions.get(p.id);
      let survives = false;
      if (hit.action === "pa") {
        survives = own === "guard" || own === "blink" || own === "blinkpa" ||
          incoming.some(x => x.from === p.id && ["pa", "e"].includes(x.action));
      } else if (hit.action === "e") {
        survives = own === "blink" || own === "blinkpa" ||
          incoming.some(x => x.from === p.id && x.action === "e");
      } else if (hit.action === "blinkpa") {
        survives = own !== "blink";
      }
      if (!survives) out.add(p.id);
    }
  }

  for (const p of alive) {
    if (out.has(p.id)) p.alive = false;
    const action = actions.get(p.id);
    if (action === "charge") p.ki += 1;
    if (action === "pa" || action === "blink") p.ki = Math.max(0, p.ki - 1);
    if (action === "e") p.ki = Math.max(0, p.ki - 3);
    if (action === "blinkpa") p.ki = Math.max(0, p.ki - 2);
    p.ki = Math.min(5, p.ki);
    p.choice = null;
  }

  const remaining = [...room.players.values()].filter(p => p.alive && !p.spectator);
  const lines = [];
  for (const p of alive) lines.push(`${p.name}: ${label(actions.get(p.id))}${out.has(p.id) ? " → 아웃" : " → 생존"}`);
  room.lastSummary = {
    round: room.round,
    lines,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, action: actions.get(p.id), alive: p.alive, ki: p.ki }))
  };
  if (remaining.length <= 1) {
    room.phase = "finished";
    room.winnerId = remaining[0]?.id || null;
  } else {
    room.phase = "reveal";
  }
}
function label(a) {
  return ({charge:"아(기 모으기)",guard:"막(방어)",pa:"파",e:"에",blink:"순(순간이동)",blinkpa:"순파",genki:"원기옥"})[a] || a;
}

io.on("connection", socket => {
  socket.on("room:create", ({ name, character } = {}, cb = () => {}) => {
    const room = makeRoom({ id: socket.id, name: cleanName(name), character: character || "손오공" });
    cb({ ok: true, code: room.code, id: socket.id });
    emitRoom(room);
  });

  socket.on("room:join", ({ code: rawCode, name, character, spectator } = {}, cb = () => {}) => {
    const room = rooms.get(String(rawCode || "").trim().toUpperCase());
    if (!room) return cb({ ok: false, error: "방을 찾을 수 없습니다." });
    if (room.phase !== "lobby" && !spectator) return cb({ ok: false, error: "게임이 진행 중입니다. 관전으로 입장해 주세요." });
    const player = {
      id: socket.id, name: cleanName(name), character: character || "베지터",
      ki: 1, alive: true, choice: null, spectator: !!spectator
    };
    room.players.set(socket.id, player);
    socket.join(room.code);
    cb({ ok: true, code: room.code, id: socket.id });
    emitRoom(room);
  });

  socket.on("game:start", cb => {
    const room = findRoom(socket);
    if (!room || room.hostId !== socket.id) return cb?.({ ok:false, error:"호스트만 시작할 수 있습니다." });
    if (room.phase !== "lobby") return cb?.({ ok:false, error:"이미 게임이 시작되었습니다." });
    const players = [...room.players.values()].filter(p => !p.spectator);
    if (players.length < 2) return cb?.({ ok:false, error:"최소 2명이 필요합니다." });
    room.phase = "playing"; room.round = 1; room.winnerId = null;
    for (const p of players) { p.ki = 1; p.alive = true; p.choice = null; }
    cb?.({ ok:true }); emitRoom(room);
  });

  socket.on("game:choose", ({ action, targetId } = {}, cb = () => {}) => {
    const room = findRoom(socket);
    const p = room?.players.get(socket.id);
    if (!room || room.phase !== "playing" || !p || !p.alive || p.spectator) return cb({ok:false,error:"현재 선택할 수 없습니다."});
    if (!ACTIONS.has(action)) return cb({ok:false,error:"알 수 없는 기술입니다."});
    const costs = { charge:0, guard:0, pa:1, e:3, blink:1, blinkpa:2, genki:5 };
    if (p.ki < costs[action]) return cb({ok:false,error:"기력이 부족합니다."});
    if (["pa","e","blinkpa"].includes(action) && !targetValid(room,p,targetId)) return cb({ok:false,error:"공격 대상을 선택해 주세요."});
    p.choice = { action, targetId: targetId || null };
    cb({ok:true});
    emitRoom(room);
    const active = [...room.players.values()].filter(x => x.alive && !x.spectator);
    if (active.every(x => x.choice)) {
      // Keep reveal host-controlled, matching the original game.
      io.to(room.code).emit("game:all-ready");
    }
  });

  socket.on("game:reveal", (cb = () => {}) => {
    const room = findRoom(socket);
    if (!room || room.hostId !== socket.id || room.phase !== "playing") return cb({ok:false,error:"호스트만 결과를 공개할 수 있습니다."});
    const active = [...room.players.values()].filter(p => p.alive && !p.spectator);
    if (active.some(p => !p.choice)) return cb({ok:false,error:"아직 선택하지 않은 플레이어가 있습니다."});
    resolveRound(room);
    cb({ok:true});
    emitRoom(room);
  });

  socket.on("game:next", (cb = () => {}) => {
    const room = findRoom(socket);
    if (!room || room.hostId !== socket.id || room.phase !== "reveal") return cb({ok:false,error:"다음 라운드로 진행할 수 없습니다."});
    room.round += 1; room.phase = "playing"; room.lastSummary = null;
    for (const p of room.players.values()) p.choice = null;
    cb({ok:true}); emitRoom(room);
  });

  socket.on("game:restart", (cb = () => {}) => {
    const room = findRoom(socket);
    if (!room || room.hostId !== socket.id) return cb({ok:false,error:"호스트만 재시작할 수 있습니다."});
    room.phase = "lobby"; room.round = 0; room.lastSummary = null; room.winnerId = null;
    for (const p of room.players.values()) { p.ki = 1; p.alive = true; p.choice = null; p.spectator = false; }
    cb({ok:true}); emitRoom(room);
  });

  socket.on("chat:send", ({ message } = {}, cb = () => {}) => {
    const room = findRoom(socket);
    const p = room?.players.get(socket.id);
    const msg = String(message || "").trim().slice(0, 240);
    if (!room || !p || !msg) return cb({ok:false,error:"메시지를 입력해 주세요."});
    io.to(room.code).emit("chat:message", {
      id: crypto.randomUUID(), name: p.name, message: msg, time: new Date().toISOString()
    });
    cb({ok:true});
  });

  socket.on("disconnect", () => {
    const room = findRoom(socket);
    if (!room) return;
    room.players.delete(socket.id);
    if (room.hostId === socket.id) {
      const next = room.players.keys().next().value;
      room.hostId = next || null;
    }
    if (!room.players.size) rooms.delete(room.code);
    else emitRoom(room);
  });
});

server.listen(PORT, () => console.log(`Dragon Ball Battle running on ${PORT}`));
