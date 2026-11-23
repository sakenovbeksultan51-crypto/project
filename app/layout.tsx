import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'TableFlow — умный зал',description:'Помощник ресторанного зала: карта столов, компьютерное зрение, контроль обслуживания и аналитика.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>;}
