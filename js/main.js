'use strict';

var isInitiator = false;
var peerFinished = false;
var localStream;
var myID;
var presenterID;
//var pcs = [];
var pcs = {} // {<socketID>: RPC, <socketID>: RPC}
var isStarted = [false];
var remoteStreams = [];
var turnReady;
var readyForCandidates = false;

//TODO statt mit peerFinished mit Sender und Empfänger arbeiten, da ich nicht bestimmen kann ob der peer finished ist

var pcConfig = {
  'iceServers': [{
    'urls': 'stun:stun.l.google.com:19302' //TODO Ggf. eigenen STUN (und TURN?) Server hosten
  }]
};

// Set up audio and video regardless of what devices are present.
var sdpConstraints = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

/////////////////////////////////////////////

var room = prompt("Enter room name:");;

var socket = io('http://localhost:8080');

if (room !== '') {
  socket.emit('create or join', room);
  console.log('Attempted to create or join room', room);
}

function setMyID(){
  if(myID === undefined)
    myID = socket.id;
  return myID;
}

socket.on('created', (room, socketID) => { //erhält nur Präsentator
  console.log('Created room ' + room);
  isInitiator = true;
  setMyID();
  requestStreams({
    audio: true,
    video: {
      width: { min: 480, ideal: 720, max: 1920 },
      height: { min: 360, ideal: 540, max: 1080 },
      facingMode: "user"
    }
  });
});

socket.on('join', (room, socketID) => { //erhält der ganze Raum, aber nicht der Listener der gerade beitritt
  // a listener will join the room
  console.log('Another peer made a request to join room ' + room);
  if(isInitiator){
    console.log('This peer is the initiator of room ' + room + '!');
    socket.emit('ID of presenter', room, myID)
  }
});

socket.on('joined', (room) => { //erhält nur der Listener, der gerade beitritt
  // a listener has joined the room
  console.log('joined: ' + room);
  setMyID();
  requestStreams({
    audio: false,
    video: false
  });
});

socket.on('full', (room) => { //erhält nur der Listener, der gerade beitritt
  console.log('Room ' + room + ' is full');
  socket.close();
  alert('This room is already full - sorry!');
});

socket.on('ID of presenter', (id) => {
  console.log('Received ID of presenter: ', id);
  presenterID = id;
});

socket.on('log', function(array) {
  //console.log.apply(console, array);
  setMyID();
});

////////////////////////////////////////////////

function sendMessage(cmd, data = undefined, receiver = undefined) {
  console.log('Sending message: ', cmd, data, receiver);
  socket.emit('message', {"cmd": cmd, "data": data, "sender": myID, "receiver": receiver}, room);
}

// This client receives a message
socket.on('message', function(message) {
  if(message.sender === myID){ //Filter für Nachrichten vom mir selbst
    if( message.cmd === 'peer wants to connect' && Object.keys(pcs).length === 0){ //peer triggert sich selbst
      start(presenterID);
    }
  } else if(message.receiver === myID){ //an mich adressiert
    console.log('Recieved message from peer: ', message);
    if( message.cmd === 'peer wants to connect' && isInitiator){ //erhalten alle außer der peer selbst, sobald ein peer zusteigt, kommt nur von peer
      start(message.sender);
    } else if (message.cmd === 'offer' || (message.cmd === 'answer' && isInitiator)) { //offer kommt von initiator, answer von peer
      pcs[message.sender].setRemoteDescription(new RTCSessionDescription(message.data));
      readyForCandidates = true;
      if(message.cmd === 'offer') // führt nur der peer aus
        doAnswer(message.sender);
   } if (message.cmd === 'candidate') {
     try { //Catch defective candidates
       var candidate = new RTCIceCandidate({
         sdpMLineIndex: message.data.label,
         candidate: message.data.candidate
       });
       pcs[message.sender].addIceCandidate(candidate).catch((e) => {}); //Catch defective candidates
     } catch (e) {}
   } else if (message.cmd === 'bye' && isInitiator) { //TODO später umbauen auf RPC transmission of commands
      handleRemoteHangup(message.sender);
    }
  }
});

////////////////////////////////////////////////////

function requestStreams(options) {
  navigator.mediaDevices.getUserMedia(options)
  .then(gotStream)
  .catch(function(e) {
    gotStream('');
    console.log('getUserMedia() error: ' + e.name);
  });
}

function gotStream(stream) {
  console.log('Adding local stream.');
  if(isInitiator) {
    $('#videos').append('<video id="localVideo" autoplay></video>');
    let localVideo = document.querySelector('#localVideo');
    localVideo.srcObject = stream;
    $('#videos').before('<p>This is me</p>');
  }
  localStream = stream;
  function sendASAP () {
    if(presenterID)
      sendMessage('peer wants to connect', undefined, presenterID);
    else
      setTimeout(() => { sendASAP(); }, 10);
  }
  if(!isInitiator){
    sendASAP();
  }
}

// if (location.hostname !== 'localhost') {
//   requestTurn(
//     'https://computeengineondemand.appspot.com/turn?username=41784574&key=4080218913'
//   );
// }

function start(peerID) {
  if (typeof localStream !== 'undefined') {
    console.log('creating RTCPeerConnnection for', (isInitiator) ? 'initiator' : 'peer');
    createPeerConnection(peerID);
    if(isInitiator)
      pcs[peerID].addStream(localStream);
    if (isInitiator)
      doCall(peerID);
  }
}

window.onbeforeunload = function() {
  sendMessage('bye', undefined, presenterID);
  hangup();
};

/////////////////////////////////////////////////////////

function createPeerConnection(peerID) {
  try {
    pcs[peerID] = new RTCPeerConnection(null);
    pcs[peerID].onicecandidate = handleIceCandidate.bind(this, peerID);
    pcs[peerID].onaddstream = handleRemoteStreamAdded;
    pcs[peerID].onremovestream = handleRemoteStreamRemoved;
    console.log('Created RTCPeerConnnection');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function handleIceCandidate(peerID, event) {

  //console.log('icecandidate event: ', event);
  if (event && ((event.target && event.target.iceGatheringState !== 'complete' ) || event.candidate !== null)) {
    sendMessage('candidate',{
      type: 'candidate',
      label: event.candidate.sdpMLineIndex,
      id: event.candidate.sdpMid,
      candidate: event.candidate.candidate
    }, peerID);
  } else {
    console.log('End of candidates.');
  }
}

function handleRemoteStreamAdded(event) {
  if(isInitiator === false){
    $('#videos').append('<video class="remoteVideos" autoplay></video>');
    let remoteVideos = $('.remoteVideos');
    remoteVideos[remoteVideos.length - 1].srcObject = event.stream;
    remoteStreams[remoteVideos.length - 1] = event.stream;
    $('#videos').before('<p>This is the presenter</p>');
  }
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doCall(peerID) { //das macht der Präsentator
  //console.log('Sending offer to peer');
  pcs[peerID].createOffer(setLocalAndSendMessage.bind(this, peerID), handleCreateOfferError);
}

function doAnswer(peerID) {
  //console.log('Sending answer to initiator.');
  pcs[peerID].createAnswer().then(
    setLocalAndSendMessage.bind(this, peerID),
    onCreateSessionDescriptionError
  );
}

function setLocalAndSendMessage(peerID, sessionDescription) {
  // Set Opus as the preferred codec in SDP if Opus is present.
  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  pcs[peerID].setLocalDescription(sessionDescription);
  //console.log('setLocalAndSendMessage sending message', sessionDescription);
  sendMessage(sessionDescription.type, sessionDescription, peerID);
}

function onCreateSessionDescriptionError(error) {
  trace('Failed to create session description: ' + error.toString());
}

function requestTurn(turnURL) {
  var turnExists = false;
  for (var i in pcConfig.iceServers) {
    if (pcConfig.iceServers[i].url.substr(0, 5) === 'turn:') {
      turnExists = true;
      turnReady = true;
      break;
    }
  }
  if (!turnExists) {
    console.log('Getting TURN server from ', turnURL);
    // No TURN server. Get one from computeengineondemand.appspot.com:
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4 && xhr.status === 200) {
        var turnServer = JSON.parse(xhr.responseText);
        console.log('Got TURN server: ', turnServer);
        pcConfig.iceServers.push({
          'url': 'turn:' + turnServer.username + '@' + turnServer.turn,
          'credential': turnServer.password
        });
        turnReady = true;
      }
    };
    xhr.open('GET', turnURL, true);
    xhr.send();
  }
}

function handleRemoteStreamRemoved(event) {
  console.log('Remote stream removed. Event: ', event);
}

function hangup() { //called by peer
  console.log('Hanging up.');
  stop(presenterID);
  sendMessage('bye', undefined, presenterID);
}

function handleRemoteHangup(peerID) { //called by initiator
  console.log('Session terminated.');
  stop(peerID);
}

function stop(peerID) {
    pcs[peerID].close();
    delete pcs[peerID];
    if(!isInitiator)
      socket.close();
  //}
}

///////////////////////////////////////////

// Set Opus as the default audio codec if it's present.
function preferOpus(sdp) {
  var sdpLines = sdp.split('\r\n');
  var mLineIndex;
  // Search for m line.
  for (var i = 0; i < sdpLines.length; i++) {
    if (sdpLines[i].search('m=audio') !== -1) {
      mLineIndex = i;
      break;
    }
  }
  if (mLineIndex === null) {
    return sdp;
  }

  // If Opus is available, set it as the default in m line.
  for (i = 0; i < sdpLines.length; i++) {
    if (sdpLines[i].search('opus/48000') !== -1) {
      var opusPayload = extractSdp(sdpLines[i], /:(\d+) opus\/48000/i);
      if (opusPayload) {
        sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex],
          opusPayload);
      }
      break;
    }
  }

  // Remove CN in m line and sdp.
  sdpLines = removeCN(sdpLines, mLineIndex);

  sdp = sdpLines.join('\r\n');
  return sdp;
}

function extractSdp(sdpLine, pattern) {
  var result = sdpLine.match(pattern);
  return result && result.length === 2 ? result[1] : null;
}

// Set the selected codec to the first in m line.
function setDefaultCodec(mLine, payload) {
  var elements = mLine.split(' ');
  var newLine = [];
  var index = 0;
  for (var i = 0; i < elements.length; i++) {
    if (index === 3) { // Format of media starts from the fourth.
      newLine[index++] = payload; // Put target payload to the first.
    }
    if (elements[i] !== payload) {
      newLine[index++] = elements[i];
    }
  }
  return newLine.join(' ');
}

// Strip CN from sdp before CN constraints is ready.
function removeCN(sdpLines, mLineIndex) {
  var mLineElements = sdpLines[mLineIndex].split(' ');
  // Scan from end for the convenience of removing an item.
  for (var i = sdpLines.length - 1; i >= 0; i--) {
    var payload = extractSdp(sdpLines[i], /a=rtpmap:(\d+) CN\/\d+/i);
    if (payload) {
      var cnPos = mLineElements.indexOf(payload);
      if (cnPos !== -1) {
        // Remove CN payload from m line.
        mLineElements.splice(cnPos, 1);
      }
      // Remove CN line in sdp
      sdpLines.splice(i, 1);
    }
  }

  sdpLines[mLineIndex] = mLineElements.join(' ');
  return sdpLines;
}
