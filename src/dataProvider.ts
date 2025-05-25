import { DataProvider } from 'react-admin';

export interface Client {
    id: string;
    created_at: string;
    filename: string;
}

export interface OnlineUser {
    id: string;
    hostname: string;
    network_ip: string;
    network_port: string;
    protocol: string;
}

const apiUrl = 'https://fs1.sn.wizher.com:8803';

const dataProvider: DataProvider = {
    getList: async (resource, params) => {
        if (resource === 'clients') {
            const usersRes = await fetch(`${apiUrl}/users`);
            const users: Client[] = await usersRes.json();
            const onlineRes = await fetch(`${apiUrl}/online`);
            const online: OnlineUser[] = await onlineRes.json();
            const onlineIds = new Set(online.map(u => u.id));
            // Use 'as unknown as RecordType[]' to force compatibility for react-admin generics
            const data = users.map(u => ({ ...u, id: String(u.id), status: onlineIds.has(u.id) ? 'Online' : 'Offline' })) as unknown as any[];
            return {
                data,
                total: users.length,
            };
        }
        throw new Error('Unknown resource');
    },
    getOne: async (resource, params) => {
        throw new Error('Not implemented');
    },
    getMany: async (resource, params) => {
        throw new Error('Not implemented');
    },
    getManyReference: async (resource, params) => {
        throw new Error('Not implemented');
    },
    update: async (resource, params) => {
        throw new Error('Not implemented');
    },
    updateMany: async (resource, params) => {
        throw new Error('Not implemented');
    },
    create: async (resource, params) => {
        throw new Error('Not implemented');
    },
    delete: async (resource, params) => {
        throw new Error('Not implemented');
    },
    deleteMany: async (resource, params) => {
        throw new Error('Not implemented');
    },
};

export default dataProvider;
