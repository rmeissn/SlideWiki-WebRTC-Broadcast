'use strict';

var isInitiator = false;
var localStream;
var myID;
var presenterID;
//var pcs = [];
var pcs = {} // {<socketID>: {RTCConnection: RPC, dataChannel: dataChannel}, <socketID>: {RTCConnection: RPC, dataChannel: dataChannel}}
var remoteStreams = [];
var turnReady;

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

var socket = io('');

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
  $('#slidewikiPresentation').on("load", activateIframeListeners);
  requestStreams({
    audio: true,
    // video: {
    //   width: { min: 480, ideal: 720, max: 1920 },
    //   height: { min: 360, ideal: 540, max: 1080 },
    //   facingMode: "user"
    // }
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
  $('#slidewikiPresentation').on("load", activateIframeListeners);
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

function sendRTCMessage(cmd, data = undefined, receiver = undefined) {
  let message = JSON.stringify({"cmd": cmd, "data": data});
  if(receiver){ //send to one peer only
    pcs[receiver].dataChannel.send(message)
  } else { //broadcast from initiator
    for(var i in pcs) {
      if(pcs[i].dataChannel){
        console.log('Sending Message to peer: ', i);
        pcs[i].dataChannel.send(message);
      }
    }
  }
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
      pcs[message.sender].RTCconnection.setRemoteDescription(new RTCSessionDescription(message.data));
      if(message.cmd === 'offer') // führt nur der peer aus
        doAnswer(message.sender);
   } if (message.cmd === 'candidate') {
     try { //Catch defective candidates
       var candidate = new RTCIceCandidate({
         sdpMLineIndex: message.data.label,
         candidate: message.data.candidate
       });
       pcs[message.sender].RTCconnection.addIceCandidate(candidate).catch((e) => {}); //Catch defective candidates
     } catch (e) {}
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
    //$('#videos').append('<video id="localVideo" autoplay></video>');
    //let localVideo = document.querySelector('#localVideo');
    //localVideo.srcObject = stream;
    $('#resumeRemoteControl').before('<p>You are the presenter, other poeple will hear your voice and reflect your presentation progress.</p>');
    $('#videos').remove();
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
      pcs[peerID].RTCconnection.addStream(localStream);
    if (isInitiator)
      doCall(peerID);
  }
}

window.onbeforeunload = function() {
  hangup();
};

/////////////////////////////////////////////////////////

function createPeerConnection(peerID) {
  try {
    pcs[peerID] = {};
    pcs[peerID].RTCconnection = new RTCPeerConnection(null);
    pcs[peerID].RTCconnection.onicecandidate = handleIceCandidate.bind(this, peerID);
    pcs[peerID].RTCconnection.onaddstream = handleRemoteStreamAdded;
    pcs[peerID].RTCconnection.onremovestream = handleRemoteStreamRemoved;
    if(isInitiator){
      pcs[peerID].dataChannel = pcs[peerID].RTCconnection.createDataChannel('messages', {
        ordered: true
      });
      onDataChannelCreated(pcs[peerID].dataChannel, peerID);
    } else {
      pcs[peerID].RTCconnection.ondatachannel = handleDataChannelEvent.bind(this, peerID);
    }
    console.log('Created RTCPeerConnnection');
  } catch (e) {
    console.log('Failed to create PeerConnection, exception: ' + e.message);
    alert('Cannot create RTCPeerConnection object.');
    return;
  }
}

function handleDataChannelEvent(peerID, event) { //das führt nur der peer aus
    console.log('ondatachannel:', event.channel);
    pcs[peerID].dataChannel = event.channel;
    pcs[peerID].dataChannel.onclose = handleRPCClose;//NOTE dirty workaround as browser are currently not implementing RPC.onconnectionstatechange
    onDataChannelCreated(pcs[peerID].dataChannel, peerID);
}

function handleRPCClose() {
  if(!isInitiator){
    alert('The presenter closed the session. This window will close now.');
    handleRemoteHangup(presenterID);
    $('#videos').empty();//TODO redirect instead!
  }
}

function onDataChannelCreated(channel, peerID) { //das führen beide aus
  console.log('Created data channel: ', channel, 'for ', peerID);
  /*NOTE
  * Browsers do currenty not support events that indicate whether ICE exchange has finished or not and the RPC connection has been fully established. Thus, I'm waiting for latest event onDataChannelCreated in order to close the socket after some time. This should be relativly safe.
  */
  if(!isInitiator && socket.disconnected === false){
    setTimeout(() => {socket.close();}, 5000); //close socket after 5 secs
  }

  channel.onopen = function() {
    console.log('Data Channel opened');
    if(isInitiator)
      sendRTCMessage('gotoslide', currentSlide, peerID);
  };

  channel.onmessage = handleMessage.bind(this, channel);
}

function handleMessage(channel, event) {
  let data = JSON.parse(event.data);
  switch (data.cmd) {
    case "gotoslide":
      if(!isInitiator)
        changeSlide(data.data);
      break;
    case "log":
      console.log('Recieved message from peer: ', data.data);
      break;
    case "bye":
      handleRemoteHangup(data.data);
      break;
    default:

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
    $('#resumeRemoteControl').before('<p>You are now listening to the presenter. The presentation you see will reflect his progress.</p>');
  }
}

function handleCreateOfferError(event) {
  console.log('createOffer() error: ', event);
}

function doCall(peerID) { //das macht der Präsentator
  //console.log('Sending offer to peer');
  pcs[peerID].RTCconnection.createOffer(setLocalAndSendMessage.bind(this, peerID), handleCreateOfferError);
}

function doAnswer(peerID) {
  //console.log('Sending answer to initiator.');
  pcs[peerID].RTCconnection.createAnswer().then(
    setLocalAndSendMessage.bind(this, peerID),
    onCreateSessionDescriptionError
  );
}

function setLocalAndSendMessage(peerID, sessionDescription) {
  // Set Opus as the preferred codec in SDP if Opus is present.
  sessionDescription.sdp = preferOpus(sessionDescription.sdp);
  pcs[peerID].RTCconnection.setLocalDescription(sessionDescription);
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

function hangup() { //called by peer and by initiatior
  console.log('Hanging up.');
  if(isInitiator){
    stop(undefined, true);
  } else {
    sendRTCMessage('bye', myID, presenterID);
    stop(presenterID);
  }
  //NOTE Don't need to close the socket, as the browser does this automatically if the window closes
}

function handleRemoteHangup(peerID) { //called by initiator
  console.log('Terminating session for ', peerID);
  stop(peerID);
}

function stop(peerID, presenter = false) {
  if (presenter) {
    for (var i in pcs) {
      pcs[i].dataChannel.close();
      pcs[i].RTCconnection.close();
      delete pcs[i];
    }
  } else {
    pcs[peerID].dataChannel.close();
    pcs[peerID].RTCconnection.close();
    delete pcs[peerID];
  }
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


/////////////////////////////////////////// SlideWiki specific stuff

let lastRemoteSlide = '';//TODO prefill this with first slide
let paused = false; //user has manually paused slide transitions
let currentSlide = '';//TODO prefill this with first slide

$("#resumeRemoteControl").click(() => {
  resumeRemoteControl();
});

function resumeRemoteControl() {
  paused = false;
  $("#resumeRemoteControl").hide();
  changeSlide(lastRemoteSlide);
}

function activateIframeListeners() {
  console.log('Adding iframe listeners');
  let iframe = $('#slidewikiPresentation').contents();
  if (isInitiator) {
    iframe.on('slidechanged', () => {
      currentSlide = document.getElementById("slidewikiPresentation").contentWindow.location.href;
      sendRTCMessage('gotoslide', currentSlide);
    });
  } else {
    iframe.on('slidechanged', () => {
      if (document.getElementById("slidewikiPresentation").contentWindow.location.href !== lastRemoteSlide){
        paused = true;
        $("#resumeRemoteControl").show();
      }
    });
  }
}

function changeSlide(slideID) { // only executed by peers
  lastRemoteSlide = slideID;
  if(!paused){
    console.log('Changing to slide: ',slideID);
    $('#slidewikiPresentation').attr('src', slideID);
  }
}
