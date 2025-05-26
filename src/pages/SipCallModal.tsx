import React, { useEffect, useRef, useState } from 'react';
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
  VideocamOff as VideocamOffIcon
} from '@mui/icons-material';
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
    const [callDuration, setCallDuration] = useState<number>(0);
    const [isTestingDevices, setIsTestingDevices] = useState(false);
    const [hasLocalStream, setHasLocalStream] = useState(false);
    const [showTestDialog, setShowTestDialog] = useState(false);
    const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
    const [availableMicrophones, setAvailableMicrophones] = useState<MediaDeviceInfo[]>([]);
    const [selectedCamera, setSelectedCamera] = useState<string>('');
    const [selectedMicrophone, setSelectedMicrophone] = useState<string>('');
    const [audioLevel, setAudioLevel] = useState<number>(0);
    const [isMuted, setIsMuted] = useState<boolean>(() => {
        const saved = localStorage.getItem('sipCall_isMuted');
        return saved ? JSON.parse(saved) : false;
    });
    const [isCameraDisabled, setIsCameraDisabled] = useState<boolean>(() => {
        const saved = localStorage.getItem('sipCall_isCameraDisabled');
        return saved ? JSON.parse(saved) : false;
    });
    const callTimer = useRef<NodeJS.Timeout | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const localVideoCallRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const userAgentRef = useRef<UserAgent | null>(null);
    const registererRef = useRef<Registerer | null>(null);
    const sessionRef = useRef<Session | null>(null);
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

    // Toggle mute functionality
    const toggleMute = () => {
        const newMutedState = !isMuted;
        setIsMuted(newMutedState);
        localStorage.setItem('sipCall_isMuted', JSON.stringify(newMutedState));
        
        // Apply mute state to current stream
        if (localStreamRef.current) {
            const audioTracks = localStreamRef.current.getAudioTracks();
            audioTracks.forEach(track => {
                track.enabled = !newMutedState;
            });
        }

        // During active call, also update the peer connection senders
        if (status === 'in-call' && sessionRef.current) {
            const sessionDescriptionHandler: any = sessionRef.current.sessionDescriptionHandler;
            if (sessionDescriptionHandler && sessionDescriptionHandler.peerConnection) {
                const senders = sessionDescriptionHandler.peerConnection.getSenders();
                senders.forEach((sender: RTCRtpSender) => {
                    if (sender.track && sender.track.kind === 'audio') {
                        sender.track.enabled = !newMutedState;
                    }
                });
            }
        }
    };

    // Toggle camera functionality
    const toggleCamera = () => {
        const newCameraState = !isCameraDisabled;
        setIsCameraDisabled(newCameraState);
        localStorage.setItem('sipCall_isCameraDisabled', JSON.stringify(newCameraState));
        
        // Apply camera state to current stream
        if (localStreamRef.current) {
            const videoTracks = localStreamRef.current.getVideoTracks();
            videoTracks.forEach(track => {
                track.enabled = !newCameraState;
            });
        }

        // During active call, also update the peer connection senders
        if (status === 'in-call' && sessionRef.current) {
            const sessionDescriptionHandler: any = sessionRef.current.sessionDescriptionHandler;
            if (sessionDescriptionHandler && sessionDescriptionHandler.peerConnection) {
                const senders = sessionDescriptionHandler.peerConnection.getSenders();
                senders.forEach((sender: RTCRtpSender) => {
                    if (sender.track && sender.track.kind === 'video') {
                        sender.track.enabled = !newCameraState;
                    }
                });
            }
        }
    };

    // Apply current mute/camera settings to a stream
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

    // Apply settings for live call streams (ensures audio is enabled by default for calls)
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
            
            // Apply mute/camera settings to test stream
            applyStreamSettings(stream);
            
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
        // Ensure no preview shows after closing test dialog
        setHasLocalStream(false);
        setShowTestDialog(false);
    };

    // Apply tested devices and close dialog
    const applyDeviceSettings = () => {
        // Stop the test stream and clean up
        stopAudioMonitoring();
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }
        if (testVideoRef.current) {
            testVideoRef.current.srcObject = null;
        }
        // Don't show preview after applying settings - only show during calls
        setHasLocalStream(false);
        setShowTestDialog(false);
    };

    // Effect to test devices when selection changes
    useEffect(() => {
        if (showTestDialog && (selectedCamera || selectedMicrophone)) {
            testSelectedDevices();
        }
    }, [selectedCamera, selectedMicrophone, showTestDialog]);

    useEffect(() => {
        if (!open) {
            // Cleanup when modal closes
            if (sessionRef.current) sessionRef.current.bye();
            if (registererRef.current) registererRef.current.unregister();
            if (userAgentRef.current) userAgentRef.current.stop();
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
            stopAudioMonitoring();
            setStatus('idle');
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
            
            // Camera access will be requested when user starts a call or tests devices
        } catch (err) {
            console.error('Registration failed:', err);
            setStatus('error');
        }
    };

    const handleCall = async () => {
        try {
            if (clientId === DOCTOR_USER) {
                setError('You cannot call yourself.');
                return;
            }

            // Reset mute state to false when starting a call to ensure audio works
            setIsMuted(false);
            localStorage.setItem('sipCall_isMuted', JSON.stringify(false));

            // Request camera access before starting the call
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStreamRef.current = stream;
                setHasLocalStream(true);
                applyCallStreamSettings(stream);
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

            setStatus('calling');
            setError(null);

            const targetURI = UserAgent.makeURI(`sips:${clientId}@${SIP_REALM};transport=tls`);
            if (!targetURI) {
                setError('Invalid target SIP URI');
                setStatus('registered');
                setHasLocalStream(false);
                return;
            }

            // If we don't have a local stream yet, get one
            if (!localStreamRef.current) {
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    video: true,
                    audio: true 
                });
                localStreamRef.current = stream;
                setHasLocalStream(true);
                applyCallStreamSettings(stream);
                if (localVideoRef.current) {
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
                        video: true
                    }
                }
            });

            sessionRef.current = inviter;

            console.log('🚀 Doctor: Created inviter with video constraints');

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
                                if (remoteVideoRef.current) {
                                    console.log('🎥 Doctor setting remote stream with', doctorRemoteStream.getTracks().length, 'tracks to VIDEO element');
                                    remoteVideoRef.current.srcObject = doctorRemoteStream;
                                    
                                    // CRITICAL FIX: Always play the video element when we receive ANY track (audio or video)
                                    // This ensures both audio and video tracks are played
                                    console.log('🎬 Doctor trying to play remote media (track kind:', event.track.kind + ')');
                                    remoteVideoRef.current.play().then(() => {
                                        console.log('✅ Doctor remote media playing successfully');
                                    }).catch((error) => {
                                        console.error('❌ Doctor remote media play error:', error);
                                    });
                                } else {
                                    console.log('⏳ Doctor video element is null, retrying in 100ms...');
                                    // Retry after a short delay if video element isn't ready yet
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
                        // Ensure local video is displayed during call
                        if (localStreamRef.current) {
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
                        if (!remoteVideoRef.current?.srcObject && doctorRemoteStream.getTracks().length > 0) {
                            console.log('🔍 Setting accumulated remote stream to video element...');
                            if (remoteVideoRef.current) {
                                remoteVideoRef.current.srcObject = doctorRemoteStream;
                                remoteVideoRef.current.play().catch(console.error);
                            }
                        } else if (!remoteVideoRef.current?.srcObject) {
                            console.log('🔍 No remote stream from ontrack, checking existing receivers...');
                            const remoteStream = new MediaStream();
                            sessionDescriptionHandler.peerConnection.getReceivers().forEach((receiver: any) => {
                                if (receiver.track) {
                                    console.log('📥 Adding existing receiver track to remote stream:', receiver.track.kind);
                                    remoteStream.addTrack(receiver.track);
                                }
                            });
                            
                            if (remoteStream.getTracks().length > 0 && remoteVideoRef.current) {
                                console.log('🎥 Setting fallback remote stream with', remoteStream.getTracks().length, 'tracks');
                                remoteVideoRef.current.srcObject = remoteStream;
                                remoteVideoRef.current.play().catch(console.error);
                            }
                        }
                    }
                } else if (state === SessionState.Terminated) {
                    setStatus('registered');
                    setCallDuration(0);
                    setHasLocalStream(false);
                    if (callTimer.current) clearInterval(callTimer.current);

                    // Only clear remote video when call ends
                    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
                }
            });

            // Now make the actual call
            console.log('📞 Doctor making the video call...');
            inviter.invite().catch((err: any) => {
                console.error('❌ Call failed:', err);
                setError('Call failed: ' + err);
                setStatus('registered');
                setHasLocalStream(false);
            });
        } catch (err) {
            setError('Failed to initiate call: ' + (err instanceof Error ? err.message : String(err)));
            setStatus('registered');
            setHasLocalStream(false);
        }
    };

    const handleHangup = () => {
        if (sessionRef.current) {
            sessionRef.current.bye();
        }
        setStatus('registered');
        setCallDuration(0);
        setHasLocalStream(false);
        if (callTimer.current) clearInterval(callTimer.current);
    };

    // Show local video in calling and in-call states
    const showLocalVideo = status === 'calling' || status === 'in-call' || hasLocalStream;
    
    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <DialogContent sx={{ p: 0 }}>
                <Box 
                    sx={{
                        p: { xs: 2, sm: 3, md: 4 },
                        width: '100%',
                        textAlign: 'center',
                        minHeight: 400
                    }}
                >
                    {status !== 'in-call' && (
                        <>
                            <Typography variant="h4" gutterBottom>
                                Call Patient
                            </Typography>
                            <Typography variant="h5" gutterBottom color="primary" sx={{ mb: 3 }}>
                                {clientName}
                            </Typography>
                        </>
                    )}

                    {status === 'connecting' && (
                        <Box display="flex" alignItems="center" justifyContent="center" gap={2}>
                            <CircularProgress size={20} />
                            <Typography>Connecting...</Typography>
                        </Box>
                    )}

                    {status === 'registered' && (
                        <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
                            <Typography variant="body1">
                                Ready to call {clientName}
                            </Typography>
                            
                            <Box display="flex" alignItems="center" gap={2}>
                                <Button 
                                    variant="contained" 
                                    color="primary" 
                                    size="large"
                                    onClick={handleCall}
                                    startIcon={<VideoCallIcon />}
                                >
                                    Start Video Call
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

                    {status === 'calling' && (
                        <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
                            <Typography variant="h6" sx={{ color: 'primary.main' }}>
                                Calling {clientName}...
                            </Typography>
                            <CircularProgress />
                            <Typography variant="body1" color="text.secondary">
                                Please wait for the patient to answer
                            </Typography>
                            <Button 
                                variant="outlined" 
                                color="error" 
                                onClick={handleHangup}
                            >
                                Cancel Call
                            </Button>
                        </Box>
                    )}

                    {status === 'in-call' && (
                        <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
                            {/* Header with patient name and connection status horizontal */}
                            <Box display="flex" alignItems="center" gap={2} mb={1} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                                <Typography variant="h5" color="primary" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>
                                    {clientName}
                                </Typography>
                                <Typography variant="h6" color="success.main" sx={{ fontSize: { xs: '0.875rem', sm: '1rem' }, fontWeight: 'medium' }}>
                                    • Connected
                                </Typography>
                            </Box>
                            
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
                                
                                {/* Patient's main video */}
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
                                            {clientName}
                                        </Typography>
                                    </Box>
                                </Box>
                            </Box>
                            
                            {/* Control buttons - mute, camera, and hangup */}
                            <Box display="flex" alignItems="center" gap={2} sx={{ mt: { xs: 1, sm: 2 } }}>
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
                                    {isMuted ? <MicOffIcon sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }} /> : <MicIcon sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }} />}
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
                                    {isCameraDisabled ? <VideocamOffIcon sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }} /> : <VideocamIcon sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }} />}
                                </IconButton>
                                
                                {/* Hangup button */}
                                <IconButton
                                    color="error"
                                    size="large"
                                    onClick={handleHangup}
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

                                {/* Test Dialog Control Buttons */}
                                {localStreamRef.current && (
                                    <Box display="flex" alignItems="center" justifyContent="center" gap={2} sx={{ mt: 2 }}>
                                        {/* Mute button */}
                                        <IconButton
                                            color={isMuted ? "error" : "primary"}
                                            size="large"
                                            onClick={toggleMute}
                                            sx={{
                                                width: 48,
                                                height: 48,
                                                bgcolor: isMuted ? 'error.main' : 'primary.main',
                                                color: 'white',
                                                '&:hover': {
                                                    bgcolor: isMuted ? 'error.dark' : 'primary.dark'
                                                }
                                            }}
                                        >
                                            {isMuted ? <MicOffIcon /> : <MicIcon />}
                                        </IconButton>
                                        
                                        {/* Camera button */}
                                        <IconButton
                                            color={isCameraDisabled ? "error" : "primary"}
                                            size="large"
                                            onClick={toggleCamera}
                                            sx={{
                                                width: 48,
                                                height: 48,
                                                bgcolor: isCameraDisabled ? 'error.main' : 'primary.main',
                                                color: 'white',
                                                '&:hover': {
                                                    bgcolor: isCameraDisabled ? 'error.dark' : 'primary.dark'
                                                }
                                            }}
                                        >
                                            {isCameraDisabled ? <VideocamOffIcon /> : <VideocamIcon />}
                                        </IconButton>
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
            </DialogContent>
            {status !== 'in-call' && (
                <DialogActions>
                    <Button onClick={onClose}>Close</Button>
                </DialogActions>
            )}
        </Dialog>
    );
};

export default SipCallModal;