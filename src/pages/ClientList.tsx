import React, { useState, useEffect } from 'react';
import { 
    Button, Card, CardContent, Typography, Stack, Dialog, DialogTitle, DialogContent, 
    IconButton, Box, Chip, Avatar, Divider, Paper, Tab, Tabs, Badge
} from '@mui/material';
import { useListContext } from 'react-admin';
import { getClientName } from '../clientNameMap';
import SipCallModal from './SipCallModal';
import CloseIcon from '@mui/icons-material/Close';
import { QRCodeSVG } from 'qrcode.react';
import PersonIcon from '@mui/icons-material/Person';
import ScheduleIcon from '@mui/icons-material/Schedule';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import PhoneIcon from '@mui/icons-material/Phone';
import EventIcon from '@mui/icons-material/Event';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import LinkIcon from '@mui/icons-material/Link';

// Mock appointment data with realistic medical scheduling
const mockAppointments = {
    '1000': { // Juan Dela Cruz
        nextAppointment: '2025-06-20T10:00:00',
        type: 'Consultation',
        department: 'General Medicine',
        reason: 'Follow-up check for hypertension',
        duration: 30
    },
    '1001': { // Maria Clara
        nextAppointment: '2025-06-20T14:30:00',
        type: 'Therapy Session',
        department: 'Physical Therapy',
        reason: 'Post-surgery rehabilitation',
        duration: 45
    },
    '1002': { // Jose Rizal
        nextAppointment: '2025-06-21T09:15:00',
        type: 'Diagnostic',
        department: 'Cardiology',
        reason: 'ECG and stress test',
        duration: 60
    },
    '1003': { // Gabriela Silang
        nextAppointment: '2025-06-20T16:00:00',
        type: 'Consultation',
        department: 'Dermatology',
        reason: 'Skin condition assessment',
        duration: 30
    },
    '1004': { // Andres Bonifacio
        nextAppointment: '2025-06-22T11:30:00',
        type: 'Surgery Prep',
        department: 'Orthopedics',
        reason: 'Pre-operative consultation',
        duration: 45
    },
    '1005': { // Gregoria de Jesus
        nextAppointment: '2025-06-20T13:00:00',
        type: 'Consultation',
        department: 'Psychiatry',
        reason: 'Mental health follow-up',
        duration: 60
    },
    '1006': { // Apolinario Mabini
        nextAppointment: '2025-06-21T15:45:00',
        type: 'Lab Results',
        department: 'Internal Medicine',
        reason: 'Blood work review',
        duration: 15
    },
    '1007': { // Emilio Aguinaldo
        nextAppointment: '2025-06-23T08:30:00',
        type: 'Consultation',
        department: 'Neurology',
        reason: 'Migraine treatment plan',
        duration: 45
    },
    '1008': { // Melchora Aquino
        nextAppointment: '2025-06-20T11:15:00',
        type: 'Vaccination',
        department: 'Family Medicine',
        reason: 'Annual flu shot',
        duration: 15
    },
    '1009': { // Lapu-Lapu
        nextAppointment: '2025-06-21T14:00:00',
        type: 'Emergency',
        department: 'Emergency Medicine',
        reason: 'Urgent care consultation',
        duration: 30
    },
    '1010': { // Queen Urduja
        nextAppointment: '2025-06-22T10:30:00',
        type: 'Consultation',
        department: 'Gynecology',
        reason: 'Routine women\'s health exam',
        duration: 30
    },
    '1011': { // Ferdinand Magellan
        nextAppointment: '2025-06-20T15:30:00',
        type: 'Consultation',
        department: 'Gastroenterology',
        reason: 'Digestive health assessment',
        duration: 45
    }
};

const getAppointmentTypeColor = (type: string) => {
    switch (type) {
        case 'Emergency': return 'error';
        case 'Surgery Prep': return 'warning';
        case 'Diagnostic': return 'info';
        case 'Therapy Session': return 'secondary';
        default: return 'primary';
    }
};

const formatDateTime = (dateTime: string) => {
    const date = new Date(dateTime);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    let dateStr = '';
    if (date.toDateString() === today.toDateString()) {
        dateStr = 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
        dateStr = 'Tomorrow';
    } else {
        dateStr = date.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
        });
    }
    
    const timeStr = date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
    });
    
    return { dateStr, timeStr };
};

const isAppointmentToday = (dateTime: string) => {
    const appointmentDate = new Date(dateTime);
    const today = new Date();
    return appointmentDate.toDateString() === today.toDateString();
};

const isAppointmentSoon = (dateTime: string) => {
    const appointmentDate = new Date(dateTime);
    const now = new Date();
    const timeDiff = appointmentDate.getTime() - now.getTime();
    const hoursDiff = timeDiff / (1000 * 3600);
    return hoursDiff <= 2 && hoursDiff > 0;
};

const ClientList: React.FC = () => {
    const { data, isLoading } = useListContext();
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<{ id: string; name: string } | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogLink, setDialogLink] = useState('');
    const [dialogClient, setDialogClient] = useState('');
    const [tabValue, setTabValue] = useState(0);
    const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');

    useEffect(() => {
        document.title = 'Patients - Patient Management System';
    }, []);

    if (isLoading) return <div>Loading...</div>;
    if (!data) return <div>No patients found.</div>;

    const handleCallClick = (client: any) => {
        setSelectedClient({ id: client.id, name: getClientName(client.id) });
        setModalOpen(true);
    };

    const handleCloseModal = () => {
        setModalOpen(false);
        setSelectedClient(null);
    };

    const handlePatientDialog = (client: any) => {
        const clientName = encodeURIComponent(getClientName(client.id));
        const url = `${window.location.origin}/profile?client=${client.id}&name=${clientName}`;
        setDialogLink(url);
        setDialogClient(getClientName(client.id));
        setDialogOpen(true);
    };

    const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    const handleViewModeChange = (event: React.MouseEvent<HTMLElement>, newViewMode: 'cards' | 'list') => {
        if (newViewMode !== null) {
            setViewMode(newViewMode);
        }
    };

    // Filter patients based on selected tab
    const getFilteredPatients = () => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        switch (tabValue) {
            case 0: // All patients
                return data;
            case 1: // Today's appointments
                return data.filter((client: any) => {
                    const appointment = mockAppointments[client.id as keyof typeof mockAppointments];
                    return appointment && isAppointmentToday(appointment.nextAppointment);
                });
            case 2: // Online patients
                return data.filter((client: any) => client.status === 'Online');
            case 3: // Upcoming (next 3 days)
                return data.filter((client: any) => {
                    const appointment = mockAppointments[client.id as keyof typeof mockAppointments];
                    if (!appointment) return false;
                    const appointmentDate = new Date(appointment.nextAppointment);
                    const threeDaysFromNow = new Date(today);
                    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
                    return appointmentDate >= today && appointmentDate <= threeDaysFromNow;
                });
            default:
                return data;
        }
    };

    const filteredPatients = getFilteredPatients();

    // Count for badges
    const todayCount = data.filter((client: any) => {
        const appointment = mockAppointments[client.id as keyof typeof mockAppointments];
        return appointment && isAppointmentToday(appointment.nextAppointment);
    }).length;

    const onlineCount = data.filter((client: any) => client.status === 'Online').length;

    return (
        <Box sx={{ width: '100%', bgcolor: 'background.default', minHeight: '100vh', p: 2 }}>
            {/* Header */}
            <Paper elevation={1} sx={{ mb: 3, p: 2 }}>
                <Typography variant="h4" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                    Patient Management System
                </Typography>
                <Typography variant="subtitle1" color="text.secondary">
                    Manage appointments and connect with patients
                </Typography>
            </Paper>

            {/* Navigation Tabs */}
            <Paper elevation={1} sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, pb: 0 }}>
                    <Tabs 
                        value={tabValue} 
                        onChange={handleTabChange} 
                        sx={{ borderBottom: 1, borderColor: 'divider', flex: 1 }}
                    >
                        <Tab 
                            label={`All Patients (${data.length})`} 
                            icon={<PersonIcon />}
                            iconPosition="start"
                        />
                        <Tab 
                            label={
                                <Badge badgeContent={todayCount} color="error">
                                    Today's Schedule
                                </Badge>
                            } 
                            icon={<EventIcon />}
                            iconPosition="start"
                        />
                        <Tab 
                            label={
                                <Badge badgeContent={onlineCount} color="success">
                                    Online Now
                                </Badge>
                            } 
                            icon={<FiberManualRecordIcon />}
                            iconPosition="start"
                        />
                        <Tab 
                            label="Upcoming" 
                            icon={<ScheduleIcon />}
                            iconPosition="start"
                        />
                    </Tabs>
                    
                    {/* View Mode Toggle */}
                    <ToggleButtonGroup
                        value={viewMode}
                        exclusive
                        onChange={handleViewModeChange}
                        aria-label="view mode"
                        size="small"
                        sx={{ ml: 2 }}
                    >
                        <ToggleButton value="cards" aria-label="card view">
                            <ViewModuleIcon />
                        </ToggleButton>
                        <ToggleButton value="list" aria-label="list view">
                            <ViewListIcon />
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>
            </Paper>

            {/* Patient Cards/List */}
            <Box sx={viewMode === 'cards' ? { 
                display: 'grid', 
                gridTemplateColumns: { 
                    xs: '1fr', 
                    md: 'repeat(2, 1fr)', 
                    lg: 'repeat(3, 1fr)' 
                }, 
                gap: 2 
            } : {
                display: 'flex',
                flexDirection: 'column',
                gap: 1
            }}>
                {filteredPatients.map((client: any) => {
                    const appointment = mockAppointments[client.id as keyof typeof mockAppointments];
                    const { dateStr, timeStr } = appointment ? formatDateTime(appointment.nextAppointment) : { dateStr: '', timeStr: '' };
                    const isSoon = appointment ? isAppointmentSoon(appointment.nextAppointment) : false;
                    const isToday = appointment ? isAppointmentToday(appointment.nextAppointment) : false;

                    if (viewMode === 'list') {
                        // List View
                        return (
                            <Card 
                                key={client.id}
                                elevation={1} 
                                sx={{ 
                                    border: isSoon ? '2px solid #ff9800' : isToday ? '2px solid #4caf50' : 'none',
                                    transition: 'all 0.3s ease',
                                    '&:hover': {
                                        elevation: 2,
                                        transform: 'translateX(4px)'
                                    }
                                }}
                            >
                                <CardContent sx={{ p: 2 }}>
                                    <Box display="flex" alignItems="center" justifyContent="space-between">
                                        {/* Patient Info with Appointment Details close to name */}
                                        <Box display="flex" alignItems="flex-start" gap={4}>
                                            <Avatar sx={{ bgcolor: 'primary.main', mr: 1, width: 40, height: 40 }}>
                                                <PersonIcon />
                                            </Avatar>
                                            {/* Patient Name and Status */}
                                            <Box minWidth="180px">
                                                <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 0.3, lineHeight: 1.2 }}>
                                                    {getClientName(client.id)}
                                                </Typography>
                                                <Box display="flex" alignItems="center" gap={1}>
                                                    <FiberManualRecordIcon 
                                                        sx={{ 
                                                            fontSize: 12, 
                                                            color: client.status === 'Online' ? 'success.main' : 'grey.400' 
                                                        }} 
                                                    />
                                                    <Typography 
                                                        variant="body2" 
                                                        color={client.status === 'Online' ? 'success.main' : 'text.secondary'}
                                                        sx={{ fontWeight: 'medium' }}
                                                    >
                                                        {client.status}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                            {/* Appointment Info aligned with name */}
                                            <Box minWidth="250px" sx={{ alignSelf: 'flex-start' }}>
                                                {appointment ? (
                                                    <>
                                                        <Typography variant="body2" sx={{ fontWeight: 'medium', mb: 0.3, lineHeight: 1.2 }}>
                                                            {dateStr} at {timeStr}
                                                        </Typography>
                                                        <Box display="flex" alignItems="center" gap={0.5} flexWrap="wrap">
                                                            <Typography variant="body2" color="text.secondary" sx={{ mr: 0.5 }}>
                                                                {appointment.department}
                                                            </Typography>
                                                            <Chip 
                                                                label={appointment.type}
                                                                size="small"
                                                                color={getAppointmentTypeColor(appointment.type) as any}
                                                            />
                                                            {isSoon && (
                                                                <Chip 
                                                                    label="Soon" 
                                                                    size="small" 
                                                                    color="warning"
                                                                />
                                                            )}
                                                        </Box>
                                                    </>
                                                ) : (
                                                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', lineHeight: 1.2 }}>
                                                        No upcoming appointments
                                                    </Typography>
                                                )}
                                            </Box>
                                        </Box>

                                        {/* Action Buttons */}
                                        <Box display="flex" gap={1}>
                                            {client.status === 'Online' && (
                                                <Button 
                                                    variant="contained" 
                                                    color="success" 
                                                    size="small"
                                                    startIcon={<VideoCallIcon />}
                                                    onClick={() => handleCallClick(client)}
                                                >
                                                    Video Call
                                                </Button>
                                            )}
                                            <Button 
                                                variant="outlined" 
                                                color="primary" 
                                                size="small"
                                                startIcon={<LinkIcon />}
                                                onClick={() => handlePatientDialog(client)}
                                            >
                                                Link
                                            </Button>
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Card>
                        );
                    }

                    // Card View
                    return (
                        <Box key={client.id}>
                            <Card 
                                elevation={2} 
                                sx={{ 
                                    height: '100%',
                                    border: isSoon ? '2px solid #ff9800' : isToday ? '2px solid #4caf50' : 'none',
                                    transition: 'all 0.3s ease',
                                    '&:hover': {
                                        elevation: 4,
                                        transform: 'translateY(-2px)'
                                    }
                                }}
                            >
                                <CardContent sx={{ p: 3 }}>
                                    {/* Patient Header */}
                                    <Box display="flex" alignItems="center" mb={2}>
                                        <Avatar sx={{ bgcolor: 'primary.main', mr: 2, width: 50, height: 50 }}>
                                            <PersonIcon />
                                        </Avatar>
                                        <Box flex={1}>
                                            <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                                                {getClientName(client.id)}
                                            </Typography>
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <FiberManualRecordIcon 
                                                    sx={{ 
                                                        fontSize: 12, 
                                                        color: client.status === 'Online' ? 'success.main' : 'grey.400' 
                                                    }} 
                                                />
                                                <Typography 
                                                    variant="body2" 
                                                    color={client.status === 'Online' ? 'success.main' : 'text.secondary'}
                                                    sx={{ fontWeight: 'medium' }}
                                                >
                                                    {client.status}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </Box>

                                    <Divider sx={{ mb: 2 }} />

                                    {/* Appointment Info */}
                                    {appointment ? (
                                        <Box mb={3}>
                                            <Box display="flex" alignItems="center" mb={1}>
                                                <EventIcon sx={{ mr: 1, color: 'primary.main', fontSize: 20 }} />
                                                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                                                    Next Appointment
                                                </Typography>
                                                {isSoon && (
                                                    <Chip 
                                                        label="Soon" 
                                                        size="small" 
                                                        color="warning" 
                                                        sx={{ ml: 1 }}
                                                    />
                                                )}
                                            </Box>
                                            
                                            <Box display="flex" alignItems="center" mb={1}>
                                                <AccessTimeIcon sx={{ mr: 1, color: 'text.secondary', fontSize: 16 }} />
                                                <Typography variant="body2" sx={{ fontWeight: 'medium' }}>
                                                    {dateStr} at {timeStr}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                                                    ({appointment.duration} min)
                                                </Typography>
                                            </Box>

                                            <Box mb={1}>
                                                <Chip 
                                                    label={appointment.type}
                                                    size="small"
                                                    color={getAppointmentTypeColor(appointment.type) as any}
                                                    sx={{ mr: 1 }}
                                                />
                                                <Chip 
                                                    label={appointment.department}
                                                    size="small"
                                                    variant="outlined"
                                                />
                                            </Box>

                                            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                                {appointment.reason}
                                            </Typography>
                                        </Box>
                                    ) : (
                                        <Box mb={3}>
                                            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                                No upcoming appointments
                                            </Typography>
                                        </Box>
                                    )}

                                    {/* Action Buttons */}
                                    <Box display="flex" gap={1} flexWrap="wrap">
                                        {client.status === 'Online' && (
                                            <Button 
                                                variant="contained" 
                                                color="success" 
                                                size="small"
                                                startIcon={<VideoCallIcon />}
                                                onClick={() => handleCallClick(client)}
                                                sx={{ flex: 1, minWidth: 'fit-content' }}
                                            >
                                                Video Call
                                            </Button>
                                        )}
                                        <Button 
                                            variant="outlined" 
                                            color="primary" 
                                            size="small"
                                            startIcon={<LinkIcon />}
                                            onClick={() => handlePatientDialog(client)}
                                            sx={{ flex: 1, minWidth: 'fit-content' }}
                                        >
                                            Link
                                        </Button>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Box>
                    );
                })}
            </Box>

            {/* No results message */}
            {filteredPatients.length === 0 && (
                <Paper elevation={1} sx={{ p: 4, textAlign: 'center', mt: 3 }}>
                    <Typography variant="h6" color="text.secondary" gutterBottom>
                        No patients found
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {tabValue === 1 && "No appointments scheduled for today"}
                        {tabValue === 2 && "No patients are currently online"}
                        {tabValue === 3 && "No appointments in the next 3 days"}
                    </Typography>
                </Paper>
            )}

            {/* Call Modal */}
            {selectedClient && (
                <SipCallModal
                    open={modalOpen}
                    onClose={handleCloseModal}
                    clientId={selectedClient.id}
                    clientName={selectedClient.name}
                />
            )}

            {/* Patient Connection Dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle sx={{ bgcolor: 'primary.main', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box display="flex" alignItems="center">
                        <PersonIcon sx={{ mr: 1 }} />
                        Patient Connection Link - {dialogClient}
                    </Box>
                    <IconButton
                        aria-label="close"
                        onClick={() => setDialogOpen(false)}
                        sx={{ color: 'white' }}
                    >
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent sx={{ p: 3 }}>
                    <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
                        <Typography variant="body1" textAlign="center" color="text.secondary">
                            Share this QR code or link with the patient to establish a secure connection
                        </Typography>
                        <Paper elevation={2} sx={{ p: 2, bgcolor: 'grey.50' }}>
                            <QRCodeSVG value={dialogLink} size={200} />
                        </Paper>
                        <Paper elevation={1} sx={{ p: 2, width: '100%', bgcolor: 'grey.50' }}>
                            <Typography variant="body2" sx={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>
                                {dialogLink}
                            </Typography>
                        </Paper>
                        <Button 
                            variant="contained" 
                            onClick={() => navigator.clipboard.writeText(dialogLink)}
                            sx={{ width: '100%' }}
                        >
                            Copy Link to Clipboard
                        </Button>
                    </Box>
                </DialogContent>
            </Dialog>
        </Box>
    );
};

export default ClientList;
