
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
const ACTIONS = new Set([
  "charge", "guard", "pa", "e", "blink", "blinkpa", "genki"
]);

function makeCode() {
  let id;
  do {
    id = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(id));
  return id;
}

function cleanName(name) {
  return String(name || "전사").trim().slice(0, 10) || "전사";
}

function makePlayer(id, name, character, isBot = false) {
  return {
    id,
    name,
    character,
    ki: 1,
    alive: true,
    choice: null,
    spectator: false,
    isBot
  };
}

function makeRoom(host) {
  const room = {
    code: makeCode(),
    hostId: host.id,
    phase: "lobby",
    round: 0,
    players: new Map(),
    lastSummary: null,
    winnerId: null,
    solo: false
  };

  room.players.set(
    host.id,
    makePlayer(host.id, host.name, host.character)
  );

  rooms.set(room.code, room);
  return room;
}

function addBot(room) {
  const id = "bot-" + crypto.randomBytes(4).toString("hex");

  room.players.set(
    id,
    makePlayer(id, "CPU 전사", "베지터", true)
  );

  room.solo = true;
}

function findRoom(socket) {
  for (const room of rooms.values()) {
    if (room.players.has(socket.id)) return room;
  }
  return null;
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    solo: room.solo,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      character: p.character,
      ki: p.ki,
      alive: p.alive,
      ready: !!p.choice,
      spectator: p.spectator,
      isBot: !!p.isBot
    })),
    choices: ["reveal", "finished"].includes(room.phase)
      ? room.lastSummary
      : null,
    winnerId: room.winnerId
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function targetValid(room, actor, targetId) {
  const target = room.players.get(targetId);
  return !!target &&
    target.id !== actor.id &&
    target.alive &&
    !target.spectator;
}

function label(action) {
  return {
    charge: "아(기 모으기)",
    guard: "막(방어)",
    pa: "파",
    e: "에",
    blink: "순(순간이동)",
    blinkpa: "순파",
    genki: "원기옥"
  }[action] || action;
}

// BOT 행동
function botChoose(room, bot, human) {
  if (bot.ki >= 5 && Math.random() < 0.65) {
    bot.choice = { action: "genki" };
    return;
  }

  const r = Math.random();

  if (bot.ki < 2 || r < 0.45) {
    bot.choice = { action: "charge" };
  } else if (r < 0.65) {
    bot.choice = { action: "guard" };
  } else if (bot.ki >= 3 && r < 0.82) {
    bot.choice = { action: "e", targetId: human.id };
  } else {
    bot.choice = { action: "pa", targetId: human.id };
  }
}

// 라운드 판정
function resolveRound(room) {
  const alive = [...room.players.values()].filter(
    p => p.alive && !p.spectator
  );

  // 원기옥: 모든 상대 즉사
  const genkiUsers = alive.filter(
    p => p.choice?.action === "genki" && p.ki >= 5
  );

  if (genkiUsers.length) {
    const caster = genkiUsers[0];

    for (const p of alive) {
      if (p.id !== caster.id) p.alive = false;
    }

    room.winnerId = caster.id;
    room.phase = "finished";

    room.lastSummary = {
      round: room.round,
      lines: [
        `${caster.name}의 원기옥 발동! 모든 상대가 탈락했습니다.`
      ]
    };

    return;
  }

  const actions = new Map(
    alive.map(p => [p.id, p.choice?.action || "guard"])
  );

  const targeted = new Map(
    alive.map(p => [p.id, []])
  );

  for (const p of alive) {
    const c = p.choice;

    if (
      c &&
      ["pa", "e", "blinkpa"].includes(c.action) &&
      targetValid(room, p, c.targetId)
    ) {
      targeted.get(c.targetId).push({
        from: p.id,
        action: c.action
      });
    }
  }

  const out = new Set();

  for (const p of alive) {
    const incoming = targeted.get(p.id) || [];

    for (const hit of incoming) {
      const own = actions.get(p.id);
      let survives = false;

      if (hit.action === "pa") {
        survives =
          own === "guard" ||
          own === "blink" ||
          own === "blinkpa" ||
          incoming.some(x =>
            x.from === p.id &&
            ["pa", "e"].includes(x.action)
          );
      } else if (hit.action === "e") {
        survives =
          own === "blink" ||
          own === "blinkpa" ||
          incoming.some(x =>
            x.from === p.id && x.action === "e"
          );
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
    if (["pa", "blink"].includes(action)) p.ki -= 1;
    if (action === "e") p.ki -= 3;
    if (action === "blinkpa") p.ki -= 2;

    p.ki = Math.max(0, Math.min(5, p.ki));
    p.choice = null;
  }

  const remaining = [...room.players.values()].filter(
    p => p.alive && !p.spectator
  );

  room.lastSummary = {
    round: room.round,
    lines: alive.map(p =>
      `${p.name}: ${label(actions.get(p.id))}` +
      (out.has(p.id) ? " → 아웃" : " → 생존")
    )
  };

  if (remaining.length <= 1) {
    room.phase = "finished";
    room.winnerId = remaining[0]?.id || null;
  } else {
    room.phase = "reveal";
  }
}

io.on("connection", socket => {

  // 일반 방 생성
  socket.on("room:create", (data = {}, cb = () => {}) => {
    const room = makeRoom({
      id: socket.id,
      name: cleanName(data.name),
      character: data.character || "손오공"
    });

    socket.join(room.code);

    cb({ ok: true, code: room.code, id: socket.id });
    emitRoom(room);
  });

  // BOT 방 생성
  socket.on("room:createSolo", (data = {}, cb = () => {}) => {
    const room = makeRoom({
      id: socket.id,
      name: cleanName(data.name),
      character: data.character || "손오공"
    });

    addBot(room);
    socket.join(room.code);

    cb({ ok: true, code: room.code, id: socket.id });
    emitRoom(room);
  });

  // 방 입장
  socket.on("room:join", (data = {}, cb = () => {}) => {
    const room = rooms.get(
      String(data.code || "").trim().toUpperCase()
    );

    if (!room) {
      return cb({ ok: false, error: "방을 찾을 수 없습니다." });
    }

    if (room.phase !== "lobby" && !data.spectator) {
      return cb({
        ok: false,
        error: "게임이 진행 중입니다."
      });
    }

    room.players.set(
      socket.id,
      makePlayer(
        socket.id,
        cleanName(data.name),
        data.character || "베지터"
      )
    );

    socket.join(room.code);

    cb({ ok: true, code: room.code, id: socket.id });
    emitRoom(room);
  });

  // 게임 시작
  socket.on("game:start", cb => {
    const room = findRoom(socket);

    if (!room || room.hostId !== socket.id) {
      return cb?.({ ok: false, error: "호스트만 시작할 수 있습니다." });
    }

    const players = [...room.players.values()].filter(
      p => !p.spectator
    );

    if (players.length < 2) {
      return cb?.({ ok: false, error: "최소 2명이 필요합니다." });
    }

    room.phase = "playing";
    room.round = 1;
    room.winnerId = null;

    for (const p of players) {
      p.ki = 1;
      p.alive = true;
      p.choice = null;
    }

    cb?.({ ok: true });
    emitRoom(room);
  });

  // 기술 선택
  socket.on("game:choose", (data = {}, cb = () => {}) => {
    const room = findRoom(socket);
    const p = room?.players.get(socket.id);
    const action = data.action;

    if (!room || room.phase !== "playing" || !p || !p.alive) {
      return cb({ ok: false, error: "현재 선택할 수 없습니다." });
    }

    if (!ACTIONS.has(action)) {
      return cb({ ok: false, error: "잘못된 기술입니다." });
    }

    const costs = {
      charge: 0, guard: 0, pa: 1,
      e: 3, blink: 1, blinkpa: 2, genki: 5
    };

    if (p.ki < costs[action]) {
      return cb({ ok: false, error: "기력이 부족합니다." });
    }

    if (
      ["pa", "e", "blinkpa"].includes(action) &&
      !targetValid(room, p, data.targetId)
    ) {
      return cb({ ok: false, error: "공격 대상을 선택하세요." });
    }

    p.choice = {
      action,
      targetId: data.targetId || null
    };

    // BOT 자동 선택
    if (room.solo) {
      const bot = [...room.players.values()].find(
        x => x.isBot && x.alive
      );

      if (bot && !bot.choice) {
        botChoose(room, bot, p);
      }
    }

    cb({ ok: true });
    emitRoom(room);

    const active = [...room.players.values()].filter(
      p => p.alive && !p.spectator
    );

    if (active.every(p => p.choice)) {
      io.to(room.code).emit("game:all-ready");
    }
  });

  // 결과 공개
  socket.on("game:reveal", cb => {
    const room = findRoom(socket);

    if (
      !room ||
      room.hostId !== socket.id ||
      room.phase !== "playing"
    ) {
      return cb({ ok: false, error: "결과 공개 권한이 없습니다." });
    }

    const active = [...room.players.values()].filter(
      p => p.alive && !p.spectator
    );

    if (active.some(p => !p.choice)) {
      return cb({
        ok: false,
        error: "아직 선택하지 않은 플레이어가 있습니다."
      });
    }

    resolveRound(room);

    cb({ ok: true });
    emitRoom(room);
  });

  // 다음 라운드
  socket.on("game:next", cb => {
    const room = findRoom(socket);

    if (!room || room.hostId !== socket.id || room.phase !== "reveal") {
      return cb({ ok: false, error: "다음 라운드로 진행할 수 없습니다." });
    }

    room.round++;
    room.phase = "playing";
    room.lastSummary = null;

    for (const p of room.players.values()) p.choice = null;

    cb({ ok: true });
    emitRoom(room);
  });

  // 재시작
  socket.on("game:restart", cb => {
    const room = findRoom(socket);

    if (!room || room.hostId !== socket.id) {
      return cb({ ok: false, error: "호스트만 재시작할 수 있습니다." });
    }

    room.phase = "lobby";
    room.round = 0;
    room.lastSummary = null;
    room.winnerId = null;

    for (const p of room.players.values()) {
      p.ki = 1;
      p.alive = true;
      p.choice = null;
      p.spectator = false;
    }

    cb({ ok: true });
    emitRoom(room);
  });

  // 실시간 채팅
  socket.on("chat:send", (data = {}, cb = () => {}) => {
    const room = findRoom(socket);
    const p = room?.players.get(socket.id);
    const message = String(data.message || "").trim().slice(0, 240);

    if (!room || !p || !message) {
      return cb({
        ok: false,
        error: "방 연결 또는 메시지를 확인해 주세요."
      });
    }

    io.to(room.code).emit("chat:message", {
      id: crypto.randomUUID(),
      name: p.name,
      message,
      time: new Date().toISOString()
    });

    cb({ ok: true });
  });

  // 연결 종료
  socket.on("disconnect", () => {
    const room = findRoom(socket);
    if (!room) return;

    room.players.delete(socket.id);

    if (room.hostId === socket.id) {
      const next = [...room.players.values()].find(p => !p.isBot);
      room.hostId = next?.id || null;
    }

    if (![...room.players.values()].some(p => !p.isBot)) {
      rooms.delete(room.code);
    } else {
      emitRoom(room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`어윤호의 드래곤볼 running on ${PORT}`);
});
