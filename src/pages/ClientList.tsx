import React, { useState } from 'react';
import { Button, Card, CardContent, Typography, Stack, Dialog, DialogTitle, DialogContent, IconButton, Box } from '@mui/material';
import { useListContext } from 'react-admin';
import { getClientName } from '../clientNameMap';
import SipCallModal from './SipCallModal';
import CloseIcon from '@mui/icons-material/Close';
import { QRCodeSVG } from 'qrcode.react';

const ClientList: React.FC = () => {
    const { data, isLoading } = useListContext();
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<{ id: string; name: string } | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogLink, setDialogLink] = useState('');
    const [dialogClient, setDialogClient] = useState('');

    if (isLoading) return <div>Loading...</div>;
    if (!data) return <div>No clients found.</div>;

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

    return (
        <>
            <Stack spacing={2}>
                {data.map((client: any) => (
                    <Card key={client.id}>
                        <CardContent style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                                <Typography variant="h6">{getClientName(client.id)}</Typography>
                                <Typography variant="body2" color={client.status === 'Online' ? 'green' : 'gray'}>
                                    {client.status}
                                </Typography>
                            </div>
                            <div>
                                {client.status === 'Online' && (
                                    <Button variant="contained" color="success" style={{ marginRight: 8 }} onClick={() => handleCallClick(client)}>
                                        Call
                                    </Button>
                                )}
                                <Button variant="outlined" color="primary" onClick={() => handlePatientDialog(client)}>
                                    Patient
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </Stack>
            {selectedClient && (
                <SipCallModal
                    open={modalOpen}
                    onClose={handleCloseModal}
                    clientId={selectedClient.id}
                    clientName={selectedClient.name}
                />
            )}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>
                    Patient Link for {dialogClient}
                    <IconButton
                        aria-label="close"
                        onClick={() => setDialogOpen(false)}
                        sx={{ position: 'absolute', right: 8, top: 8 }}
                    >
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent>
                    <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
                        <QRCodeSVG value={dialogLink} size={180} />
                        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{dialogLink}</Typography>
                    </Box>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default ClientList;
