import React, { useRef, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { 
  Typography, 
  Box, 
  CircularProgress, 
  Button, 
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  IconButton
} from '@mui/material';
import { 
  VideoCall as VideoCallIcon,
  Settings as SettingsIcon,
  VolumeUp as VolumeUpIcon,
  CallEnd as CallEndIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
  Videocam as VideocamIcon,
  VideocamOff as VideocamOffIcon,
  PlayArrow as PlayArrowIcon
} from '@mui/icons-material';
import { UserAgent, Registerer, Invitation, SessionState, UserAgentOptions } from 'sip.js';
import { getClientName } from '../clientNameMap';

// Add CSS animations
const styles = `
  @keyframes pulse {
    0% { opacity: 1; }
    50% { opacity: 0.7; }
    100% { opacity: 1; }
  }
`;

// Inject styles into document head
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

const SIP_WS = 'wss://fs1.sn.wizher.com:7443';
const SIP_REALM = 'fs1.sn.wizher.com';

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

const WaitForCallProfile: React.FC = () => {
  const query = useQuery();
  const clientId = query.get('client');
  const clientName = query.get('name') || getClientName(clientId || '');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'registered' | 'waiting' | 'in-call' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isTestingDevices, setIsTestingDevices] = useState(false);
  const [hasLocalStream, setHasLocalStream] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [availableMicrophones, setAvailableMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');
  const [selectedMicrophone, setSelectedMicrophone] = useState<string>('');
  const [microphoneVolume, setMicrophoneVolume] = useState<number>(50);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState<boolean>(false);
  
  // Persistent mute and camera states with localStorage
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    const stored = localStorage.getItem('sipCallMuted');
    return stored ? JSON.parse(stored) : false;
  });
  const [isCameraDisabled, setIsCameraDisabled] = useState<boolean>(() => {
    const stored = localStorage.getItem('sipCallCameraDisabled');
    return stored ? JSON.parse(stored) : false;
  });
  const callTimer = useRef<NodeJS.Timeout | null>(null);
  const userAgentRef = useRef<UserAgent | null>(null);
  const registererRef = useRef<Registerer | null>(null);
  const sessionRef = useRef<any>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoCallRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const testVideoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micMonitorRef = useRef<number | null>(null);

  // Get available devices
  const getDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');
      const microphones = devices.filter(device => device.kind === 'audioinput');
      
      setAvailableCameras(cameras);
      setAvailableMicrophones(microphones);
      
      // Set default devices
      if (cameras.length > 0 && !selectedCamera) {
        setSelectedCamera(cameras[0].deviceId);
      }
      if (microphones.length > 0 && !selectedMicrophone) {
        setSelectedMicrophone(microphones[0].deviceId);
      }
    } catch (err) {
      console.error('Failed to get devices:', err);
    }
  };

  // Monitor microphone audio levels
  const startAudioMonitoring = (stream: MediaStream) => {
    try {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);
      
      analyser.fftSize = 256;
      microphone.connect(analyser);
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      const updateAudioLevel = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;
          setAudioLevel(Math.min(100, (average / 128) * 100));
          
          micMonitorRef.current = requestAnimationFrame(updateAudioLevel);
        }
      };
      
      updateAudioLevel();
    } catch (err) {
      console.error('Failed to start audio monitoring:', err);
    }
  };

  // Stop audio monitoring
  const stopAudioMonitoring = () => {
    if (micMonitorRef.current) {
      cancelAnimationFrame(micMonitorRef.current);
      micMonitorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  };

  // Enable audio playback with user gesture
  const enableAudioPlayback = async () => {
    console.log('🔊 Patient: User gesture detected - enabling audio playback');
    setNeedsAudioUnlock(false);
    
    // Force play the remote video element
    if (remoteVideoRef.current) {
      try {
        remoteVideoRef.current.muted = false;
        remoteVideoRef.current.volume = 1.0;
        await remoteVideoRef.current.play();
        console.log('✅ Patient: Audio playback enabled successfully with user gesture');
      } catch (error) {
        console.error('❌ Patient: Failed to enable audio playback:', error);
      }
    }
    
    // Resume any suspended audio context
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      try {
        await audioContextRef.current.resume();
        console.log('✅ Patient: Audio context resumed');
      } catch (error) {
        console.error('❌ Patient: Failed to resume audio context:', error);
      }
    }
  };

  // Apply mute and camera settings to a stream (for testing only, not for initial call streams)
  const applyStreamSettings = (stream: MediaStream) => {
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();
    
    audioTracks.forEach(track => {
      track.enabled = !isMuted;
    });
    
    videoTracks.forEach(track => {
      track.enabled = !isCameraDisabled;
    });
  };

  // Apply current settings to live call stream (called during active calls only)
  const applyCallStreamSettings = (stream: MediaStream) => {
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();
    
    // For calls, ensure audio is enabled by default (unmuted) regardless of saved state
    // The user can mute manually using the toggle button
    audioTracks.forEach(track => {
      track.enabled = true;
    });
    
    videoTracks.forEach(track => {
      track.enabled = !isCameraDisabled;
    });
  };

  // Toggle mute function
  const toggleMute = () => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    localStorage.setItem('sipCallMuted', JSON.stringify(newMutedState));
    
    // Apply to local stream
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !newMutedState;
      });
    }
    
    // Apply to WebRTC senders if in call
    if (sessionRef.current?.sessionDescriptionHandler?.peerConnection) {
      const senders = sessionRef.current.sessionDescriptionHandler.peerConnection.getSenders();
      senders.forEach((sender: RTCRtpSender) => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = !newMutedState;
        }
      });
    }
  };

  // Toggle camera function
  const toggleCamera = () => {
    const newCameraDisabledState = !isCameraDisabled;
    setIsCameraDisabled(newCameraDisabledState);
    localStorage.setItem('sipCallCameraDisabled', JSON.stringify(newCameraDisabledState));
    
    // Apply to local stream
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !newCameraDisabledState;
      });
    }
    
    // Apply to WebRTC senders if in call
    if (sessionRef.current?.sessionDescriptionHandler?.peerConnection) {
      const senders = sessionRef.current.sessionDescriptionHandler.peerConnection.getSenders();
      senders.forEach((sender: RTCRtpSender) => {
        if (sender.track && sender.track.kind === 'video') {
          sender.track.enabled = !newCameraDisabledState;
        }
      });
    }
  };

  // Open test dialog
  const openTestDialog = async () => {
    setShowTestDialog(true);
    await getDevices();
  };

  // Test devices with selected camera and microphone
  const testSelectedDevices = async () => {
    try {
      setError(null);
      setIsTestingDevices(true);
      
      // Clear previous stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      
      stopAudioMonitoring();
      
      const constraints: MediaStreamConstraints = {
        video: selectedCamera ? { deviceId: { exact: selectedCamera } } : true,
        audio: selectedMicrophone ? { deviceId: { exact: selectedMicrophone } } : true
      };
      
      console.log('Requesting media with constraints:', constraints);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Apply mute and camera settings
      applyStreamSettings(stream);
      
      console.log('Got test stream:', stream.getTracks().map(t => `${t.kind}: ${t.label}`));
      localStreamRef.current = stream;
      
      if (testVideoRef.current) {
        testVideoRef.current.srcObject = stream;
        await testVideoRef.current.play();
      }
      
      // Start audio monitoring
      startAudioMonitoring(stream);
      
    } catch (err) {
      console.error('Device test failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to access selected devices');
    } finally {
      setIsTestingDevices(false);
    }
  };

  // Close test dialog
  const closeTestDialog = () => {
    stopAudioMonitoring();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (testVideoRef.current) {
      testVideoRef.current.srcObject = null;
    }
    setShowTestDialog(false);
  };

  // Apply tested devices and close dialog
  const applyDeviceSettings = () => {
    // Don't set hasLocalStream to true here to prevent unwanted preview
    if (localStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch(console.error);
    }
    
    // Stop the test stream to prevent it from continuing
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (testVideoRef.current) {
      testVideoRef.current.srcObject = null;
    }
    
    stopAudioMonitoring();
    setShowTestDialog(false);
  };

  // Effect to test devices when selection changes
  useEffect(() => {
    if (showTestDialog && (selectedCamera || selectedMicrophone)) {
      testSelectedDevices();
    }
  }, [selectedCamera, selectedMicrophone, showTestDialog]);

  const testCameraAndMic = async () => {
    try {
      setError(null);
      setIsTestingDevices(true);
      setHasLocalStream(false);
      
      // Clear previous stream if it exists
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
       console.log('Requesting media permissions...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }, 
        audio: true 
      });
      
      // Apply mute and camera settings
      applyStreamSettings(stream);
      
      console.log('Got media stream:', stream.getTracks().map(t => `${t.kind}: ${t.label}`));
      localStreamRef.current = stream;
      setHasLocalStream(true);
      
      if (localVideoRef.current) {
        console.log('Setting video source...');
        localVideoRef.current.srcObject = stream;
        
        // Add event listeners for debugging
        localVideoRef.current.onloadedmetadata = () => {
          console.log('Video metadata loaded, dimensions:', 
            localVideoRef.current?.videoWidth, 'x', localVideoRef.current?.videoHeight);
          // Force a re-render by updating state
          setHasLocalStream(false);
          setTimeout(() => setHasLocalStream(true), 10);
        };
        
        localVideoRef.current.oncanplay = () => {
          console.log('Video can play');
        };
        
        localVideoRef.current.onplay = () => {
          console.log('Video started playing');
        };
        
        localVideoRef.current.onerror = (e) => {
          console.error('Video error:', e);
        };
        
        // Force autoplay and muted attributes
        localVideoRef.current.autoplay = true;
        localVideoRef.current.muted = true;
        localVideoRef.current.playsInline = true;
        
        try {
          await localVideoRef.current.play();
          console.log('Video playing successfully');
        } catch (playError) {
          console.error('Error playing video:', playError);
          // Try again after a short delay
          setTimeout(async () => {
            try {
              if (localVideoRef.current) {
                await localVideoRef.current.play();
                console.log('Video playing after retry');
              }
            } catch (retryError) {
              console.error('Retry play failed:', retryError);
            }
          }, 100);
        }
      }
    } catch (err) {
      console.error('Camera test failed:', err);
      setError(err instanceof Error ? 
        err.message : 
        'Failed to access camera/microphone. Please make sure your devices are connected and you have granted permission to use them.');
      // Clear the stream reference on error
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      setHasLocalStream(false);
    } finally {
      setIsTestingDevices(false);
    }
  };

  const startRegistration = async () => {
    if (!clientId) {
      setError('No client specified in query parameter.');
      return;
    }
    setStatus('connecting');
    setError(null);

    try {
      // Request camera access before registration if we don't have it
      if (!localStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }, 
          audio: true 
        });
        
        // For calls, ensure audio is enabled by default
        applyCallStreamSettings(stream);
        
        console.log('Camera access granted:', stream.getTracks().map(t => t.kind));
        localStreamRef.current = stream;
        setHasLocalStream(true);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          console.log('Local video element source set');
          localVideoRef.current.onloadedmetadata = () => {
            console.log('Local video metadata loaded');
            localVideoRef.current?.play().catch(console.error);
          };
        }
      } else {
        // We already have a stream from testing
        setHasLocalStream(true);
      }
    } catch (err) {
      console.error('Failed to access camera:', err);
      setError('Failed to access camera. Please make sure your camera is connected and you have granted permission to use it.');
      setStatus('error');
      return;
    }

    const uri = UserAgent.makeURI(`sips:${clientId}@${SIP_REALM};transport=tls`);
    if (!uri) {
      setError('Invalid SIP URI');
      setStatus('error');
      return;
    }

    const userAgentOptions: UserAgentOptions = {
      uri,
      authorizationUsername: clientId,
      authorizationPassword: '4321',
      transportOptions: {
        server: SIP_WS,
        connectionOptions: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'turn:global.relay.metered.ca:80', username: 'openai', credential: 'openai' }
          ]
        }
      },
      delegate: {
        onInvite: async (invitation: Invitation) => {
          console.log('🔔 Patient received call invitation');
          setStatus('in-call');
          sessionRef.current = invitation;
          
          // Reset mute state to false when starting a call to ensure audio works
          setIsMuted(false);
          localStorage.setItem('sipCallMuted', JSON.stringify(false));
          
          // Get access to session description handler immediately
          const sessionDescriptionHandler: any = invitation.sessionDescriptionHandler;
          console.log('Patient sessionDescriptionHandler available:', !!sessionDescriptionHandler);

          // First, ensure we have local stream for video call
          if (!localStreamRef.current) {
            try {
              console.log('Patient getting local stream for call...');
              const stream = await navigator.mediaDevices.getUserMedia({ 
                video: true,
                audio: true 
              });
              
              // For calls, ensure audio is enabled by default
              applyCallStreamSettings(stream);
              
              console.log('Patient got local stream:', stream.getTracks().map(t => `${t.kind}: ${t.label}`));
              localStreamRef.current = stream;
              setHasLocalStream(true);
              if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
              }
            } catch (err) {
              console.error('Patient failed to get local stream:', err);
            }
          }

          // Create a persistent remote stream that will accumulate tracks
          let patientRemoteStream = new MediaStream();

          invitation.stateChange.addListener((state) => {
            console.log(`🎯 Patient session state changed to: ${state}`);
            
            if (state === SessionState.Initial || state === SessionState.Establishing) {
              // Access sessionDescriptionHandler when it becomes available
              const sessionDescriptionHandler: any = invitation.sessionDescriptionHandler;
              if (sessionDescriptionHandler && sessionDescriptionHandler.peerConnection) {
                console.log('✅ Patient: SessionDescriptionHandler available, setting up peer connection');
                
                // Add peer connection state debugging
                sessionDescriptionHandler.peerConnection.onconnectionstatechange = () => {
                  console.log('🔗 Patient peer connection state:', sessionDescriptionHandler.peerConnection.connectionState);
                };

                sessionDescriptionHandler.peerConnection.oniceconnectionstatechange = () => {
                  console.log('🧊 Patient ICE connection state:', sessionDescriptionHandler.peerConnection.iceConnectionState);
                };

                // CRITICAL: Add all local tracks to peer connection BEFORE accepting
                if (localStreamRef.current) {
                  console.log('🚀 Patient adding local tracks to peer connection...');
                  localStreamRef.current.getTracks().forEach(track => {
                    console.log('🎤🎥 Patient adding local track:', track.kind, track.label, track.id);
                    sessionDescriptionHandler.peerConnection.addTrack(track, localStreamRef.current!);
                  });
                  
                  // Debug: Check what senders we have
                  const senders = sessionDescriptionHandler.peerConnection.getSenders();
                  console.log('📤 Patient senders after adding tracks:', senders.length);
                  senders.forEach((sender: any, index: number) => {
                    console.log(`Patient sender ${index}:`, sender.track?.kind, sender.track?.label);
                  });
                } else {
                  console.error('❌ Patient localStreamRef.current is null!');
                }

                // Handle incoming remote streams
                sessionDescriptionHandler.peerConnection.ontrack = (event: RTCTrackEvent) => {
                  console.log('🎯 Patient received remote track:', event.track.kind, event.track.label, event.track.id);
                  console.log('Patient remote stream before adding track:', patientRemoteStream.getTracks().length);
                  
                  patientRemoteStream.addTrack(event.track);
                  
                  console.log('Patient remote stream after adding track:', patientRemoteStream.getTracks().length);
                  
                  // Update the video element when we receive tracks
                  const setRemoteVideo = () => {
                    if (remoteVideoRef.current) {
                      console.log('🎥 Patient setting remote stream with', patientRemoteStream.getTracks().length, 'tracks to VIDEO element');
                      remoteVideoRef.current.srcObject = patientRemoteStream;
                      
                      // CRITICAL FIX: Always play the video element when we receive ANY track (audio or video)
                      // This ensures both audio and video tracks are played
                      console.log('🎬 Patient trying to play remote media (track kind:', event.track.kind + ')');
                      
                      // For audio tracks, ensure they are enabled
                      if (event.track.kind === 'audio') {
                        console.log('🔊 Patient: Ensuring audio track is enabled for playback');
                        event.track.enabled = true;
                        
                        // Set volume to maximum to ensure audio is audible
                        if (remoteVideoRef.current) {
                          remoteVideoRef.current.volume = 1.0;
                          remoteVideoRef.current.muted = false;
                        }
                      }
                      
                      remoteVideoRef.current.play().then(() => {
                        console.log('✅ Patient remote media playing successfully');
                        // Additional check for audio playback
                        if (event.track.kind === 'audio' && remoteVideoRef.current) {
                          console.log('🔊 Patient: Audio track should now be playing, volume:', remoteVideoRef.current.volume, 'muted:', remoteVideoRef.current.muted);
                        }
                      }).catch((error) => {
                        console.error('❌ Patient remote media play error:', error);
                        // If autoplay fails, user interaction might be required
                        if (error.name === 'NotAllowedError' || error.message.includes('play')) {
                          console.log('🔴 Patient: Autoplay blocked - user interaction required');
                          setNeedsAudioUnlock(true);
                        }
                      });
                    } else {
                      console.log('⏳ Patient video element is null, retrying in 100ms...');
                      // Retry after a short delay if video element isn't ready yet
                      setTimeout(setRemoteVideo, 100);
                    }
                  };
                  
                  setRemoteVideo();
                };

                // Store reference for use in fallback
                (sessionDescriptionHandler as any)._patientRemoteStream = patientRemoteStream;
              } else {
                console.log('⏳ Patient: SessionDescriptionHandler not ready yet, state:', state);
              }
            } else if (state === SessionState.Established) {
              setStatus('in-call');
              callTimer.current = setInterval(() => setCallDuration(d => d + 1), 1000);
              
              // Small delay to ensure DOM is updated before setting video
              setTimeout(() => {
                // Ensure local video is displayed during call
                if (localStreamRef.current) {
                  setHasLocalStream(true);
                  
                  // Set stream on the in-call video element
                  if (localVideoCallRef.current) {
                    console.log('Setting stream on localVideoCallRef for in-call');
                    localVideoCallRef.current.srcObject = localStreamRef.current;
                    localVideoCallRef.current.autoplay = true;
                    localVideoCallRef.current.muted = true;
                    localVideoCallRef.current.playsInline = true;
                    
                    localVideoCallRef.current.play().then(() => {
                      console.log('In-call local video playing successfully');
                    }).catch((error) => {
                      console.error('Error playing in-call local video:', error);
                    });
                  }
                  
                  // Also keep the preview video element updated
                  if (localVideoRef.current) {
                    localVideoRef.current.srcObject = localStreamRef.current;
                    localVideoRef.current.play().catch(console.error);
                  }
                }
                
                // CRITICAL: Ensure remote audio is working when call is established
                console.log('🔊 Patient: Call established - checking remote audio playback...');
                if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
                  const stream = remoteVideoRef.current.srcObject as MediaStream;
                  const audioTracks = stream.getAudioTracks();
                  console.log('🔊 Patient: Remote stream has', audioTracks.length, 'audio tracks');
                  
                  audioTracks.forEach((track, index) => {
                    console.log(`🔊 Patient: Audio track ${index}:`, {
                      enabled: track.enabled,
                      readyState: track.readyState,
                      muted: track.muted,
                      label: track.label
                    });
                  });
                  
                  // Ensure video element is not muted and volume is up
                  remoteVideoRef.current.muted = false;
                  remoteVideoRef.current.volume = 1.0;
                  
                  // Force play if not already playing
                  if (remoteVideoRef.current.paused) {
                    console.log('🔊 Patient: Remote video is paused, forcing play...');
                    remoteVideoRef.current.play().then(() => {
                      console.log('✅ Patient: Remote audio/video forced to play successfully');
                    }).catch((error) => {
                      console.error('❌ Patient: Failed to force play remote audio/video:', error);
                      if (error.name === 'NotAllowedError' || error.message.includes('play')) {
                        console.log('🔴 Patient: Autoplay blocked during call establishment - showing unlock button');
                        setNeedsAudioUnlock(true);
                      }
                    });
                  } else {
                    console.log('✅ Patient: Remote video is already playing');
                  }
                } else {
                  console.error('❌ Patient: No remote stream available when call established');
                }
              }, 100);
              
              // Additional fallback for remote stream in case ontrack events missed or DOM wasn't ready
              const sessionDescriptionHandler: any = invitation.sessionDescriptionHandler;
              if (sessionDescriptionHandler) {
                const patientRemoteStream = sessionDescriptionHandler._patientRemoteStream;
                
                // Check if we already have a remote stream from ontrack events
                if (!remoteVideoRef.current?.srcObject && patientRemoteStream && patientRemoteStream.getTracks().length > 0) {
                  console.log('🔍 Patient: Setting accumulated remote stream to video element...');
                  if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = patientRemoteStream;
                    remoteVideoRef.current.play().catch(console.error);
                  }
                } else if (!remoteVideoRef.current?.srcObject) {
                  console.log('🔍 Patient: No remote stream from ontrack, checking existing receivers...');
                  const remoteStream = new MediaStream();
                  sessionDescriptionHandler.peerConnection.getReceivers().forEach((receiver: any) => {
                    if (receiver.track) {
                      console.log('📥 Patient: Adding existing receiver track to remote stream:', receiver.track.kind);
                      remoteStream.addTrack(receiver.track);
                    }
                  });
                  
                  if (remoteStream.getTracks().length > 0 && remoteVideoRef.current) {
                    console.log('🎥 Patient: Setting fallback remote stream with', remoteStream.getTracks().length, 'tracks');
                    remoteVideoRef.current.srcObject = remoteStream;
                    remoteVideoRef.current.play().catch(console.error);
                  }
                }
              }
            } else if (state === SessionState.Terminated) {
              console.log('📞 Call terminated, cleaning up and returning to welcome page');
              
              // Clear call duration and timer
              setCallDuration(0);
              if (callTimer.current) clearInterval(callTimer.current);
              
              // Clear remote video when call ends
              if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
              
              // Stop and clear local stream completely
              if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
                localStreamRef.current = null;
              }
              
              // Clear video elements
              if (localVideoRef.current) {
                localVideoRef.current.srcObject = null;
              }
              if (localVideoCallRef.current) {
                localVideoCallRef.current.srcObject = null;
              }
              
              // Clear local video preview
              setHasLocalStream(false);
              
              // Clean up SIP session
              sessionRef.current = null;
              
              // Unregister and clean up SIP connection
              if (registererRef.current) {
                registererRef.current.unregister().catch(console.error);
                registererRef.current = null;
              }
              
              if (userAgentRef.current) {
                userAgentRef.current.stop();
                userAgentRef.current = null;
              }
              
              // Return to idle/welcome state
              setStatus('idle');
              setError(null);
            }
          });

          // Now accept the call with video constraints
          console.log('📞 Patient accepting the call...');
          invitation.accept({
            sessionDescriptionHandlerOptions: {
              constraints: {
                audio: true,
                video: true
              }
            }
          }).catch((err) => {
            console.error('❌ Patient failed to accept call:', err);
            setError('Failed to accept call: ' + err);
          });
        }
      }
    };

    const userAgent = new UserAgent(userAgentOptions);
    userAgentRef.current = userAgent;
    const registerer = new Registerer(userAgent);
    registererRef.current = registerer;

    try {
      await userAgent.start();
      await registerer.register();
      setStatus('waiting');
    } catch (err) {
      console.error('Registration failed:', err);
      setError(`Registration failed: ${err}`);
      setStatus('error');
    }
  };

  const handleLeave = async () => {
    if (sessionRef.current) {
      try {
        sessionRef.current.bye();
      } catch (err) {
        console.error('Failed to end call:', err);
      }
    }
    if (registererRef.current) {
      try {
        await registererRef.current.unregister();
      } catch (err) {
        console.error('Unregister failed:', err);
      }
    }
    if (userAgentRef.current) {
      userAgentRef.current.stop();
    }
    // Stop camera when leaving
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      if (localVideoCallRef.current) {
        localVideoCallRef.current.srcObject = null;
      }
      localStreamRef.current = null;
    }
    if (callTimer.current) {
      clearInterval(callTimer.current);
    }
    setStatus('idle');
    setHasLocalStream(false);
    setIsTestingDevices(false);
    setError(null);
    setCallDuration(0);
  };

  // Show local video in waiting state too
  const showLocalVideo = status === 'waiting' || status === 'in-call';
  
  return (
    <Box 
      sx={{ 
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#f5f5f5'
      }}
    >
      <Box 
        sx={{
          p: { xs: 2, sm: 3, md: 4 },
          maxWidth: showLocalVideo ? { xs: '100%', sm: 600, md: 800 } : { xs: '100%', sm: 400 },
          width: '100%',
          textAlign: 'center',
          bgcolor: 'white',
          borderRadius: 2,
          boxShadow: 1,
          mx: { xs: 1, sm: 2 }
        }}
      >
        {status !== 'in-call' && (
          <>
            <Typography variant="h4" gutterBottom>
              Welcome
            </Typography>
            <Typography variant="h5" gutterBottom color="primary" sx={{ mb: 3 }}>
              {clientName}
            </Typography>
          </>
        )}

        {status === 'idle' && (
          <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
            <Typography variant="body1">
              Click below to let the doctor know you're here for your appointment
            </Typography>
            
            <Box display="flex" alignItems="center" gap={2}>
              <Button 
                variant="contained" 
                color="primary" 
                size="large"
                onClick={startRegistration}
                startIcon={<VideoCallIcon />}
              >
                Let Doctor Know I'm Here
              </Button>
              
              <IconButton 
                color="primary"
                onClick={openTestDialog}
                sx={{ 
                  bgcolor: 'primary.light',
                  '&:hover': { bgcolor: 'primary.main', color: 'white' }
                }}
              >
                <SettingsIcon />
              </IconButton>
            </Box>
            
            {hasLocalStream && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="caption" display="block" mb={1}>
                  Your camera preview
                </Typography>
                <Box sx={{
                  width: 240,
                  height: 240,
                  backgroundColor: '#000',
                  border: '1px solid #ccc',
                  borderRadius: 1,
                  overflow: 'hidden',
                  mx: 'auto'
                }}>
                  <video 
                    ref={localVideoRef} 
                    autoPlay 
                    muted 
                    playsInline 
                    style={{ 
                      width: '100%', 
                      height: '100%',
                      objectFit: 'cover'
                    }} 
                  />
                </Box>
              </Box>
            )}
          </Box>
        )}

        {status === 'connecting' && (
          <Box display="flex" alignItems="center" justifyContent="center" gap={2}>
            <CircularProgress size={20} />
            <Typography>Connecting...</Typography>
          </Box>
        )}

        {status === 'waiting' && (
          <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
            <Typography variant="h6" sx={{ color: 'success.main' }}>
              Doctor has been notified
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Please wait for the doctor to start the call
            </Typography>
            <Button 
              variant="outlined" 
              color="primary" 
              onClick={handleLeave}
            >
              Leave Waiting Room
            </Button>
          </Box>
        )}

        {status === 'in-call' && (
          <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
            {/* Header with welcome, name, and connection status horizontal */}
            <Box display="flex" alignItems="center" gap={2} mb={1} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <Typography variant="h5" sx={{ display: { xs: 'none', sm: 'block' } }}>
                Welcome
              </Typography>
              <Typography variant="h5" color="primary" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
                {clientName}
              </Typography>
              <Typography variant="h6" color="success.main" sx={{ fontSize: { xs: '0.875rem', sm: '1rem' }, fontWeight: 'medium' }}>
                • Connected to doctor
              </Typography>
            </Box>
            
            {/* Audio Unlock Banner */}
            {needsAudioUnlock && (
              <Box sx={{
                width: '100%',
                maxWidth: 600,
                bgcolor: 'warning.light',
                border: '2px solid',
                borderColor: 'warning.main',
                borderRadius: 2,
                p: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                animation: 'pulse 2s infinite'
              }}>
                <VolumeUpIcon color="warning" sx={{ fontSize: '2rem' }} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h6" color="warning.dark" gutterBottom>
                    Audio Blocked
                  </Typography>
                  <Typography variant="body2" color="warning.dark">
                    Click the button below to enable audio and hear the doctor
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  color="warning"
                  size="large"
                  startIcon={<PlayArrowIcon />}
                  onClick={enableAudioPlayback}
                  sx={{
                    minWidth: 160,
                    fontWeight: 'bold',
                    textTransform: 'none'
                  }}
                >
                  Enable Audio
                </Button>
              </Box>
            )}
            
            {/* Main video layout */}
            <Box 
              display="flex" 
              gap={{ xs: 1, sm: 2, md: 3 }} 
              alignItems="flex-start" 
              width="100%"
              sx={{ 
                flexDirection: { xs: 'column', md: 'row' },
                alignItems: { xs: 'center', md: 'flex-start' }
              }}
            >
              {/* Your video (picture-in-picture style) with timer below */}
              <Box 
                display="flex" 
                flexDirection="column" 
                alignItems="center" 
                gap={2}
                sx={{ 
                  order: { xs: 2, md: 1 },
                  width: { xs: '100%', md: 'auto' }
                }}
              >
                <Box sx={{
                  width: { xs: 150, sm: 180, md: 200 },
                  height: { xs: 112, sm: 135, md: 150 },
                  backgroundColor: '#000',
                  borderRadius: 2,
                  overflow: 'hidden',
                  position: 'relative',
                  border: '2px solid',
                  borderColor: 'primary.main'
                }}>
                  <video 
                    ref={localVideoCallRef}
                    autoPlay 
                    muted 
                    playsInline
                    style={{ 
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }} 
                  />
                  <Typography 
                    variant="caption" 
                    sx={{
                      position: 'absolute',
                      bottom: 4,
                      left: 4,
                      color: 'white',
                      bgcolor: 'rgba(0,0,0,0.6)',
                      px: 0.5,
                      py: 0.25,
                      borderRadius: 0.5,
                      fontSize: { xs: '0.625rem', sm: '0.75rem' }
                    }}
                  >
                    You
                  </Typography>
                </Box>
                
                {/* Timer below your video */}
                <Box sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 1,
                  bgcolor: 'grey.100',
                  px: { xs: 1.5, sm: 2 },
                  py: { xs: 0.75, sm: 1 },
                  borderRadius: 2
                }}>
                  <Box sx={{
                    width: { xs: 6, sm: 8 },
                    height: { xs: 6, sm: 8 },
                    borderRadius: '50%',
                    bgcolor: 'success.main',
                    animation: 'pulse 2s infinite'
                  }} />
                  <Typography 
                    variant="body2" 
                    fontWeight="medium" 
                    color="text.primary"
                    sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}
                  >
                    {Math.floor(callDuration / 3600) > 0 
                      ? `${Math.floor(callDuration / 3600)}:${Math.floor((callDuration % 3600) / 60).toString().padStart(2, '0')}:${(callDuration % 60).toString().padStart(2, '0')}`
                      : `${Math.floor(callDuration / 60)}:${(callDuration % 60).toString().padStart(2, '0')}`
                    }
                  </Typography>
                </Box>
              </Box>
              
              {/* Doctor's main video */}
              <Box 
                sx={{ 
                  flex: 1,
                  order: { xs: 1, md: 2 },
                  width: { xs: '100%', md: 'auto' }
                }}
              >
                <Box sx={{
                  width: '100%',
                  height: { xs: 240, sm: 300, md: 360 },
                  backgroundColor: '#000',
                  borderRadius: 2,
                  overflow: 'hidden',
                  position: 'relative'
                }}>
                  <video 
                    ref={remoteVideoRef}
                    autoPlay 
                    playsInline
                    controls={false}
                    style={{ 
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }} 
                  />
                  <Typography 
                    variant="caption" 
                    sx={{
                      position: 'absolute',
                      bottom: { xs: 4, sm: 8 },
                      left: { xs: 4, sm: 8 },
                      color: 'white',
                      bgcolor: 'rgba(0,0,0,0.6)',
                      px: { xs: 0.5, sm: 1 },
                      py: { xs: 0.25, sm: 0.5 },
                      borderRadius: 1,
                      fontSize: { xs: '0.625rem', sm: '0.75rem' }
                    }}
                  >
                    Doctor
                  </Typography>
                </Box>
              </Box>
            </Box>
            
            {/* Control buttons - mute, camera, and hangup in a row */}
            <Box 
              display="flex" 
              gap={{ xs: 2, sm: 3 }} 
              alignItems="center"
              sx={{ mt: { xs: 1, sm: 2 } }}
            >
              {/* Mute button */}
              <IconButton
                color={isMuted ? "error" : "primary"}
                size="large"
                onClick={toggleMute}
                sx={{
                  width: { xs: 48, sm: 56 },
                  height: { xs: 48, sm: 56 },
                  bgcolor: isMuted ? 'error.main' : 'primary.main',
                  color: 'white',
                  '&:hover': {
                    bgcolor: isMuted ? 'error.dark' : 'primary.dark'
                  }
                }}
              >
                {isMuted ? 
                  <MicOffIcon sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }} /> : 
                  <MicIcon sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }} />
                }
              </IconButton>

              {/* Camera button */}
              <IconButton
                color={isCameraDisabled ? "error" : "primary"}
                size="large"
                onClick={toggleCamera}
                sx={{
                  width: { xs: 48, sm: 56 },
                  height: { xs: 48, sm: 56 },
                  bgcolor: isCameraDisabled ? 'error.main' : 'primary.main',
                  color: 'white',
                  '&:hover': {
                    bgcolor: isCameraDisabled ? 'error.dark' : 'primary.dark'
                  }
                }}
              >
                {isCameraDisabled ? 
                  <VideocamOffIcon sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }} /> : 
                  <VideocamIcon sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }} />
                }
              </IconButton>

              {/* Hangup button */}
              <IconButton
                color="error"
                size="large"
                onClick={handleLeave}
                sx={{
                  width: { xs: 56, sm: 64 },
                  height: { xs: 56, sm: 64 },
                  bgcolor: 'error.main',
                  color: 'white',
                  '&:hover': {
                    bgcolor: 'error.dark'
                  }
                }}
              >
                <CallEndIcon sx={{ fontSize: { xs: '1.5rem', sm: '2rem' } }} />
              </IconButton>
            </Box>
          </Box>
        )}

        {/* Device Test Dialog */}
        <Dialog 
          open={showTestDialog} 
          onClose={closeTestDialog}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            Test Camera & Microphone
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 2 }}>
              {/* Main Layout: Left (Device Controls) + Right (Camera Preview) */}
              <Box sx={{ display: 'flex', gap: 3 }}>
                {/* Left Column: Device Selection */}
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Camera Selection */}
                  <FormControl fullWidth>
                    <InputLabel>Camera</InputLabel>
                    <Select
                      value={selectedCamera}
                      label="Camera"
                      onChange={(e) => setSelectedCamera(e.target.value)}
                    >
                      {availableCameras.map((camera) => (
                        <MenuItem key={camera.deviceId} value={camera.deviceId}>
                          {camera.label || `Camera ${camera.deviceId.slice(0, 8)}...`}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Microphone Selection */}
                  <FormControl fullWidth>
                    <InputLabel>Microphone</InputLabel>
                    <Select
                      value={selectedMicrophone}
                      label="Microphone"
                      onChange={(e) => setSelectedMicrophone(e.target.value)}
                    >
                      {availableMicrophones.map((microphone) => (
                        <MenuItem key={microphone.deviceId} value={microphone.deviceId}>
                          {microphone.label || `Microphone ${microphone.deviceId.slice(0, 8)}...`}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Microphone Level Monitor */}
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <VolumeUpIcon 
                        fontSize="small"
                        color={audioLevel > 10 ? 'primary' : 'disabled'} 
                      />
                      <Typography variant="body2">
                        Microphone: {audioLevel > 10 ? 'Good' : 'Speak to test'}
                      </Typography>
                    </Box>
                    <Box sx={{
                      width: '100%',
                      height: 8,
                      backgroundColor: '#f0f0f0',
                      borderRadius: 4,
                      overflow: 'hidden'
                    }}>
                      <Box sx={{
                        width: `${Math.max(2, audioLevel)}%`,
                        height: '100%',
                        backgroundColor: audioLevel > 60 ? '#f44336' : audioLevel > 20 ? '#4caf50' : '#e0e0e0',
                        transition: 'width 0.1s ease, background-color 0.2s ease',
                        borderRadius: 'inherit'
                      }} />
                    </Box>
                  </Box>
                </Box>

                {/* Right Column: Camera Preview */}
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Camera Preview
                  </Typography>
                  <Box sx={{
                    width: '100%',
                    height: 240,
                    backgroundColor: '#000',
                    border: '1px solid #ccc',
                    borderRadius: 1,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <video 
                      ref={testVideoRef}
                      autoPlay 
                      muted 
                      playsInline
                      style={{ 
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }} 
                    />
                  </Box>
                </Box>
              </Box>

              {isTestingDevices && (
                <Box display="flex" alignItems="center" justifyContent="center" gap={2}>
                  <CircularProgress size={20} />
                  <Typography>Testing devices...</Typography>
                </Box>
              )}
            </Box>
          </DialogContent>
          <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 2 }}>
            <Box display="flex" gap={1}>
              {/* Mute toggle in test dialog */}
              <IconButton
                color={isMuted ? "error" : "primary"}
                onClick={toggleMute}
                sx={{
                  bgcolor: isMuted ? 'error.light' : 'primary.light',
                  '&:hover': {
                    bgcolor: isMuted ? 'error.main' : 'primary.main',
                    color: 'white'
                  }
                }}
              >
                {isMuted ? <MicOffIcon /> : <MicIcon />}
              </IconButton>

              {/* Camera toggle in test dialog */}
              <IconButton
                color={isCameraDisabled ? "error" : "primary"}
                onClick={toggleCamera}
                sx={{
                  bgcolor: isCameraDisabled ? 'error.light' : 'primary.light',
                  '&:hover': {
                    bgcolor: isCameraDisabled ? 'error.main' : 'primary.main',
                    color: 'white'
                  }
                }}
              >
                {isCameraDisabled ? <VideocamOffIcon /> : <VideocamIcon />}
              </IconButton>
            </Box>

            <Box display="flex" gap={1}>
              <Button onClick={closeTestDialog}>
                Cancel
              </Button>
              <Button 
                onClick={applyDeviceSettings} 
                variant="contained"
                disabled={!localStreamRef.current}
              >
                Use These Settings
              </Button>
            </Box>
          </DialogActions>
        </Dialog>

        {error && (
          <Typography 
            color="error" 
            sx={{ 
              mt: 2,
              bgcolor: 'error.light',
              p: 2,
              borderRadius: 1
            }}
          >
            {error}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

export default WaitForCallProfile;
