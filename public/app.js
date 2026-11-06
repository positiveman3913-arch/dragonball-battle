
const socket = io();
const $ = id => document.getElementById(id);

let myId = null;
let room = null;
let myChoice = null;

const names = {
  charge: "아 (기 모으기)",
  guard: "막 (방어)",
  pa: "파",
  e: "에",
  blink: "순 (순간이동)",
  blinkpa: "순파",
  genki: "원기옥"
};

const costs = {
  charge: 0,
  guard: 0,
  pa: 1,
  e: 3,
  blink: 1,
  blinkpa: 2,
  genki: 5
};

// ==========================================
// SOCKET
// ==========================================

socket.on("connect", () => {
  $("connection").textContent = "서버 연결됨";
});

socket.on("disconnect", () => {
  $("connection").textContent = "연결 끊김";
});

socket.on("connect_error", err => {
  $("connection").textContent = "연결 오류";
  console.error(err);
});

socket.on("room:update", data => {
  room = data;
  render();
});

socket.on("game:all-ready", () => {
  $("status").textContent = "모두 선택 완료! 결과를 공개하세요.";
});

socket.on("chat:message", addMessage);

// ==========================================
// SOCKET ACK
// ==========================================

function emitAck(event, data = {}) {
  return new Promise(resolve => {
    socket.timeout(7000).emit(event, data, (err, response) => {
      if (err) {
        resolve({
          ok: false,
          error: "서버 응답이 없습니다. 페이지를 새로고침해 주세요."
        });
      } else {
        resolve(response || {
          ok: false,
          error: "서버 응답이 비어 있습니다."
        });
      }
    });
  });
}

// ==========================================
// ROOM ENTRY
// ==========================================

function enter(data) {
  myId = data.id;

  $("entry").classList.add("hidden");
  $("game").classList.remove("hidden");

  $("roomCodeLabel").textContent = data.code;
}

async function createRoom(eventName) {
  const res = await emitAck(eventName, {
    name: $("name").value,
    character: $("character").value
  });

  if (res.ok) {
    enter(res);
  } else {
    alert(res.error || "방 생성 실패");
  }
}

$("create").onclick = () => createRoom("room:create");

const soloButton = $("createSolo");

if (soloButton) {
  soloButton.onclick = () => createRoom("room:createSolo");
}

$("join").onclick = async () => {
  const res = await emitAck("room:join", {
    code: $("roomCode").value,
    name: $("name").value,
    character: $("character").value
  });

  if (!res.ok) {
    return alert(res.error);
  }

  enter(res);
};

// ==========================================
// ROOM CONTROLS
// ==========================================

$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(room.code);
    $("copy").textContent = "복사 완료!";
  } catch {
    alert("방 코드: " + room.code);
  }

  setTimeout(() => {
    $("copy").textContent = "초대 코드 복사";
  }, 1300);
};

$("start").onclick = async () => {
  const r = await emitAck("game:start");
  if (!r.ok) alert(r.error);
};

$("reveal").onclick = async () => {
  const r = await emitAck("game:reveal");
  if (!r.ok) alert(r.error);
};

$("force").onclick = () => $("reveal").click();

$("next").onclick = async () => {
  const r = await emitAck("game:next");
  if (!r.ok) alert(r.error);
};

$("restart").onclick = async () => {
  const r = await emitAck("game:restart");
  if (!r.ok) alert(r.error);
};

// ==========================================
// CHOICE
// ==========================================

$("cancelChoice").onclick = () => {
  myChoice = null;
  $("selectionText").textContent = "선택하지 않음";
};

$("target").onchange = () => updateChoiceTarget();

function updateChoiceTarget() {
  if (!myChoice) return;

  myChoice.targetId = $("target").value;

  const target = room.players.find(
    p => p.id === myChoice.targetId
  );

  $("selectionText").textContent =
    `${names[myChoice.action]} → ${target?.name || "대상 선택"}`;
}

document.querySelectorAll("[data-action]").forEach(btn => {
  btn.onclick = async () => {
    const action = btn.dataset.action;

    const me = room?.players.find(p => p.id === myId);

    if (!me || !me.alive) return;

    if (me.ki < costs[action]) {
      return alert("기력이 부족합니다.");
    }

    let targetId = null;

    if (["pa", "e", "blinkpa"].includes(action)) {
      targetId = $("target").value;

      if (!targetId) {
        return alert("공격 대상을 선택해 주세요.");
      }
    }

    const res = await emitAck("game:choose", {
      action,
      targetId
    });

    if (!res.ok) {
      return alert(res.error);
    }

    myChoice = { action, targetId };

    $("selectionText").textContent =
      action === "genki"
        ? "☄️ 원기옥 발동 대기"
        : names[action] +
          (targetId
            ? " → " + room.players.find(p => p.id === targetId)?.name
            : "");

    $("status").textContent =
      "선택 완료. 결과 공개를 기다리는 중입니다.";
  };
});

// ==========================================
// CHAT
// ==========================================

$("chatForm").addEventListener("submit", async e => {
  e.preventDefault();

  const input = $("chatInput");
  const message = input.value.trim();

  if (!message) return;

  const button = $("chatForm").querySelector("button");
  button.disabled = true;

  const res = await emitAck("chat:send", { message });

  button.disabled = false;

  if (res.ok) {
    input.value = "";
  } else {
    alert(res.error || "채팅 전송에 실패했습니다.");
  }
});

function addMessage(m) {
  const box = $("messages");

  box.querySelector(".empty")?.remove();

  const div = document.createElement("div");
  div.className = "message";

  const time = new Date(m.time).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit"
  });

  const strong = document.createElement("strong");
  strong.textContent = m.name;

  const tm = document.createElement("time");
  tm.textContent = time;

  const p = document.createElement("p");
  p.textContent = m.message;

  div.append(strong, tm, p);
  box.append(div);

  box.scrollTop = box.scrollHeight;
}

// ==========================================
// GAME RENDER
// ==========================================

function render() {
  if (!room) return;

  $("roomCodeLabel").textContent = room.code;

  $("roundLabel").textContent =
    room.phase === "playing" || room.phase === "reveal"
      ? "ROUND " + room.round
      : room.phase.toUpperCase();

  const host = room.hostId === myId;
  const me = room.players.find(p => p.id === myId);

  $("players").innerHTML = "";

  room.players.forEach(p => {
    const card = document.createElement("div");

    card.className =
      "player" +
      (!p.alive ? " dead" : "") +
      (p.id === room.hostId ? " host" : "");

    const n = document.createElement("strong");

    n.textContent =
      (p.id === room.hostId ? "👑 " : "") +
      (p.isBot ? "🤖 " : "") +
      p.name;

    const meta = document.createElement("div");
    meta.className = "meta";

    meta.textContent =
      `기 ${p.ki} · ${p.alive ? "생존" : "아웃"}` +
      (p.ready ? " · 선택 완료" : "");

    card.append(n, meta);
    $("players").append(card);
  });

  $("lobbyActions").classList.toggle(
    "hidden",
    room.phase !== "lobby"
  );

  $("start").classList.toggle("hidden", !host);

  $("battle").classList.toggle(
    "hidden",
    room.phase !== "playing"
  );

  $("revealPanel").classList.toggle(
    "hidden",
    !["reveal", "finished"].includes(room.phase)
  );

  $("hostControls").classList.toggle(
    "hidden",
    !host || room.phase !== "playing"
  );

  $("phaseTitle").textContent = ({
    lobby: "대기실",
    playing: "전투 진행",
    reveal: "결과 공개",
    finished: "게임 종료"
  })[room.phase];

  if (room.phase === "playing" && me) {
    $("kiValue").textContent = `${me.ki} / 5`;

    $("kiBar").style.width =
      (me.ki / 5 * 100) + "%";

    $("status").textContent = me.alive
      ? "기술을 선택하세요."
      : "아웃되었습니다. 관전 중입니다.";

    $("target").innerHTML = "";

    room.players
      .filter(p => p.alive && p.id !== myId)
      .forEach(p => {
        const option = document.createElement("option");
        option.value = p.id;
        option.textContent = p.name;
        $("target").append(option);
      });

    $("targetWrap").classList.toggle("hidden", !me.alive);
    $("target").disabled = !me.alive;

    document.querySelectorAll("[data-action]").forEach(button => {
      button.disabled =
        !me.alive || me.ki < costs[button.dataset.action];
    });
  }

  if (room.phase === "reveal" || room.phase === "finished") {
    $("resultLines").innerHTML = "";

    (room.choices?.lines || []).forEach(line => {
      const div = document.createElement("div");
      div.className = "result-line";
      div.textContent = line;
      $("resultLines").append(div);
    });

    if (room.phase === "finished") {
      const winner = room.players.find(
        p => p.id === room.winnerId
      );

      const div = document.createElement("div");
      div.className = "winner";

      div.textContent = winner
        ? `🏆 최종 승리: ${winner.name}`
        : "무승부";

      $("resultLines").prepend(div);
    }

    $("next").classList.toggle(
      "hidden",
      !host || room.phase !== "reveal"
    );

    $("restart").classList.toggle(
      "hidden",
      !host || room.phase !== "finished"
    );
  }
}

// ==========================================
// COMPACT LOCAL MP3 BGM
// ==========================================

(() => {
  const audio = $("bgmAudio");
  const toggle = $("bgmToggle");
  const mute = $("bgmMute");

  if (!audio || !toggle || !mute) return;

  audio.volume = 0.35;
  audio.loop = true;

  function update() {
    const playing = !audio.paused;

    toggle.textContent = playing ? "Ⅱ" : "▶";

    toggle.setAttribute(
      "aria-label",
      playing ? "배경 음악 일시정지" : "배경 음악 재생"
    );

    toggle.title = playing ? "일시정지" : "재생";

    mute.textContent = audio.muted ? "×" : "♪";

    mute.setAttribute(
      "aria-label",
      audio.muted ? "음소거 해제" : "음소거"
    );

    mute.title = audio.muted ? "음소거 해제" : "음소거";
  }

  toggle.addEventListener("click", async () => {
    if (audio.paused) {
      try {
        await audio.play();
      } catch (error) {
        console.warn("BGM 재생 실패:", error);
      }
    } else {
      audio.pause();
    }

    update();
  });

  mute.addEventListener("click", () => {
    audio.muted = !audio.muted;
    update();
  });

  audio.addEventListener("play", update);
  audio.addEventListener("pause", update);
  audio.addEventListener("volumechange", update);

  update();
})();
