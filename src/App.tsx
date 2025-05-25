import React from 'react';
import { Admin, Resource, Layout, Menu, MenuItemLink, List } from 'react-admin';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import dataProvider from './dataProvider';
import ClientList from './pages/ClientList';
import WaitForCallProfile from './pages/WaitForCallProfile';
import './App.css';

const CustomMenu = (props: any) => (
    <Menu {...props}>
        <MenuItemLink to="/clients" primaryText="Patients" leftIcon={<span role="img" aria-label="doctor">🩺</span>} />
    </Menu>
);

const CustomLayout = (props: any) => <Layout {...props} menu={CustomMenu} />;

function AdminApp() {
    return (
        <Admin dataProvider={dataProvider} layout={CustomLayout} requireAuth>
            <Resource name="clients" list={props => (
                <List {...props}>
                    <ClientList />
                </List>
            )} />
        </Admin>
    );
}

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/profile" element={<WaitForCallProfile />} />
                <Route path="/*" element={<AdminApp />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
