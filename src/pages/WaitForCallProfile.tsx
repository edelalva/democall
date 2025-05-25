import React, { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Typography, Box, CircularProgress, Button } from '@mui/material';
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
  const [callType, setCallType] = useState<'audio' | 'video' | null>(null);
  const [isTestingDevices, setIsTestingDevices] = useState(false);
  const [hasLocalStream, setHasLocalStream] = useState(false);
  const callTimer = useRef<NodeJS.Timeout | null>(null);
  const userAgentRef = useRef<UserAgent | null>(null);
  const registererRef = useRef<Registerer | null>(null);
  const sessionRef = useRef<any>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoCallRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

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
          
          // Detect call type from SDP offer
          const offer = sessionDescriptionHandler?.remoteSessionDescription?.sdp || '';
          const isVideoCall = offer.includes('m=video');
          const callTypeDetected = isVideoCall ? 'video' : 'audio';
          console.log('🎯 Patient detected call type:', callTypeDetected);
          setCallType(callTypeDetected);

          // First, ensure we have local stream
          if (!localStreamRef.current) {
            try {
              console.log('Patient getting local stream for call...');
              const stream = await navigator.mediaDevices.getUserMedia({ 
                video: callTypeDetected === 'video',
                audio: true 
              });
              console.log('Patient got local stream:', stream.getTracks().map(t => `${t.kind}: ${t.label}`));
              localStreamRef.current = stream;
              setHasLocalStream(callTypeDetected === 'video');
              if (localVideoRef.current && callTypeDetected === 'video') {
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

            // Handle incoming remote streams - declare in wider scope
            const patientRemoteStream = new MediaStream();
            sessionDescriptionHandler.peerConnection.ontrack = (event: RTCTrackEvent) => {
              console.log('🎯 Patient received remote track:', event.track.kind, event.track.label, event.track.id);
              console.log('Patient remote stream before adding track:', patientRemoteStream.getTracks().length);
              
              patientRemoteStream.addTrack(event.track);
              
              console.log('Patient remote stream after adding track:', patientRemoteStream.getTracks().length);
              
              // Update the video element when we receive tracks - with retry mechanism
              const setRemoteVideo = () => {
                if (callTypeDetected === 'video' && remoteVideoRef.current) {
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
                } else if (callTypeDetected === 'audio' && remoteAudioRef.current) {
                  console.log('🔊 Patient setting remote stream with', patientRemoteStream.getTracks().length, 'tracks to AUDIO element');
                  remoteAudioRef.current.srcObject = patientRemoteStream;
                  
                  // Ensure audio plays
                  if (event.track.kind === 'audio') {
                    console.log('🎵 Patient trying to play remote audio');
                    remoteAudioRef.current.play().then(() => {
                      console.log('✅ Patient remote audio playing successfully');
                    }).catch((error) => {
                      console.error('❌ Patient remote audio play error:', error);
                    });
                  }
                } else {
                  console.log('⏳ Patient media element is null, retrying in 100ms...');
                  // Retry after a short delay if audio/video element isn't ready yet
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
                  setHasLocalStream(callTypeDetected === 'video');
                  
                  // Set stream on the in-call video element for video calls
                  if (callTypeDetected === 'video' && localVideoCallRef.current) {
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
                  
                  // Also keep the preview video element updated for video calls
                  if (callTypeDetected === 'video' && localVideoRef.current) {
                    localVideoRef.current.srcObject = localStreamRef.current;
                    localVideoRef.current.play().catch(console.error);
                  }
                }
              }, 100);
              
              // Additional fallback for remote stream in case ontrack events missed or DOM wasn't ready
              const sessionDescriptionHandler: any = invitation.sessionDescriptionHandler;
              if (sessionDescriptionHandler) {
                const patientRemoteStream = sessionDescriptionHandler._patientRemoteStream;
                const targetElement = callTypeDetected === 'video' ? remoteVideoRef.current : remoteAudioRef.current;
                
                // Check if we already have a remote stream from ontrack events
                if (!targetElement?.srcObject && patientRemoteStream && patientRemoteStream.getTracks().length > 0) {
                  console.log('🔍 Patient: Setting accumulated remote stream to', callTypeDetected, 'element...');
                  if (targetElement) {
                    targetElement.srcObject = patientRemoteStream;
                    targetElement.play().catch(console.error);
                  }
                } else if (!targetElement?.srcObject) {
                  console.log('🔍 Patient: No remote stream from ontrack, checking existing receivers...');
                  const remoteStream = new MediaStream();
                  sessionDescriptionHandler.peerConnection.getReceivers().forEach((receiver: any) => {
                    if (receiver.track) {
                      console.log('📥 Patient: Adding existing receiver track to remote stream:', receiver.track.kind);
                      remoteStream.addTrack(receiver.track);
                    }
                  });
                  
                  if (remoteStream.getTracks().length > 0 && targetElement) {
                    console.log('🎥 Patient: Setting fallback remote stream with', remoteStream.getTracks().length, 'tracks');
                    targetElement.srcObject = remoteStream;
                    targetElement.play().catch(console.error);
                  }
                }
              }
            } else if (state === SessionState.Terminated) {
              setStatus('waiting');
              setCallDuration(0);
              setCallType(null);
              if (callTimer.current) clearInterval(callTimer.current);
              
              // Don't clear local video when call ends, keep it for preview
              if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
              if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
              
              // Keep local stream active for preview
              if (localStreamRef.current) {
                setHasLocalStream(true);
              }
            }
          });

          // Now accept the call with the constraints
          console.log('📞 Patient accepting the call...');
          invitation.accept({
            sessionDescriptionHandlerOptions: {
              constraints: {
                audio: true,
                video: callTypeDetected === 'video'
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
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
      }
      localStreamRef.current = null;
    }
    setStatus('idle');
    setHasLocalStream(false);
    setIsTestingDevices(false);
    setCallType(null);
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
            
            <Button 
              variant="outlined"
              disabled={isTestingDevices}
              onClick={testCameraAndMic}
              sx={{ mb: 2 }}
            >
              {isTestingDevices ? (
                <>
                  <CircularProgress size={16} sx={{ mr: 1 }} />
                  Testing Devices...
                </>
              ) : (
                'Test Camera & Microphone'
              )}
            </Button>
            
            <Box sx={{ mt: 2, minHeight: 200 }}>
              <Typography variant="caption" display="block" mb={1}>
                {hasLocalStream ? 'Your camera preview' : 'Camera preview will appear here'}
              </Typography>
              <Box sx={{
                width: 240,
                height: 180,
                backgroundColor: hasLocalStream ? '#000' : '#f5f5f5',
                border: '1px solid #ccc',
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative'
              }}>
                <video 
                  ref={localVideoRef} 
                  autoPlay 
                  muted 
                  playsInline 
                  style={{ 
                    width: '100%', 
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: 4,
                    display: hasLocalStream ? 'block' : 'none'
                  }} 
                />
                {!hasLocalStream && (
                  <Typography variant="body2" color="textSecondary" sx={{ textAlign: 'center', p: 2 }}>
                    Click "Test Camera & Microphone" to see your video preview
                  </Typography>
                )}
              </Box>
            </Box>
            
            <Button 
              variant="contained" 
              color="primary" 
              size="large"
              onClick={startRegistration}
            >
              Let Doctor Know I'm Here
            </Button>
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
              In call with doctor ({callType})
            </Typography>
            <Typography variant="body1" mb={2}>
              Duration: {callDuration}s
            </Typography>
            
            {callType === 'video' && (
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
            )}
            
            {callType === 'audio' && (
              <Box display="flex" flexDirection="column" alignItems="center" gap={3} sx={{ py: 4 }}>
                <Box sx={{ 
                  fontSize: '4rem',
                  mb: 2 
                }}>
                  🎙️
                </Box>
                <Typography variant="h5" color="primary">
                  Audio Call in Progress
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center' }}>
                  You are connected with the doctor.<br />
                  You can hear each other's voice.
                </Typography>
                {/* Hidden audio element for playing remote audio */}
                <audio 
                  ref={remoteAudioRef}
                  autoPlay
                  style={{ display: 'none' }}
                />
              </Box>
            )}
          </Box>
        )}

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
