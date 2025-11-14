// receiver.js
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

const codeInput = document.getElementById('codeInput');
const btnJoin = document.getElementById('btnJoin');
const btnLeave = document.getElementById('btnLeave');
const remoteVideo = document.getElementById('remoteVideo');
const recvStatus = document.getElementById('recvStatus');

let pc = null;
let sessionRef = null;
let senderCandsUnsub = null;
let receiverCandsUnsub = null;

const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

btnJoin.onclick = async () => {
  const code = (codeInput.value || '').trim().toUpperCase();
  if(!code) return alert('Enter session code');
  btnJoin.disabled = true;
  recvStatus.textContent = 'Contacting sender...';

  try {
    sessionRef = db.collection('sessions').doc(code);
    const snap = await sessionRef.get();
    if(!snap.exists){
      alert('Session not found');
      recvStatus.textContent = '';
      btnJoin.disabled = false;
      sessionRef = null;
      return;
    }
    const data = snap.data();
    if(!data.offer){
      alert('Sender has not created an offer yet.');
      recvStatus.textContent = '';
      btnJoin.disabled = false;
      sessionRef = null;
      return;
    }

    pc = new RTCPeerConnection(ICE_CONFIG);
    pc.ontrack = e => {
      remoteVideo.srcObject = e.streams[0];
      recvStatus.textContent = 'Streaming.';
    };

    const receiverCandCol = sessionRef.collection('receiverCandidates');
    const senderCandCol = sessionRef.collection('senderCandidates');

    // add our local ICE to receiverCandidates (we are not sending media, still added)
    pc.onicecandidate = e => {
      if(e.candidate) receiverCandCol.add(e.candidate.toJSON()).catch(console.error);
    };

    // listen to senderCandidates to add to pc
    senderCandsUnsub = senderCandCol.onSnapshot(snapshot=>{
      snapshot.docChanges().forEach(async change=>{
        if(change.type === 'added'){
          const cand = change.doc.data();
          try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(e){ console.warn('addIce error', e); }
        }
      });
    });

    // set remote description (offer)
    const offer = data.offer;
    await pc.setRemoteDescription(new RTCSessionDescription({ type: offer.type, sdp: offer.sdp }));

    // instead of immediately creating answer, signal a request for approval
    await sessionRef.set({ request: true, requestHandled: false, requestTime: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    recvStatus.textContent = 'Request sent. Waiting for sender approval...';

    // Listen for approved / rejected
    const unsub = sessionRef.onSnapshot(async snap2=>{
      const d = snap2.data();
      if(!d) return;

      if(d.rejected === true){
        recvStatus.textContent = 'Sender rejected your request.';
        alert('Sender rejected the connection.');
        cleanup(false);
        unsub();
        return;
      }

      if(d.approved === true){
        // Sender approved: now create answer and save it
        try {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const ansData = { type: answer.type, sdp: answer.sdp, answeredAt: firebase.firestore.FieldValue.serverTimestamp() };
          await sessionRef.set({ answer: ansData, status:'answered' }, { merge: true });
          recvStatus.textContent = 'Answer sent. Waiting for media...';
          btnLeave.classList.remove('hidden');
          unsub(); // stop listening here (we still listen to cand updates)
        } catch(err){
          console.error('Error creating/saving answer', err);
          recvStatus.textContent = 'Error creating answer';
          btnJoin.disabled = false;
        }
      }
    });

  } catch(err){
    console.error(err);
    alert('Error joining: ' + err);
    recvStatus.textContent = '';
    btnJoin.disabled = false;
    sessionRef = null;
  }
};

btnLeave.onclick = async () => {
  await cleanup(false);
};

async function cleanup(removeDoc=false){
  try {
    if(senderCandsUnsub){ senderCandsUnsub(); senderCandsUnsub = null; }
    if(receiverCandsUnsub){ receiverCandsUnsub(); receiverCandsUnsub = null; }
  } catch(e){ console.warn(e); }

  if(pc){ try{ pc.close(); } catch(e){} pc=null; }
  if(remoteVideo) remoteVideo.srcObject = null;
  btnJoin.disabled = false;
  btnLeave.classList.add('hidden');
  recvStatus.textContent = '';

  if(sessionRef && removeDoc){
    try { await sessionRef.delete(); } catch(e){ console.warn('delete failed', e); }
  }
  sessionRef = null;
}

window.addEventListener('beforeunload', async ()=>{ await cleanup(false); });
