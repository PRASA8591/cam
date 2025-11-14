// sender.js
// Uses Firebase compat SDK (included in HTML).
const firebaseConfig = {
  apiKey: "AIzaSyA6C0obBf1DhLGqeslZervMQhYTAnhJNz0",
  authDomain: "camera-a8909.firebaseapp.com",
  projectId: "camera-a8909",
  storageBucket: "camera-a8909.firebasestorage.app",
  messagingSenderId: "684343813628",
  appId: "1:684343813628:web:218292a6173fbe9c1dfe79",
  measurementId: "G-LDDDKW79JY"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// UI refs
const startShareBtn = document.getElementById('startShare');
const stopShareBtn = document.getElementById('stopShare');
const shareVideoChk = document.getElementById('shareVideo');
const shareAudioChk = document.getElementById('shareAudio');
const sessionCodeEl = document.getElementById('sessionCode');
const localVideo = document.getElementById('localVideo');
const senderStatus = document.getElementById('senderStatus');

const confirmModal = document.getElementById('confirmModal');
const allowBtn = document.getElementById('allowBtn');
const rejectBtn = document.getElementById('rejectBtn');

let pc = null;
let localStream = null;
let sessionRef = null;
let senderCandUnsub = null;
let receiverCandUnsub = null;
let sessionSnapUnsub = null;

// ICE config
const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function makeCode(len=6){
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s=''; for(let i=0;i<len;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function showModal(){ confirmModal.classList.remove('hidden'); confirmModal.setAttribute('aria-hidden','false'); }
function hideModal(){ confirmModal.classList.add('hidden'); confirmModal.setAttribute('aria-hidden','true'); }

startShareBtn.onclick = async () => {
  startShareBtn.disabled = true;
  senderStatus.textContent = 'Starting... allow camera/mic when asked.';
  const useVideo = shareVideoChk.checked;
  const useAudio = shareAudioChk.checked;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: useVideo, audio: useAudio });
    localVideo.srcObject = localStream;
  } catch(e){
    alert('Camera/Mic access failed: ' + e);
    startShareBtn.disabled = false;
    senderStatus.textContent = '';
    return;
  }

  pc = new RTCPeerConnection(ICE_CONFIG);
  localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));

  // create doc
  const code = makeCode(6);
  sessionCodeEl.textContent = code;
  sessionRef = db.collection('sessions').doc(code);

  const senderCandCol = sessionRef.collection('senderCandidates');
  const receiverCandCol = sessionRef.collection('receiverCandidates');

  pc.onicecandidate = e => {
    if(e.candidate) senderCandCol.add(e.candidate.toJSON()).catch(console.error);
  };

  // create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const offerData = { type: offer.type, sdp: offer.sdp, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
  await sessionRef.set({ offer: offerData, status:'waiting' }, { merge: true });

  // listen for receiver candidate additions
  receiverCandUnsub = receiverCandCol.onSnapshot(snapshot=>{
    snapshot.docChanges().forEach(change=>{
      if(change.type === 'added'){
        const cand = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e=>console.warn('addIceCandidate failed', e));
      }
    });
  });

  // Listen for session doc updates — but we only show the confirmation modal AFTER a receiver sets request:true
  sessionSnapUnsub = sessionRef.onSnapshot(async snap=>{
    const data = snap.data();
    if(!data) return;

    // if a receiver requested connection and sender hasn't handled yet
    if(data.request === true && !data.requestHandled){
      senderStatus.textContent = 'Connection request received — awaiting approval...';
      showModal();
      // allowBtn/rejectBtn handlers will update doc accordingly
    }

    // If approved and answer exists, set remote description
    if(data.approved === true && data.answer && pc && (!pc.currentRemoteDescription)){
      try {
        const ans = data.answer;
        await pc.setRemoteDescription(new RTCSessionDescription({ type: ans.type, sdp: ans.sdp }));
        senderStatus.textContent = 'Viewer connected — streaming.';
      } catch(err){
        console.error('Error applying answer', err);
      }
    }

    // If rejected
    if(data.rejected === true){
      senderStatus.textContent = 'Viewer request rejected.';
    }
  });

  stopShareBtn.classList.remove('hidden');
  senderStatus.textContent = 'Session created. Share code: ' + code;
};

// modal buttons
allowBtn.onclick = async () => {
  hideModal();
  senderStatus.textContent = 'Approved viewer — waiting for connection...';
  if(sessionRef){
    await sessionRef.set({ approved: true, requestHandled: true, status:'approved' }, { merge: true });
  }
};
rejectBtn.onclick = async () => {
  hideModal();
  senderStatus.textContent = 'Rejected viewer request.';
  if(sessionRef){
    await sessionRef.set({ rejected: true, requestHandled: true, status:'rejected' }, { merge: true });
  }
};

// stop / cleanup
stopShareBtn.onclick = async () => {
  await cleanup(true);
};

async function cleanup(removeDoc=false){
  try {
    if(senderCandUnsub){ senderCandUnsub(); senderCandUnsub = null; }
    if(receiverCandUnsub){ receiverCandUnsub(); receiverCandUnsub = null; }
    if(sessionSnapUnsub){ sessionSnapUnsub(); sessionSnapUnsub = null; }
  } catch(e){ console.warn(e); }

  if(pc){ try{ pc.getSenders().forEach(s=>s.track && s.track.stop()); }catch(e){} try{ pc.close(); }catch(e){} pc=null; }
  if(localStream){ try{ localStream.getTracks().forEach(t=>t.stop()); }catch(e){} localStream=null; localVideo.srcObject=null; }
  if(sessionRef && removeDoc){
    try{ await sessionRef.delete(); } catch(e){ console.warn('delete failed', e); }
  }

  // reset UI
  startShareBtn.disabled = false;
  stopShareBtn.classList.add('hidden');
  sessionCodeEl.textContent = '—';
  senderStatus.textContent = '';
  sessionRef = null;
  hideModal();
}

window.addEventListener('beforeunload', async ()=>{ await cleanup(false); });
