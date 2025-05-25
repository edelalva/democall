import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, CircularProgress } from '@mui/material';
import { UserAgent, Registerer, Inviter, SessionState, UserAgentOptions, Session } from 'sip.js';

interface SipCallModalProps {
    open: boolean;
    onClose: () => void;
    clientId: string;
    clientName: string;
}

const SIP_WS = 'wss://fs1.sn.wizher.com:7443';
const SIP_REALM = 'fs1.sn.wizher.com';
const DOCTOR_USER = 'doctor1';
const DOCTOR_PASS = '4321';

const SipCallModal = function (props: SipCallModalProps) {
    const { open, onClose, clientId, clientName } = props;
    const [status, setStatus] = useState<'idle' | 'connecting' | 'registered' | 'calling' | 'in-call' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [callType, setCallType] = useState<'audio' | 'video' | null>(null);
    const [callDuration, setCallDuration] = useState<number>(0);
    const [isTestingDevices, setIsTestingDevices] = useState(false);
    const [hasLocalStream, setHasLocalStream] = useState(false);
    const callTimer = useRef<NodeJS.Timeout | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const localVideoCallRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const remoteAudioRef = useRef<HTMLAudioElement>(null);
    const userAgentRef = useRef<UserAgent | null>(null);
    const registererRef = useRef<Registerer | null>(null);
    const sessionRef = useRef<Session | null>(null);
    const localStreamRef = useRef<MediaStream | null>(null);

    useEffect(() => {
        if (!open) {
            if (sessionRef.current) sessionRef.current.bye();
            if (registererRef.current) registererRef.current.unregister();
            if (userAgentRef.current) userAgentRef.current.stop();
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = null;
                }
                if (remoteAudioRef.current) {
                    remoteAudioRef.current.srcObject = null;
                }
            }
            setStatus('idle');
            setCallType(null);
            setCallDuration(0);
            setError(null);
            setHasLocalStream(false);
            setIsTestingDevices(false);
        } else {
            setStatus('connecting');
            setError(null);
            setHasLocalStream(false);
            setIsTestingDevices(false);
            // Start SIP registration
            handleRegistration();
        }
    }, [open]);

    const handleRegistration = async () => {
        const uri = UserAgent.makeURI(`sips:${DOCTOR_USER}@${SIP_REALM};transport=tls`);
        if (!uri) {
            setError('Invalid SIP URI');
            setStatus('error');
            return;
        }

        const userAgentOptions: UserAgentOptions = {
            uri,
            authorizationUsername: DOCTOR_USER,
            authorizationPassword: DOCTOR_PASS,
            transportOptions: {
                server: SIP_WS,
                connectionOptions: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'turn:global.relay.metered.ca:80', username: 'openai', credential: 'openai' }
                    ]
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
            setStatus('registered');
            
            // Request camera access right after successful registration for video preview
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStreamRef.current = stream;
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }
            } catch (err) {
                console.error('Camera access failed:', err);
                // Don't set error state, just log it since camera access is optional at this stage
            }
        } catch (err) {
            console.error('Registration failed:', err);
            setStatus('error');
        }
    };

    const handleCall = async (type: 'audio' | 'video') => {
        try {
            if (clientId === DOCTOR_USER) {
                setError('You cannot call yourself.');
                return;
            }

            // Request camera access before starting the call for video calls
            if (type === 'video') {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    localStreamRef.current = stream;
                    setHasLocalStream(true);
                    if (localVideoRef.current) {
                        localVideoRef.current.srcObject = stream;
                        // Ensure video plays
                        try {
                            await localVideoRef.current.play();
                        } catch (playError) {
                            console.error('Error playing video during call setup:', playError);
                        }
                    }
                } catch (err) {
                    console.error('Failed to access camera:', err);
                    setError('Failed to access camera. Please make sure your camera is connected and you have granted permission to use it.');
                    return;
                }
            }

            setCallType(type);
            setStatus('calling');
            setError(null);

            const targetURI = UserAgent.makeURI(`sips:${clientId}@${SIP_REALM};transport=tls`);
            if (!targetURI) {
                setError('Invalid target SIP URI');
                setStatus('registered');
                return;
            }

            // If we don't have a local stream yet, get one
            if (!localStreamRef.current) {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: type === 'video',
                    audio: true 
                });
                localStreamRef.current = stream;
                setHasLocalStream(type === 'video');
                if (localVideoRef.current && type === 'video') {
                    localVideoRef.current.srcObject = stream;
                    try {
                        await localVideoRef.current.play();
                    } catch (playError) {
                        console.error('Error playing video:', playError);
                    }
                }
            }

            // Create a persistent remote stream that will accumulate tracks
            let doctorRemoteStream = new MediaStream();

            const inviter = new Inviter(userAgentRef.current!, targetURI, {
                sessionDescriptionHandlerOptions: {
                    constraints: {
                        audio: true,
                        video: type === 'video'
                    }
                }
            });

            sessionRef.current = inviter;

            console.log('🚀 Doctor: Created inviter with constraints:', { audio: true, video: type === 'video' });

            // Set up session state handler for call state management  
            inviter.stateChange.addListener((state) => {
                console.log(`🎯 Doctor session state changed to: ${state}`);
                
                if (state === SessionState.Initial || state === SessionState.Establishing) {
                    // Access sessionDescriptionHandler when it becomes available
                    const sessionDescriptionHandler: any = inviter.sessionDescriptionHandler;
                    if (sessionDescriptionHandler && sessionDescriptionHandler.peerConnection) {
                        console.log('✅ Doctor: SessionDescriptionHandler available, setting up peer connection');
                        
                        // Set up ontrack handler FIRST
                        sessionDescriptionHandler.peerConnection.ontrack = (event: RTCTrackEvent) => {
                            console.log('🎯 Doctor received remote track:', event.track.kind, event.track.label, event.track.id);
                            console.log('Doctor remote stream before adding track:', doctorRemoteStream.getTracks().length);
                            
                            // Add track to our persistent remote stream
                            doctorRemoteStream.addTrack(event.track);
                            
                            console.log('Doctor remote stream after adding track:', doctorRemoteStream.getTracks().length);
                            
                            // Update the video element when we receive tracks - with retry mechanism
                            const setRemoteVideo = () => {
                                if (callType === 'video' && remoteVideoRef.current) {
                                    console.log('🎥 Doctor setting remote stream with', doctorRemoteStream.getTracks().length, 'tracks to VIDEO element');
                                    remoteVideoRef.current.srcObject = doctorRemoteStream;
                                    
                                    // Ensure video plays for video tracks
                                    if (event.track.kind === 'video') {
                                        console.log('🎬 Doctor trying to play remote video');
                                        remoteVideoRef.current.play().then(() => {
                                            console.log('✅ Doctor remote video playing successfully');
                                        }).catch((error) => {
                                            console.error('❌ Doctor remote video play error:', error);
                                        });
                                    }
                                } else if (callType === 'audio' && remoteAudioRef.current) {
                                    console.log('🔊 Doctor setting remote stream with', doctorRemoteStream.getTracks().length, 'tracks to AUDIO element');
                                    remoteAudioRef.current.srcObject = doctorRemoteStream;
                                    
                                    // Ensure audio plays
                                    if (event.track.kind === 'audio') {
                                        console.log('🎵 Doctor trying to play remote audio');
                                        remoteAudioRef.current.play().then(() => {
                                            console.log('✅ Doctor remote audio playing successfully');
                                        }).catch((error) => {
                                            console.error('❌ Doctor remote audio play error:', error);
                                        });
                                    }
                                } else {
                                    console.log('⏳ Doctor media element is null, retrying in 100ms...');
                                    // Retry after a short delay if audio/video element isn't ready yet
                                    setTimeout(setRemoteVideo, 100);
                                }
                            };
                            
                            setRemoteVideo();
                        };

                        // Add debugging for peer connection state
                        sessionDescriptionHandler.peerConnection.onconnectionstatechange = () => {
                            console.log('🔗 Doctor peer connection state:', sessionDescriptionHandler.peerConnection.connectionState);
                        };

                        sessionDescriptionHandler.peerConnection.oniceconnectionstatechange = () => {
                            console.log('🧊 Doctor ICE connection state:', sessionDescriptionHandler.peerConnection.iceConnectionState);
                        };

                        // CRITICAL: Add local stream to peer connection 
                        if (localStreamRef.current) {
                            console.log('🚀 Doctor adding local tracks to peer connection...');
                            localStreamRef.current.getTracks().forEach(track => {
                                console.log('🎤🎥 Doctor adding local track:', track.kind, track.label, track.id);
                                sessionDescriptionHandler.peerConnection.addTrack(track, localStreamRef.current!);
                            });
                            
                            // Debug: Check what senders we have
                            const senders = sessionDescriptionHandler.peerConnection.getSenders();
                            console.log('📤 Doctor senders after adding tracks:', senders.length);
                            senders.forEach((sender: any, index: number) => {
                                console.log(`Doctor sender ${index}:`, sender.track?.kind, sender.track?.label);
                            });
                        } else {
                            console.error('❌ Doctor localStreamRef.current is null!');
                        }
                    } else {
                        console.log('⏳ Doctor: SessionDescriptionHandler not ready yet, state:', state);
                    }
                } else if (state === SessionState.Established) {
                    setStatus('in-call');
                    callTimer.current = setInterval(() => setCallDuration(d => d + 1), 1000);

                    // Small delay to ensure DOM is updated before setting video
                    setTimeout(() => {
                        // Ensure local video is displayed during call for video calls
                        if (type === 'video' && localStreamRef.current) {
                            console.log('✅ Setting up local video for in-call state...');
                            setHasLocalStream(true);
                            
                            // Set stream on the in-call video element
                            if (localVideoCallRef.current) {
                                console.log('📹 Setting stream on localVideoCallRef');
                                localVideoCallRef.current.srcObject = localStreamRef.current;
                                localVideoCallRef.current.autoplay = true;
                                localVideoCallRef.current.muted = true;
                                localVideoCallRef.current.playsInline = true;
                                
                                localVideoCallRef.current.play().then(() => {
                                    console.log('✅ In-call local video playing successfully');
                                }).catch((error) => {
                                    console.error('❌ Error playing in-call local video:', error);
                                });
                            } else {
                                console.error('❌ localVideoCallRef.current is null');
                            }
                            
                            // Also keep the preview video element updated
                            if (localVideoRef.current) {
                                localVideoRef.current.srcObject = localStreamRef.current;
                                localVideoRef.current.play().catch(console.error);
                            }
                            
                            console.log('✅ Local video setup completed for in-call state');
                        }
                    }, 100);

                    // Additional fallback for remote stream in case ontrack events missed or DOM wasn't ready
                    const sessionDescriptionHandler: any = inviter.sessionDescriptionHandler;
                    if (sessionDescriptionHandler && sessionDescriptionHandler.peerConnection) {
                        // Check if we already have a remote stream from ontrack events
                        const targetElement = callType === 'video' ? remoteVideoRef.current : remoteAudioRef.current;
                        if (!targetElement?.srcObject && doctorRemoteStream.getTracks().length > 0) {
                            console.log('🔍 Setting accumulated remote stream to', callType, 'element...');
                            if (targetElement) {
                                targetElement.srcObject = doctorRemoteStream;
                                targetElement.play().catch(console.error);
                            }
                        } else if (!targetElement?.srcObject) {
                            console.log('🔍 No remote stream from ontrack, checking existing receivers...');
                            const remoteStream = new MediaStream();
                            sessionDescriptionHandler.peerConnection.getReceivers().forEach((receiver: any) => {
                                if (receiver.track) {
                                    console.log('📥 Adding existing receiver track to remote stream:', receiver.track.kind);
                                    remoteStream.addTrack(receiver.track);
                                }
                            });
                            
                            if (remoteStream.getTracks().length > 0 && targetElement) {
                                console.log('🎥 Setting fallback remote stream with', remoteStream.getTracks().length, 'tracks');
                                targetElement.srcObject = remoteStream;
                                targetElement.play().catch(console.error);
                            }
                        }
                    }
                } else if (state === SessionState.Terminated) {
                    setStatus('registered');
                    setCallType(null);
                    setCallDuration(0);
                    if (callTimer.current) clearInterval(callTimer.current);

                    // Only clear remote video when call ends, keep local stream for preview
                    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
                    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
                    
                    // Keep local stream active for preview if we have one
                    if (localStreamRef.current) {
                        setHasLocalStream(true);
                    }
                }
            });

            // Now make the actual call
            console.log('📞 Doctor making the invite call...');
            inviter.invite().catch((err: any) => {
                console.error('❌ Call failed:', err);
                setError('Call failed: ' + err);
                setStatus('registered');
            });
        } catch (err) {
            setError('Failed to initiate call: ' + (err instanceof Error ? err.message : String(err)));
            setStatus('registered');
        }
    };

    const handleHangup = () => {
        if (sessionRef.current) {
            sessionRef.current.bye();
        }
        setStatus('registered');
        setCallType(null);
        setCallDuration(0);
        if (callTimer.current) clearInterval(callTimer.current);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Call {clientName}</DialogTitle>
            <DialogContent>
                {status === 'connecting' && <Box display="flex" alignItems="center"><CircularProgress size={20} /><Typography ml={2}>Connecting...</Typography></Box>}
                {status === 'registered' && (
                    <Box display="flex" flexDirection="column" gap={3}>
                        <Button 
                            variant="outlined"
                            disabled={isTestingDevices}
                            onClick={async () => {
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
                            }}
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
                        <Box display="flex" gap={2}>
                            <Button variant="contained" color="primary" onClick={() => handleCall('audio')}>Audio Call</Button>
                            <Button variant="contained" color="secondary" onClick={() => handleCall('video')}>Video Call</Button>
                        </Box>
                    </Box>
                )}
                {status === 'calling' && (
                    <Box>
                        <Typography>Calling {clientName}...</Typography>
                        {callType === 'video' && hasLocalStream && (
                            <Box sx={{ mt: 2 }}>
                                <Typography variant="caption" display="block" mb={1}>Your camera (preview)</Typography>
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
                    </Box>
                )}
                {status === 'in-call' && (
                    <Box>
                        <Typography>In call with {clientName} ({callType})</Typography>
                        <Typography>Duration: {callDuration}s</Typography>
                        <Box display="flex" gap={2} mt={2}>
                            {callType === 'video' && (
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
                            )}
                            {callType === 'video' && (
                                <Box>
                                    <Typography variant="caption" display="block" mb={1}>Patient's camera</Typography>
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
                            )}
                            {callType === 'audio' && (
                                <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
                                    <Typography variant="h6">Audio Call in Progress</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        🎤 You can hear each other's voice
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
                    </Box>
                )}
                {error && <Typography color="error">{error}</Typography>}
            </DialogContent>
            <DialogActions>
                {status === 'in-call' && <Button onClick={handleHangup} color="error">Hang Up</Button>}
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default SipCallModal;