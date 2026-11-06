
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

    $("restart").classList.toggle(
      "hidden",
      !host || room.phase !== "finished"
    );
  }
}

// ==========================================
// DRAGON BALL BGM
// Web Audio API - NO EXTERNAL FILE
// ==========================================

(() => {

  if (window.__gameBgmInstalled) return;
  window.__gameBgmInstalled = true;

  const AudioClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioClass) {
    console.error("이 브라우저는 Web Audio API를 지원하지 않습니다.");
    return;
  }

  let audio = null;
  let master = null;
  let timer = null;
  let playing = false;
  let step = 0;
  let nextTime = 0;

  const BPM = 120;
  const BEAT = 60 / BPM;
  const STEP = BEAT / 2;

  // Original melody
  const melody = [
    67, 71, 74, 79, 76, 74, 71, 67,
    69, 72, 76, 81, 79, 76, 72, 69,
    71, 74, 79, 83, 81, 79, 74, 71,
    72, 76, 79, 84, 83, 79, 76, 72,

    74, 79, 83, 86, 83, 79, 74, 71,
    72, 76, 81, 84, 81, 76, 72, 69,
    71, 74, 79, 83, 86, 83, 79, 74,
    67, 71, 74, 79, 76, 74, 71, 67
  ];

  const bass = [43, 38, 40, 36];

  const chords = [
    [55, 59, 62],
    [50, 54, 57],
    [52, 55, 59],
    [48, 52, 55]
  ];

  function initAudio() {
    if (audio) return;

    audio = new AudioClass();

    master = audio.createGain();
    master.gain.value = 0.45;
    master.connect(audio.destination);
  }

  function frequency(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  function playNote(note, time, duration, type, volume) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency(note), time);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      time + duration
    );

    osc.connect(gain);
    gain.connect(master);

    osc.start(time);
    osc.stop(time + duration + 0.03);
  }

  function kick(time) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.15);

    gain.gain.setValueAtTime(0.65, time);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      time + 0.18
    );

    osc.connect(gain);
    gain.connect(master);

    osc.start(time);
    osc.stop(time + 0.2);
  }

  function percussion(time, duration, volume) {
    const length = Math.floor(audio.sampleRate * duration);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    source.buffer = buffer;
    filter.type = "highpass";
    filter.frequency.value = 3000;

    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      time + duration
    );

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    source.start(time);
    source.stop(time + duration);
  }

  function playStep() {
    const position = step % 16;
    const bar = Math.floor(step / 16) % 4;

    // Kick
    if (position === 0 || position === 8) {
      kick(nextTime);
    }

    // Snare
    if (position === 4 || position === 12) {
      percussion(nextTime, 0.15, 0.20);
    }

    // Hi-hat
    if (position % 2 === 0) {
      percussion(nextTime, 0.045, 0.07);
    }

    // Bass
    if (position % 2 === 0) {
      playNote(
        bass[bar],
        nextTime,
        0.22,
        "triangle",
        0.25
      );
    }

    // Lead melody
    if (position % 2 === 0) {
      playNote(
        melody[step % melody.length],
        nextTime,
        0.30,
        "sawtooth",
        0.14
      );
    }

    // Chords
    if (position === 0) {
      chords[bar].forEach(note => {
        playNote(
          note + 12,
          nextTime,
          BEAT * 3,
          "triangle",
          0.06
        );
      });
    }

    step++;
    nextTime += STEP;
  }

  function schedule() {
    if (!playing || !audio) return;

    while (nextTime < audio.currentTime + 0.15) {
      playStep();
    }
  }

  async function startMusic() {
    initAudio();

    if (audio.state !== "running") {
      await audio.resume();
    }

    if (playing) return;

    playing = true;
    nextTime = audio.currentTime + 0.05;

    timer = setInterval(schedule, 25);

    updateButton();
  }

  function stopMusic() {
    playing = false;

    if (timer) {
      clearInterval(timer);
      timer = null;
    }

    updateButton();
  }

  function updateButton() {
    const button = document.getElementById("bgmToggle");

    if (button) {
      button.textContent = playing
        ? "⏸ 음악 끄기"
        : "▶ 음악 켜기";
    }
  }

  function createControls() {
    if (document.getElementById("bgmControl")) return;

    const panel = document.createElement("div");
    panel.id = "bgmControl";

    panel.style.cssText = `
      position:fixed;
      right:16px;
      bottom:16px;
      z-index:999999;
      display:flex;
      align-items:center;
      gap:10px;
      padding:10px 14px;
      border:1px solid rgba(255,210,90,.7);
      border-radius:30px;
      background:rgba(8,15,39,.95);
      box-shadow:0 4px 20px rgba(0,0,0,.35);
    `;

    panel.innerHTML = `
      <button id="bgmToggle" type="button"
        style="
          border:0;
          border-radius:20px;
          padding:9px 14px;
          background:#ffc45d;
          color:#151515;
          font-weight:bold;
          cursor:pointer;
        ">
        ▶ 음악 켜기
      </button>

      <input id="bgmVolume"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value="0.45"
        aria-label="배경음악 음량"
        style="width:85px;accent-color:#ffc45d;">
    `;

    document.body.appendChild(panel);

    const button = document.getElementById("bgmToggle");
    const slider = document.getElementById("bgmVolume");

    button.addEventListener("click", async () => {
      try {
        if (playing) {
          stopMusic();
        } else {
          await startMusic();
        }
      } catch (error) {
        console.error("BGM 재생 오류:", error);
        alert("음악 재생 실패: " + error.message);
      }
    });

    slider.addEventListener("input", () => {
      initAudio();

      master.gain.setTargetAtTime(
        Number(slider.value),
        audio.currentTime,
        0.05
      );
    });
  }

  // Controls are created after the DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createControls);
  } else {
    createControls();
  }

})();
