const socket = io();
const $ = id => document.getElementById(id);
let myId = null, room = null, myChoice = null, isSpectator = false;
const names = {charge:"아 (기 모으기)",guard:"막 (방어)",pa:"파",e:"에",blink:"순 (순간이동)",blinkpa:"순파",genki:"원기옥"};
const costs = {charge:0,guard:0,pa:1,e:3,blink:1,blinkpa:2,genki:5};

socket.on("connect", () => $("connection").textContent = "서버 연결됨");
socket.on("disconnect", () => $("connection").textContent = "연결 끊김");
socket.on("room:update", data => { room = data; render(); });
socket.on("game:all-ready", () => { $("status").textContent = "모두 선택 완료! 호스트가 결과를 공개할 수 있습니다."; });
socket.on("chat:message", m => addMessage(m));

function emitAck(event, data={}) {
  return new Promise(resolve => socket.emit(event, data, resolve));
}
function enter(data) {
  myId = data.id; isSpectator = false;
  $("entry").classList.add("hidden"); $("game").classList.remove("hidden");
  $("roomCodeLabel").textContent = data.code;
}
$("create").onclick = async () => {
  const res = await emitAck("room:create",{name:$("name").value,character:$("character").value});
  if(res.ok) enter(res);
};
$("join").onclick = async () => {
  const res = await emitAck("room:join",{code:$("roomCode").value,name:$("name").value,character:$("character").value});
  if(!res.ok) return alert(res.error);
  enter(res);
};
$("copy").onclick = async () => {
  await navigator.clipboard?.writeText(room.code);
  $("copy").textContent = "복사 완료!";
  setTimeout(()=>$("copy").textContent="초대 코드 복사",1300);
};
$("start").onclick = async () => { const r=await emitAck("game:start"); if(!r.ok) alert(r.error); };
$("reveal").onclick = async () => { const r=await emitAck("game:reveal"); if(!r.ok) alert(r.error); };
$("force").onclick = () => $("reveal").click();
$("next").onclick = async () => { const r=await emitAck("game:next"); if(!r.ok) alert(r.error); };
$("restart").onclick = async () => { const r=await emitAck("game:restart"); if(!r.ok) alert(r.error); };
$("cancelChoice").onclick = () => { myChoice=null; $("selectionText").textContent="선택하지 않음"; };
$("target").onchange = () => updateChoiceTarget();

function updateChoiceTarget() {
  if (!myChoice) return;
  myChoice.targetId = $("target").value;
  $("selectionText").textContent = `${names[myChoice.action]} → ${room.players.find(p=>p.id===myChoice.targetId)?.name || "대상 선택"}`;
}
document.querySelectorAll("[data-action]").forEach(btn => btn.onclick = async () => {
  const action=btn.dataset.action;
  const me=room?.players.find(p=>p.id===myId);
  if(!me || !me.alive || me.spectator) return;
  if(me.ki < costs[action]) return alert("기력이 부족합니다.");
  let targetId=null;
  if(["pa","e","blinkpa"].includes(action)) {
    targetId=$("target").value;
    if(!targetId) return alert("공격 대상을 선택해 주세요.");
  }
  const res=await emitAck("game:choose",{action,targetId});
  if(!res.ok) return alert(res.error);
  myChoice={action,targetId};
  $("selectionText").textContent=action==="genki"?"☄️ 원기옥 발동 대기":names[action]+(targetId?" → "+room.players.find(p=>p.id===targetId)?.name:"");
  $("status").textContent="선택 완료. 다른 플레이어를 기다리는 중입니다.";
});
$("chatForm").onsubmit = async e => {
  e.preventDefault();
  const message=$("chatInput").value.trim();
  if(!message) return;
  const r=await emitAck("chat:send",{message});
  if(r.ok) $("chatInput").value="";
};
function addMessage(m) {
  const box=$("messages");
  box.querySelector(".empty")?.remove();
  const div=document.createElement("div"); div.className="message";
  const time=new Date(m.time).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"});
  const strong=document.createElement("strong"); strong.textContent=m.name;
  const tm=document.createElement("time"); tm.textContent=time;
  const p=document.createElement("p"); p.textContent=m.message;
  div.append(strong,tm,p); box.append(div); box.scrollTop=box.scrollHeight;
}
function render() {
  if(!room) return;
  $("roomCodeLabel").textContent=room.code;
  $("roundLabel").textContent=room.phase==="playing"||room.phase==="reveal"?"ROUND "+room.round:room.phase.toUpperCase();
  const host=room.hostId===myId, me=room.players.find(p=>p.id===myId);
  $("players").innerHTML="";
  room.players.forEach(p=>{
    const card=document.createElement("div"); card.className="player"+(!p.alive?" dead":"")+(p.id===room.hostId?" host":"");
    const n=document.createElement("strong"); n.textContent=(p.id===room.hostId?"👑 ":"")+p.name;
    const meta=document.createElement("div"); meta.className="meta"; meta.textContent=`기 ${p.ki} · ${p.alive?"생존":"아웃"}${p.ready?" · 선택 완료":""}`;
    card.append(n,meta); $("players").append(card);
  });
  $("lobbyActions").classList.toggle("hidden",room.phase!=="lobby");
  $("start").classList.toggle("hidden",!host);
  $("battle").classList.toggle("hidden",room.phase!=="playing");
  $("revealPanel").classList.toggle("hidden",!["reveal","finished"].includes(room.phase));
  $("hostControls").classList.toggle("hidden",!host||room.phase!=="playing");
  $("phaseTitle").textContent=({lobby:"대기실",playing:"전투 진행",reveal:"결과 공개",finished:"게임 종료"})[room.phase];
  if(room.phase==="playing" && me) {
    $("kiValue").textContent=`${me.ki} / 5`; $("kiBar").style.width=(me.ki/5*100)+"%";
    $("genkiButton").disabled=me.ki<5 || !me.alive;
    $("status").textContent=me.alive?"기술을 선택하세요.":"아웃되었습니다. 관전 중입니다.";
    $("target").innerHTML="";
    room.players.filter(p=>p.alive&&p.id!==myId).forEach(p=>{const o=document.createElement("option");o.value=p.id;o.textContent=p.name;$("target").append(o)});
    $("targetWrap").classList.toggle("hidden",!me.alive);
    $("target").disabled=!me.alive;
    document.querySelectorAll("[data-action]").forEach(b=>b.disabled=!me.alive || (me.ki<costs[b.dataset.action]));
  }
  if(room.phase==="reveal"||room.phase==="finished") {
    $("resultLines").innerHTML="";
    (room.choices?.lines||[]).forEach(line=>{const d=document.createElement("div");d.className="result-line";d.textContent=line;$("resultLines").append(d)});
    if(room.phase==="finished") {
      const winner=room.players.find(p=>p.id===room.winnerId);
      const d=document.createElement("div");d.className="winner";d.textContent=winner?`🏆 최종 승리: ${winner.name}`:"무승부";$("resultLines").prepend(d);
    }
    $("next").classList.toggle("hidden",!host||room.phase!=="reveal");
    $("restart").classList.toggle("hidden",!host||room.phase!=="finished");
  }
}
