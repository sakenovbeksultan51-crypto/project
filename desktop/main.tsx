import {createRoot} from 'react-dom/client';
import Dashboard from '../src/Dashboard';
import GuestViewer from '../src/components/GuestViewer';
import '../app/globals.css';

createRoot(document.getElementById('root')!).render(location.pathname.replace(/\/$/,'')==='/watch'?<GuestViewer/>:<Dashboard/>);
