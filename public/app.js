
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
// DRAGON BALL ORIGINAL GAME BGM
// Web Audio API - No external audio file
// ==========================================

(() => {

  if (window.__gameBgmInstalled) return;
  window.__gameBgmInstalled = true;

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    console.warn("Web Audio API is not supported.");
    return;
  }

  const BPM = 128;
  const BEAT = 60 / BPM;

  // 16 steps per 4-beat bar
  const STEP = BEAT / 4;
  const BAR = BEAT * 4;

  let ctx = null;
  let master = null;
  let playing = false;
  let nextStepTime = 0;
  let stepIndex = 0;
  let scheduler = null;

  const initialVolume = 0.30;

  // G - D - Em - C progression
  const chords = [
    [55, 59, 62, 67],
    [50, 54, 57, 62],
    [52, 55, 59, 64],
    [48, 52, 55, 60]
  ];

  // Original bright anime-opening style melody
  const melody = [
    79, 81, 83, 86, 83, 81, 79, 74,
    76, 79, 81, 83, 81, 79, 76, 74,

    78, 81, 86, 85, 83, 81, 78, 74,
    76, 78, 81, 83, 86, 83, 81, 79,

    83, 86, 88, 86, 83, 81, 79, 76,
    79, 81, 83, 86, 88, 86, 83, 81,

    79, 83, 86, 88, 86, 83, 81, 79,
    76, 79, 81, 83, 81, 79, 76, 74
  ];

  function midiToFreq(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  // Initialize audio
  function setupAudio() {
    if (ctx) return;

    ctx = new AudioContextClass();

    master = ctx.createGain();
    master.gain.value = initialVolume;
    master.connect(ctx.destination);
  }

  // Synthesizer tone
  function tone(freq, time, duration, type, gain, detune = 0) {

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    osc.detune.value = detune;

    amp.gain.setValueAtTime(0.001, time);
    amp.gain.linearRampToValueAtTime(gain, time + 0.015);

    amp.gain.exponentialRampToValueAtTime(
      0.001,
      time + duration
    );

    osc.connect(amp);
    amp.connect(master);

    osc.start(time);
    osc.stop(time + duration + 0.03);
  }

  // Kick drum
  function kick(time) {

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = "sine";

    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.13);

    amp.gain.setValueAtTime(0.65, time);
    amp.gain.exponentialRampToValueAtTime(0.001, time + 0.16);

    osc.connect(amp);
    amp.connect(master);

    osc.start(time);
    osc.stop(time + 0.18);
  }

  // Noise percussion
  function noise(time, duration, gain) {

    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();

    source.buffer = buffer;

    filter.type = "highpass";
    filter.frequency.value = 4500;

    amp.gain.setValueAtTime(gain, time);

    amp.gain.exponentialRampToValueAtTime(
      0.001,
      time + duration
    );

    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);

    source.start(time);
    source.stop(time + duration);
  }

  // Play one 16th-note step
  function playStep(index, time) {

    const stepInBar = index % 16;
    const bar = Math.floor(index / 16) % 4;
    const chord = chords[bar];

    // Drums: kick and snare
    if (stepInBar === 0 || stepInBar === 8) {
      kick(time);
    }

    if (stepInBar === 4 || stepInBar === 12) {
      noise(time, 0.16, 0.20);
    }

    // Hi-hat
    if (stepInBar % 2 === 0) {
      noise(time, 0.045, 0.055);
    }

    // Bass
    if (stepInBar % 2 === 0) {
      const bassNote = chord[0] - 24;

      tone(
        midiToFreq(bassNote),
        time,
        0.19,
        "triangle",
        0.20
      );
    }

    // Arpeggio
    const arpIndex = Math.floor(stepInBar / 2) % 4;
    const arpNote = chord[arpIndex] + 12;

    tone(
      midiToFreq(arpNote),
      time,
      0.17,
      "sawtooth",
      0.045,
      4
    );

    // Lead melody
    const note = melody[index % melody.length];

    if (stepInBar % 2 === 0) {
      tone(
        midiToFreq(note),
        time,
        0.30,
        "square",
        0.045
      );
    }

    // Chord pad
    if (stepInBar === 0) {

      chord.forEach(n => {
        tone(
          midiToFreq(n + 12),
          time,
          BAR * 0.85,
          "triangle",
          0.035
        );
      });
    }
  }

  // Schedule audio ahead of time
  function schedulerTick() {

    if (!ctx || !playing) return;

    const horizon = ctx.currentTime + 0.15;

    while (nextStepTime < horizon) {

      playStep(stepIndex, nextStepTime);

      nextStepTime += STEP;
      stepIndex++;
    }
  }

  // Start music
  async function startMusic() {

    setupAudio();

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (playing) return;

    playing = true;
    nextStepTime = ctx.currentTime + 0.05;

    scheduler = setInterval(schedulerTick, 25);

    updateButton();
  }

  // Stop music
  function stopMusic() {

    playing = false;

    if (scheduler) {
      clearInterval(scheduler);
      scheduler = null;
    }

    updateButton();
  }

  // Update button text
  function updateButton() {

    const btn = document.getElementById("bgmToggle");

    if (btn) {
      btn.textContent = playing
        ? "⏸ 음악 끄기"
        : "▶ 음악 켜기";
    }
  }

  // Create music controls
  function createControls() {

    if (document.getElementById("bgmControl")) return;

    const panel = document.createElement("div");

    panel.id = "bgmControl";

    panel.innerHTML = `
      <button id="bgmToggle" type="button">
        ▶ 음악 켜기
      </button>

      <input
        id="bgmVolume"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value="0.30"
        aria-label="음악 음량"
      >
    `;

    Object.assign(panel.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "99999",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "10px 14px",
      borderRadius: "30px",
      background: "rgba(8,15,39,0.92)",
      border: "1px solid rgba(255,210,90,0.7)",
      boxShadow: "0 4px 20px rgba(0,0,0,0.35)"
    });

    document.body.appendChild(panel);

    const btn = document.getElementById("bgmToggle");
    const slider = document.getElementById("bgmVolume");

    btn.style.cssText =
      "border:0;border-radius:20px;padding:8px 12px;" +
      "background:#ffc45d;color:#151515;" +
      "font-weight:bold;cursor:pointer;";

    slider.style.accentColor = "#ffc45d";
    slider.style.width = "85px";

    // Play / pause
    btn.addEventListener("click", async () => {

      if (playing) {
        stopMusic();
      } else {
        await startMusic();
      }

    });

    // Volume control
    slider.addEventListener("input", () => {

      setupAudio();

      master.gain.setTargetAtTime(
        Number(slider.value),
        ctx.currentTime,
        0.05
      );

      if (Number(slider.value) > 0 && !playing) {
        startMusic();
      }

      if (Number(slider.value) === 0 && playing) {
        stopMusic();
      }

    });
  }

  // Create controls after page load
  if (document.readyState === "loading") {

    document.addEventListener(
      "DOMContentLoaded",
      createControls
    );

  } else {

    createControls();

  }

  // Start after first user interaction
  // Required by browser autoplay policy
  const unlock = async () => {

    if (!playing) {
      await startMusic();
    }

    document.removeEventListener("pointerdown", unlock);
    document.removeEventListener("keydown", unlock);

  };

  document.addEventListener("pointerdown", unlock);
  document.addEventListener("keydown", unlock);

})();
