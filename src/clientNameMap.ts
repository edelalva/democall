// Utility for mapping client IDs to names
export const CLIENT_NAME_MAP: Record<string, string> = {
    '1000': 'Juan Dela Cruz',
    '1001': 'Maria Clara',
    '1002': 'Jose Rizal',
    '1003': 'Gabriela Silang',
    '1004': 'Andres Bonifacio',
    '1005': 'Gregoria de Jesus',
    '1006': 'Apolinario Mabini',
    '1007': 'Emilio Aguinaldo',
    '1008': 'Melchora Aquino',
    '1009': 'Lapu-Lapu',
    '1010': 'Queen Urduja',
    '1011': 'Ferdinand Magellan',
};

export function getClientName(id: string): string {
    return CLIENT_NAME_MAP[id] || id;
}
