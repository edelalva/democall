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
  VolumeUp as VolumeUpIcon 
} from '@mui/icons-material';
import { UserAgent, Registerer, Invitation, SessionState, UserAgentOptions } from 'sip.js';
import { getClientName } from '../clientNameMap';

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
    setHasLocalStream(!!localStreamRef.current);
    if (localStreamRef.current && localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch(console.error);
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

          // Set up peer connection handling IMMEDIATELY
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
            const patientRemoteStream = new MediaStream();
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
                  
                  // Ensure video plays for video tracks
                  if (event.track.kind === 'video') {
                    console.log('🎬 Patient trying to play remote video');
                    remoteVideoRef.current.play().then(() => {
                      console.log('✅ Patient remote video playing successfully');
                    }).catch((error) => {
                      console.error('❌ Patient remote video play error:', error);
                    });
                  }
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
            console.error('❌ Patient sessionDescriptionHandler or peerConnection is null immediately!');
          }

          invitation.stateChange.addListener((state) => {
            if (state === SessionState.Established) {
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
              setStatus('waiting');
              setCallDuration(0);
              if (callTimer.current) clearInterval(callTimer.current);
              
              // Don't clear local video when call ends, keep it for preview
              if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
              
              // Keep local stream active for preview
              if (localStreamRef.current) {
                setHasLocalStream(true);
              }
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
    setStatus('idle');
    setHasLocalStream(false);
    setIsTestingDevices(false);
    setError(null);
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
          p: 4,
          maxWidth: showLocalVideo ? 800 : 400,
          width: '100%',
          textAlign: 'center',
          bgcolor: 'white',
          borderRadius: 2,
          boxShadow: 1
        }}
      >
        <Typography variant="h4" gutterBottom>
          Welcome
        </Typography>
        <Typography variant="h5" gutterBottom color="primary" sx={{ mb: 3 }}>
          {clientName}
        </Typography>

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
                  height: 180,
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
            {hasLocalStream && (
              <Box>
                <Typography variant="caption" display="block" mb={1}>Your camera preview</Typography>
                <Box sx={{
                  width: 240,
                  height: 180,
                  backgroundColor: '#000',
                  border: '1px solid #ccc',
                  borderRadius: 1,
                  overflow: 'hidden'
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
          <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
            <Typography variant="h6" color="primary">
              In video call with doctor
            </Typography>
            <Typography variant="body1" mb={2}>
              Duration: {callDuration}s
            </Typography>
            
            <Box display="flex" gap={2} justifyContent="center" width="100%">
              <Box>
                <Typography variant="caption" display="block" mb={1}>Your camera</Typography>
                <Box sx={{
                  width: 240,
                  height: 180,
                  backgroundColor: '#000',
                  border: '1px solid #ccc',
                  borderRadius: 1,
                  overflow: 'hidden'
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
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" display="block" mb={1}>Doctor's camera</Typography>
                <Box sx={{
                  width: 480,
                  height: 360,
                  backgroundColor: '#000',
                  border: '1px solid #ccc',
                  borderRadius: 1,
                  overflow: 'hidden'
                }}>
                  <video 
                    ref={remoteVideoRef}
                    autoPlay 
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

              {/* Video Preview */}
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Camera Preview
                </Typography>
                <Box sx={{
                  width: '100%',
                  height: 300,
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

              {/* Microphone Level Monitor */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <VolumeUpIcon />
                  <Typography variant="subtitle2">
                    Microphone Level
                  </Typography>
                </Box>
                <Box sx={{
                  width: '100%',
                  height: 20,
                  backgroundColor: '#f5f5f5',
                  border: '1px solid #ccc',
                  borderRadius: 1,
                  overflow: 'hidden',
                  position: 'relative'
                }}>
                  <Box sx={{
                    width: `${audioLevel}%`,
                    height: '100%',
                    backgroundColor: audioLevel > 70 ? '#f44336' : audioLevel > 40 ? '#ff9800' : '#4caf50',
                    transition: 'width 0.1s ease'
                  }} />
                </Box>
                <Typography variant="caption" color="textSecondary">
                  Speak into your microphone to test the audio level
                </Typography>
              </Box>

              {isTestingDevices && (
                <Box display="flex" alignItems="center" justifyContent="center" gap={2}>
                  <CircularProgress size={20} />
                  <Typography>Testing devices...</Typography>
                </Box>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
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
