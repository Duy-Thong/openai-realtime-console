import { useEffect, useState, useRef } from 'react';
import './WebRtcPage.scss';
import { Button } from '../components/button/Button';

export function WebRtcPage() {
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [messages, setMessages] = useState<string[]>([]);
  const [transcriptions, setTranscriptions] = useState<{id: string, text: string}[]>([]);
  const [currentTranscription, setCurrentTranscription] = useState<string>('');
  
  // References for WebRTC connection
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Initialize when component mounts
  useEffect(() => {
    // Create audio element for remote audio
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioElementRef.current = audioEl;
    
    // Add audio element to DOM
    const audioContainer = document.getElementById('remote-audio-container');
    if (audioContainer) {
      audioContainer.appendChild(audioEl);
    }
    
    return () => {
      // Clean up on unmount
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      if (audioEl.parentNode) {
        audioEl.parentNode.removeChild(audioEl);
      }
    };
  }, []);

  // Function to add messages to the message log
  const addMessage = (message: string) => {
    setMessages(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  // Function to handle transcription events
  const handleTranscriptionEvent = (event: any) => {
    try {
      const data = JSON.parse(event.data);
      console.log('Received event:', data);
      
      // Handle delta transcription events
      if (data.type === 'conversation.item.input_audio_transcription.delta') {
        setCurrentTranscription(prev => prev + data.delta);
        // addMessage(`Transcription delta: ${data.delta}`);
      }
      
      // Handle completed transcription events
      else if (data.type === 'conversation.item.input_audio_transcription.completed') {
        setTranscriptions(prev => [...prev, { id: data.item_id, text: data.transcript }]);
        setCurrentTranscription('');
        addMessage(`Transcription completed: ${data.transcript}`);
      }
    } catch (error) {
      console.error('Error processing transcription event:', error);
    }
  };

  // Initialize WebRTC connection for transcription
  const initWebRTC = async () => {
    try {
      // Hardcoded ephemeral key
      const EPHEMERAL_KEY = 'ek_6800a85e71988190930a0736b5f4138b';
      if (!EPHEMERAL_KEY) {
        console.error('Missing ephemeral key');
        addMessage('Error: Missing API key');
        setConnectionStatus('error');
        return;
      }

      setConnectionStatus('connecting');
      addMessage('Initializing WebRTC connection for transcription...');

      // Create peer connection
      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      // Add local audio track for microphone input
      try {
        const ms = await navigator.mediaDevices.getUserMedia({
          audio: true
        });
        localStreamRef.current = ms;
        
        // Add all tracks to the peer connection
        ms.getTracks().forEach(track => {
          if (localStreamRef.current) {
            pc.addTrack(track, localStreamRef.current);
          }
        });
        
        addMessage('Microphone access granted');
      } catch (err) {
        console.error('Error accessing microphone:', err);
        addMessage('Error: Failed to access microphone');
        setConnectionStatus('error');
        return;
      }

      // Set up data channel for sending and receiving events
      const dc = pc.createDataChannel("oai-events");
      dataChannelRef.current = dc;
      
      dc.addEventListener("open", () => {
        addMessage('Data channel opened');
      });
      
      // Add event listener for transcription events
      dc.addEventListener("message", handleTranscriptionEvent);

      // Start the session using the Session Description Protocol (SDP)
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      addMessage('Connecting to OpenAI Realtime API for transcription...');
      
      const baseUrl = "https://api.openai.com/v1/realtime";
      
      try {
        // Create transcription session with default parameters
        const sdpResponse = await fetch(`${baseUrl}`, {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${EPHEMERAL_KEY}`,
            "Content-Type": "application/sdp",
            "X-Session-Config": JSON.stringify({
              object: "realtime.transcription_session",
              input_audio_format: "pcm16",
              input_audio_transcription: [{
                model: "gpt-4o-transcribe",
                language: "en"
              }],
              turn_detection: {
                type: "server_vad",
                threshold: 0.6,
                prefix_padding_ms: 500,
                silence_duration_ms: 1000,
              },
              input_audio_noise_reduction: {
                type: "near_field"
              },
              include: ["text"]
            })
          },
        });

        if (!sdpResponse.ok) {
          throw new Error(`API request failed with status ${sdpResponse.status}`);
        }

        const sdpText = await sdpResponse.text();
        const answer = {
          type: "answer",
          sdp: sdpText,
        };
        
        await pc.setRemoteDescription(answer as RTCSessionDescriptionInit);
        
        setConnectionStatus('connected');
        addMessage('WebRTC transcription session established successfully');
      } catch (error) {
        console.error('Error connecting to OpenAI API:', error);
        addMessage(`Error: ${error instanceof Error ? error.message : 'Failed to connect to API'}`);
        setConnectionStatus('error');
        
        // Clean up resources on error
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
        }
        pc.close();
      }
    } catch (error) {
      console.error('Error initializing WebRTC:', error);
      addMessage(`Error: ${error instanceof Error ? error.message : 'Failed to initialize WebRTC'}`);
      setConnectionStatus('error');
    }
  };

  // Disconnect WebRTC
  const disconnectWebRTC = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    
    if (audioElementRef.current) {
      audioElementRef.current.srcObject = null;
    }
    
    setConnectionStatus('disconnected');
    addMessage('WebRTC connection closed');
  };

  return (
    <div data-component="WebRtcPage">
      <div className="webrtc-header">
        <h1>OpenAI Realtime Transcription</h1>
        <div className={`connection-status ${connectionStatus}`}>
          <span className="status-indicator"></span>
          {connectionStatus === 'connected' ? 'Connected' : 
           connectionStatus === 'connecting' ? 'Connecting...' : 
           connectionStatus === 'error' ? 'Error' : 'Disconnected'}
        </div>
      </div>

      <div className="webrtc-controls">
        <Button
          label={connectionStatus === 'connected' ? 'Disconnect' : 'Connect'}
          buttonStyle={connectionStatus === 'connected' ? 'alert' : 'action'}
          disabled={connectionStatus === 'connecting'}
          onClick={connectionStatus === 'connected' ? disconnectWebRTC : initWebRTC}
        />
      </div>

      <div className="webrtc-content">
        <div className="transcription-section">
          <h2>Live Transcription</h2>
          <div className="transcription-container">
            <div className="current-transcription">
              {currentTranscription}
            </div>
            
            <div className="transcription-history">
              {transcriptions.length > 0 ? (
                transcriptions.map((item, index) => (
                  <div key={index} className="transcription-item">
                    <div className="transcription-text">{item.text}</div>
                  </div>
                ))
              ) : (
                <div className="no-transcriptions">
                  {connectionStatus === 'connected' ? 'Speak to see transcription' : 'Connect to start transcription'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="message-log">
          <h2>Connection Log</h2>
          <div className="messages">
            {messages.length > 0 ? (
              <>
                {messages.map((msg, index) => (
                  <div key={index} className="message">{msg}</div>
                ))}
                <div ref={messagesEndRef} />
              </>
            ) : (
              <div className="no-messages">No messages yet</div>
            )}
          </div>
        </div>
      </div>
      
      <div id="remote-audio-container" style={{ display: 'none' }}></div>
    </div>
  );
}