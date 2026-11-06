
const socket = io();
const $ = id => document.getElementById(id);

let myId = null;
let room = null;

const costs = {
  charge: 0, guard: 0, pa: 1,
  e: 3, blink: 1, blinkpa: 2, genki: 5
};

const names = {
  charge: "아", guard: "막", pa: "파",
  e: "에", blink: "순", blinkpa: "순파",
  genki: "원기옥"
};

// ==========================================
// SOCKET CONNECTION
// ==========================================

socket.on("connect", () => {
  $("connection").textContent = "서버 연결됨";
});

socket.on("disconnect", () => {
  $("connection").textContent = "연결 끊김";
});

socket.on("room:update", data => {
  room = data;
  render();
});

socket.on("game:all-ready", () => {
  $("status").textContent = "모두 선택 완료!";
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
          error: "서버 응답이 없습니다. 새로고침해 주세요."
        });
      } else {
        resolve(response || {
          ok: false,
          error: "서버 응답 오류"
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

  if (res.ok) enter(res);
  else alert(res.error);
}

$("create").onclick = () => createRoom("room:create");

$("createSolo").onclick = () => {
  createRoom("room:createSolo");
};

$("join").onclick = async () => {
  const res = await emitAck("room:join", {
    code: $("roomCode").value,
    name: $("name").value,
    character: $("character").value
  });

  if (!res.ok) return alert(res.error);
  enter(res);
};

// ==========================================
// ROOM CONTROLS
// ==========================================

$("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(room.code);
    alert("초대 코드 복사 완료!");
  } catch {
    alert("방 코드: " + room.code);
  }
};

$("start").onclick = async () => {
  const r = await emitAck("game:start");
  if (!r.ok) alert(r.error);
};

$("reveal").onclick = async () => {
  const r = await emitAck("game:reveal");
  if (!r.ok) alert(r.error);
};

$("next").onclick = async () => {
  const r = await emitAck("game:next");
  if (!r.ok) alert(r.error);
};

$("restart").onclick = async () => {
  const r = await emitAck("game:restart");
  if (!r.ok) alert(r.error);
};

$("force").onclick = () => $("reveal").click();

// ==========================================
// CHAT
// ==========================================

$("chatForm").onsubmit = async e => {
  e.preventDefault();

  const input = $("chatInput");
  const message = input.value.trim();

  if (!message) return;

  const result = await emitAck("chat:send", { message });

  if (result.ok) {
    input.value = "";
  } else {
    alert(result.error);
  }
};

function addMessage(m) {
  const box = $("messages");
  box.querySelector(".empty")?.remove();

  const div = document.createElement("div");
  div.className = "message";

  const name = document.createElement("strong");
  name.textContent = m.name;

  const text = document.createElement("p");
  text.textContent = m.message;

  const time = document.createElement("time");
  time.textContent = new Date(m.time).toLocaleTimeString("ko-KR");

  div.append(name, time, text);
  box.append(div);
  box.scrollTop = box.scrollHeight;
}

// ==========================================
// BATTLE ACTIONS
// ==========================================

document.querySelectorAll("[data-action]").forEach(button => {
  button.onclick = async () => {
    const action = button.dataset.action;
    const me = room?.players.find(p => p.id === myId);

    if (!me || !me.alive) return;

    if (me.ki < costs[action]) {
      return alert("기력이 부족합니다.");
    }

    let targetId = null;

    if (["pa", "e", "blinkpa"].includes(action)) {
      targetId = $("target").value;

      if (!targetId) {
        return alert("공격 대상을 선택하세요.");
      }
    }

    const result = await emitAck("game:choose", {
      action,
      targetId
    });

    if (!result.ok) return alert(result.error);

    $("selectionText").textContent =
      names[action] + (action === "genki" ? " 발동 대기" : " 선택 완료");

    $("status").textContent = "선택 완료!";
  };
});

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
    card.className = "player" + (!p.alive ? " dead" : "");

    const name = document.createElement("strong");
    name.textContent =
      (p.isBot ? "🤖 " : "") +
      (p.id === room.hostId ? "👑 " : "") +
      p.name;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `기 ${p.ki} · ${p.alive ? "생존" : "아웃"}`;

    card.append(name, meta);
    $("players").append(card);
  });

  $("lobbyActions").classList.toggle("hidden", room.phase !== "lobby");
  $("start").classList.toggle("hidden", !host);
  $("battle").classList.toggle("hidden", room.phase !== "playing");

  $("revealPanel").classList.toggle(
    "hidden",
    !["reveal", "finished"].includes(room.phase)
  );

  $("hostControls").classList.toggle(
    "hidden",
    !host || room.phase !== "playing"
  );

  if (room.phase === "playing" && me) {
    $("kiValue").textContent = `${me.ki} / 5`;
    $("kiBar").style.width = `${me.ki * 20}%`;

    $("genkiButton").disabled = me.ki < 5 || !me.alive;

    $("target").innerHTML = "";

    room.players
      .filter(p => p.alive && p.id !== myId)
      .forEach(p => {
        const option = document.createElement("option");
        option.value = p.id;
        option.textContent = p.name;
        $("target").append(option);
      });

    document.querySelectorAll("[data-action]").forEach(button => {
      button.disabled = !me.alive || me.ki < costs[button.dataset.action];
    });
  }

  if (["reveal", "finished"].includes(room.phase)) {
    $("resultLines").innerHTML = "";

    (room.choices?.lines || []).forEach(line => {
      const div = document.createElement("div");
      div.className = "result-line";
      div.textContent = line;
      $("resultLines").append(div);
    });

    if (room.phase === "finished") {
      const winner = room.players.find(p => p.id === room.winnerId);
      const div = document.createElement("div");
      div.className = "winner";
      div.textContent = winner
        ? `🏆 최종 승리: ${winner.name}`
        : "무승부";
      $("resultLines").prepend(div);
    }

    $("next").classList.toggle("hidden", !host || room.phase !== "reveal");
    $("restart").classList.toggle("hidden", !host || room.phase !== "finished");
  }
}

// ==========================================
// YOUTUBE BGM
// Video ID: RWQ-jvnzvhM
// Official YouTube IFrame Player
// ==========================================

(() => {
  if (window.__youtubeBgmInstalled) return;
  window.__youtubeBgmInstalled = true;

  let player = null;
  let playerReady = false;

  function createBgmUI() {
    if (document.getElementById("youtubeBgmControl")) return;

    const panel = document.createElement("div");
    panel.id = "youtubeBgmControl";

    panel.innerHTML = `
      <button id="youtubeBgmToggle" type="button">
        ▶ BGM 재생
      </button>
      <div id="youtubeBgmPlayer"></div>
    `;

    panel.style.cssText = `
      position:fixed;
      right:15px;
      bottom:15px;
      z-index:999999;
      padding:10px;
      border-radius:15px;
      background:rgba(8,15,39,.95);
      border:1px solid #ffc45d;
      box-shadow:0 4px 18px rgba(0,0,0,.4);
      color:white;
      width:220px;
    `;

    const style = document.createElement("style");
    style.textContent = `
      #youtubeBgmToggle {
        width:100%;
        border:0;
        border-radius:20px;
        padding:10px;
        background:#ffc45d;
        color:#151515;
        font-weight:bold;
        cursor:pointer;
      }

      #youtubeBgmPlayer {
        width:200px;
        height:113px;
        margin:10px auto 0;
        overflow:hidden;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    document.getElementById("youtubeBgmToggle")
      .addEventListener("click", async () => {
        if (!playerReady) {
          alert("유튜브 플레이어를 불러오는 중입니다. 잠시 후 다시 눌러주세요.");
          return;
        }

        try {
          const state = player.getPlayerState();

          if (state === YT.PlayerState.PLAYING) {
            player.pauseVideo();
          } else {
            player.playVideo();
          }
        } catch (error) {
          console.error("YouTube BGM error:", error);
        }
      });
  }

  function updateButton() {
    const button = document.getElementById("youtubeBgmToggle");
    if (!button || !playerReady) return;

    const state = player.getPlayerState();

    button.textContent =
      state === YT.PlayerState.PLAYING
        ? "⏸ BGM 일시정지"
        : "▶ BGM 재생";
  }

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player("youtubeBgmPlayer", {
      width: "200",
      height: "113",
      videoId: "RWQ-jvnzvhM",
      playerVars: {
        autoplay: 0,
        controls: 1,
        playsinline: 1,
        rel: 0
      },
      events: {
        onReady: () => {
          playerReady = true;
          updateButton();
        },
        onStateChange: updateButton,
        onError: event => {
          console.error("YouTube player error:", event.data);
          alert("이 유튜브 영상은 임베드 재생이 제한되어 있을 수 있습니다.");
        }
      }
    });
  };

  createBgmUI();

  if (!window.YT || !window.YT.Player) {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  } else {
    window.onYouTubeIframeAPIReady();
  }
})();
